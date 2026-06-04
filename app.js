const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "horta_db";
const COLLECTION_NAME = "estado_simulacao";

const app = express();

app.use(cors());
app.use(express.json());
app.set('case sensitive routing', false); 

let dbCollection;

// =========================================================================
// CONFIGURAÇÕES & PARAMETROS
// =========================================================================

const GEOGRAPHIC_CONFIG = {
    ELEVATION_METERS: 612,
};

const LETTUCE_AGRONOMY = {
    PH_IDEAL: 6.2,
    MOISTURE_CRITICAL_ALERT: 55.0,
    IRRIGATION_TARGET_MAX: 72.0,
};

const SOIL_PHYSICS = {
    CAPACIDADE_CAMPO: 85.0,
    PONTO_MURCHA: 22.0,
    MIN_ABSOLUTE_MOISTURE: 15.0,
    MAX_ABSOLUTE_MOISTURE: 95.0,
    RAIN_WATER_PH: 5.2,
    PH_BUFFER_FACTOR: 0.006,
    THERMAL_INERTIA_WEIGHT: 0.05,
    DRAINAGE_RATE_PER_MIN: 0.25,
};

const ACTUATOR_SPECS = {
    DROPPER_FLOW_L_H: 2.0,
    IRRIGATION_GAIN_PER_MIN: 0.35,
};

const VARIAVEIS_ESTACAO = {
    verao:     { minTemp: 19.5, maxTemp: 28.5, amanhecer: 5.33, anoitecer: 19.00, chanceChuvaPorMin: 0.0075 },
    outono:    { minTemp: 15.0, maxTemp: 25.5, amanhecer: 6.16, anoitecer: 18.33, chanceChuvaPorMin: 0.0033 },
    inverno:   { minTemp: 12.5, maxTemp: 26.0, amanhecer: 6.83, anoitecer: 17.41, chanceChuvaPorMin: 0.0008 },
    primavera: { minTemp: 18.0, maxTemp: 28.5, amanhecer: 5.83, anoitecer: 18.00, chanceChuvaPorMin: 0.0033 }
};

function getDataBrasilia() {
    const agora = new Date();
    const utc = agora.getTime() + (agora.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * -3));
}

function formatarDataHora(data) {
    const pad = (num) => String(num).padStart(2, '0');
    const ano = data.getFullYear();
    const mes = pad(data.getMonth() + 1);
    const dia = pad(data.getDate());
    const hora = pad(data.getHours());
    const minuto = pad(data.getMinutes());
    const segundo = pad(data.getSeconds());
    return `${ano}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
}

// =========================================================================
// CONEXÃO MONGODB
// =========================================================================
async function conectarBanco() {
    try {
        if (!MONGO_URI) {
            throw new Error("Missing MONGO_URI environment variable context.");
        }
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        const db = client.db(DB_NAME);
        dbCollection = db.collection(COLLECTION_NAME);
        console.log("Connected successfully to MongoDB Atlas Cloud Cluster!");
        console.log("Wiping old collection tracking states for a clean simulation restart...");
        await dbCollection.deleteMany({}); 

        const count = await dbCollection.countDocuments();
        if (count === 0) {
            await dbCollection.insertOne({
                _id: "global_state",
                id: 1,
                umidadeSolo: 65.0,
                pHSolo: 6.2,
                temperaturaCalculada: 22.0,
                umidadeArCalculada: 75.0,
                luzCalculada: 0,
                estaChovendo: false,
                condicaoCeu: "ensolarado",
                intensidadeChuva: "nenhuma",
                tempoRestanteChuva: 0,
                statusIrrigacao: "DESLIGADO",
                estacaoCalculada: "outono",
                tempSolo: 21.5,
                modoIrrigacaoManual: false
            });
            console.log("Database seeded with initial state tracking template.");
        }
    } catch (erro) {
        console.error("Critical Database Connection Error:", erro);
        process.exit(1);
    }
}

// =========================================================================
// SIMULAÇÃO LOGIC ENGINE
// =========================================================================
function obterEstacaoAtual(mesZeroBased) {
    if ([11, 0, 1].includes(mesZeroBased)) return 'verao';
    if ([2, 3, 4].includes(mesZeroBased)) return 'outono';
    if ([5, 6, 7].includes(mesZeroBased)) return 'inverno';
    return 'primavera';
}

async function atualizarCicloMinuto() {
    if (!dbCollection) return;
    
    try {
        const state = await dbCollection.findOne({ _id: "global_state" });
        if (!state) return;

        const agoraBR = getDataBrasilia();
        const mes = agoraBR.getMonth();
        const horaDecimal = agoraBR.getHours() + (agoraBR.getMinutes() / 60);

        state.estacaoCalculada = obterEstacaoAtual(mes);
        const estacao = VARIAVEIS_ESTACAO[state.estacaoCalculada];

        // 1. TEMPERATURA DO AR
        const tRad = (horaDecimal - (estacao.amanhecer + 3.5)) * (2 * Math.PI / 24);
        const tempBase = (estacao.maxTemp + estacao.minTemp) / 2;
        const tempAmplitude = (estacao.maxTemp - estacao.minTemp) / 2;
        
        let temperaturaAtual = tempBase + (Math.sin(tRad) * tempAmplitude);
        temperaturaAtual += (Math.random() - 0.5) * 0.6;

        // 2. UMIDADE E LUZ SOLAR
        let umidadeAr = 80.0 - (Math.sin(tRad) * 20.0);
        let luzIntensidade = 0;

        if (horaDecimal >= estacao.amanhecer && horaDecimal <= estacao.anoitecer) {
            const totalDia = estacao.anoitecer - estacao.amanhecer;
            const progressoDia = (horaDecimal - estacao.amanhecer) / totalDia;
            luzIntensidade = Math.max(0, Math.sin(progressoDia * Math.PI) * 100);
        }

        // 3. CONDIÇÃO DO CÉU
        if (!state.estaChovendo) {
            if (agoraBR.getMinutes() === 0) {
                const dadosCeuRoll = Math.random();
                state.condicaoCeu = dadosCeuRoll < 0.65 ? "ensolarado" : "nublado";
            }
        } else {
            state.condicaoCeu = "chuvoso";
        }

        if (state.condicaoCeu === "nublado") {
            luzIntensidade *= 0.55;
            temperaturaAtual -= 1.5;
            umidadeAr = Math.min(umidadeAr + 10, 90);
        }

        // 4. CHUVA
        if (state.estaChovendo) {
            state.tempoRestanteChuva--;
            umidadeAr = 95.0;

            if (state.intensidadeChuva === "leve") {
                luzIntensidade *= 0.35;
                temperaturaAtual -= 1.0;
            } else if (state.intensidadeChuva === "moderada") {
                luzIntensidade *= 0.20;
                temperaturaAtual -= 2.2;
            } else if (state.intensidadeChuva === "forte") {
                luzIntensidade *= 0.08;
                temperaturaAtual -= 3.8;
                umidadeAr = 99.0;
            }

            let ganhoAguaMinuto = 0.05;
            if (state.intensidadeChuva === "moderada") ganhoAguaMinuto = 0.15;
            if (state.intensidadeChuva === "forte") ganhoAguaMinuto = 0.40;

            state.umidadeSolo = Math.min(state.umidadeSolo + ganhoAguaMinuto, SOIL_PHYSICS.MAX_ABSOLUTE_MOISTURE);
            
            if (state.pHSolo > SOIL_PHYSICS.RAIN_WATER_PH) {
                state.pHSolo = Math.max(state.pHSolo - 0.002, SOIL_PHYSICS.RAIN_WATER_PH);
            }

            if (state.tempoRestanteChuva <= 0) {
                state.estaChovendo = false;
                state.intensidadeChuva = "nenhuma";
                state.condicaoCeu = "nublado";
            }
        } 
        else {
            if (Math.random() < estacao.chanceChuvaPorMin) {
                state.estaChovendo = true;
                state.tempoRestanteChuva = Math.floor(Math.random() * 45) + 15;

                const rollIntensidade = Math.random();
                if (rollIntensidade < 0.5) state.intensidadeChuva = "leve";
                else if (rollIntensidade < 0.85) state.intensidadeChuva = "moderada";
                else state.intensidadeChuva = "forte";
            }
        }

        // 5. IRRIGAÇÃO AUTOMÁTICA / MANUAL
        if (!state.modoIrrigacaoManual) {
            if (state.umidadeSolo < LETTUCE_AGRONOMY.MOISTURE_CRITICAL_ALERT) {
                state.statusIrrigacao = "LIGADO";
            }
            if (state.statusIrrigacao === "LIGADO" && state.umidadeSolo >= LETTUCE_AGRONOMY.IRRIGATION_TARGET_MAX) {
                state.statusIrrigacao = "DESLIGADO";
            }
        }

        if (state.statusIrrigacao === "LIGADO") {
            state.umidadeSolo = Math.min(state.umidadeSolo + ACTUATOR_SPECS.IRRIGATION_GAIN_PER_MIN, SOIL_PHYSICS.MAX_ABSOLUTE_MOISTURE);
            const diferencaPH = LETTUCE_AGRONOMY.PH_IDEAL - state.pHSolo;
            state.pHSolo += diferencaPH * SOIL_PHYSICS.PH_BUFFER_FACTOR;
        }

        // 6. EVAPORAÇÃO, DRENAGEM DO SOLO & ABSORÇÃO
        let modificadorCeuEvaporacao = 1.0;
        if (state.condicaoCeu === "nublado") modificadorCeuEvaporacao = 0.5;
        if (state.condicaoCeu === "chuvoso") modificadorCeuEvaporacao = 0.1;

        const taxaSecagem = (0.005 + (temperaturaAtual * 0.0012) + (luzIntensidade * 0.00022)) * modificadorCeuEvaporacao;
        const absorcaoPlanta = (temperaturaAtual > 23 ? 0.08 : 0.04) * (luzIntensidade / 100);
        
        state.umidadeSolo -= (taxaSecagem + absorcaoPlanta);

        if (state.umidadeSolo > SOIL_PHYSICS.CAPACIDADE_CAMPO) {
            const excessoCapacidade = state.umidadeSolo - SOIL_PHYSICS.CAPACIDADE_CAMPO;
            state.umidadeSolo -= (excessoCapacidade * SOIL_PHYSICS.DRAINAGE_RATE_PER_MIN);
        }

        state.umidadeSolo = Math.max(state.umidadeSolo, SOIL_PHYSICS.MIN_ABSOLUTE_MOISTURE);

        // 7. TEMPERATURA DO SOLO
        state.tempSolo = (state.tempSolo * (1 - SOIL_PHYSICS.THERMAL_INERTIA_WEIGHT)) + (temperaturaAtual * SOIL_PHYSICS.THERMAL_INERTIA_WEIGHT);

        // 8. PERSISTÊNCIA DOS ARREDONDAMENTOS
        state.temperaturaCalculada = parseFloat(temperaturaAtual.toFixed(1));
        state.umidadeArCalculada = parseFloat(umidadeAr.toFixed(1));
        state.luzCalculada = Math.round(luzIntensidade);

        const totalMinutesToday = (agoraBR.getHours() * 60) + agoraBR.getMinutes();
        state.id = totalMinutesToday === 0 ? 1440 : totalMinutesToday;

        // Strip structural tracking attributes before document replace
        delete state._id;
        await dbCollection.updateOne({ _id: "global_state" }, { $set: state });
    } catch (err) {
        console.error("Tick calculation failed:", err.message);
    }
}

if (process.env.RENDER === "true" || !process.env.WEBSITE_SITE_NAME) {
    console.log("Simulation Loop initialized on master calculation core.");
    setInterval(atualizarCicloMinuto, 60000);
}

// =========================================================================
// ROTAS DA API
// =========================================================================

app.get('/', (req, res) => {
    res.send('API da Horta Inteligente ativa com persistência MongoDB.');
});

// ROTA 1: BÁSICA
app.get(['/api/aquisicao', '/api/aquisicao/'], async (req, res) => {
    try {
        const snapshot = await dbCollection.findOne({ _id: "global_state" });
        const agoraBR = getDataBrasilia();
        const dataHoraFormatada = formatarDataHora(agoraBR);

        res.json({
            "id": snapshot.id,
            "dataHora": dataHoraFormatada,
            "umidadeSoloPorcentagem": parseFloat(snapshot.umidadeSolo.toFixed(1)),
            "temperatura": snapshot.temperaturaCalculada,
            "UmidadeAr": Math.round(snapshot.umidadeArCalculada),
            "pHSolo": parseFloat(snapshot.pHSolo.toFixed(1))
        });
    } catch (erro) {
        res.status(500).json({ erro: "Falha ao obter telemetria via MongoDB Cloud." });
    }
});

// ROTA 2: AVANÇADA
app.get(['/api/aquisicao/avancada', '/api/aquisicao/avancada/'], async (req, res) => {
    try {
        const snapshot = await dbCollection.findOne({ _id: "global_state" });
        const agoraBR = getDataBrasilia();
        const dataHoraFormatada = formatarDataHora(agoraBR);

        res.json({
            "aquisicao_avancada": [
                {
                    "id": snapshot.id,
                    "dataHora": dataHoraFormatada,
                    "condicoes_ambientais": {
                        "estacao": snapshot.estacaoCalculada,
                        "temperaturaCelsius": snapshot.temperaturaCalculada,
                        "umidadeArPorcentagem": snapshot.umidadeArCalculada,
                        "estaChovendo": snapshot.estaChovendo,
                        "intensidadeChuva": snapshot.intensidadeChuva,
                        "luminosidadeSolarPorcentagem": snapshot.luzCalculada,
                        "condicaoCeu": snapshot.condicaoCeu,
                        "temperaturaSolo": parseFloat(snapshot.tempSolo.toFixed(1))
                    },
                    "sensores_solo": {
                        "umidadeSoloPorcentagem": parseFloat(snapshot.umidadeSolo.toFixed(1)),
                        "pHSolo": parseFloat(snapshot.pHSolo.toFixed(2)),
                        "alertaCriticoAlface": snapshot.umidadeSolo < LETTUCE_AGRONOMY.MOISTURE_CRITICAL_ALERT,
                        "capacidadeCampoPorcentagem": SOIL_PHYSICS.CAPACIDADE_CAMPO,
                        "pontoMurchaPorcentagem": SOIL_PHYSICS.PONTO_MURCHA
                    },
                    "atuadores": {
                        "statusIrrigacao": snapshot.statusIrrigacao,
                        "vazaoGotejamentoLh": snapshot.statusIrrigacao === "LIGADO" ? ACTUATOR_SPECS.DROPPER_FLOW_L_H : 0.0,
                        "controleManualAtivo": snapshot.modoIrrigacaoManual
                    }
                }
            ]
        });
    } catch (erro) {
        res.status(500).json({ erro: "Falha ao obter telemetria avançada via MongoDB Cloud." });
    }
});

// ROTA 3: CONTROLE DE IRRIGAÇÃO MANUAL (POST)
app.post(['/api/controle/irrigacao', '/api/controle/irrigacao/'], async (req, res) => {
    try {
        const { ligar, automatico } = req.body;
        let updateQuery = {};

        if (automatico === true) {
            updateQuery = { modoIrrigacaoManual: false };
        } else if (typeof ligar === 'boolean') {
            updateQuery = { modoIrrigacaoManual: true, statusIrrigacao: ligar ? "LIGADO" : "DESLIGADO" };
        } else {
            return res.status(400).json({ erro: "Parâmetro 'ligar' inválido. Forneça um valor booleano." });
        }

        await dbCollection.updateOne({ _id: "global_state" }, { $set: updateQuery });
        
        const freshSnapshot = await dbCollection.findOne({ _id: "global_state" });
        res.json({ 
            mensagem: "Configuração de atuador salva e sincronizada globalmente no cluster.",
            statusAtual: freshSnapshot.statusIrrigacao 
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar controle dos atuadores no MongoDB." });
    }
});

// ROTA 4: FORÇAR EVENTO DE PRECIPITAÇÃO ATMOSFÉRICA (POST)
app.post(['/api/controle/chuva', '/api/controle/chuva/'], async (req, res) => {
    try {
        const { duracao, intensidade } = req.body;
        const intensidadesValidas = ["leve", "moderada", "forte"];

        if (!duracao || typeof duracao !== 'number' || duracao <= 0) {
            return res.status(400).json({ erro: "Duração inválida. Especifique o tempo em minutos." });
        }

        if (!intensidade || !intensidadesValidas.includes(intensidade)) {
            return res.status(400).json({ erro: "Intensidade inválida. Escolha entre: leve, moderada ou forte." });
        }

        await dbCollection.updateOne({ _id: "global_state" }, {
            $set: { estaChovendo: true, tempoRestanteChuva: duracao, intensidadeChuva: intensidade, condicaoCeu: "chuvoso" }
        });

        res.json({ 
            mensagem: `Evento climático inserido com sucesso.`,
            condicaoCeu: "chuvoso",
            intensidade: intensidade
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao injetar comando climático no MongoDB." });
    }
});

// =============================================
// INICIALIZAÇÃO ASYNCHRONOUS ENGINE
// =============================================
const PORT = process.env.PORT || 3000;

conectarBanco().then(() => {
    app.listen(PORT, () => {
        console.log(`====================================================================`);
        console.log(`ENGINE POOL OPERATIONAL - SIMULAÇÃO HORTA INTELIGENTE PORTA: ${PORT}`);
        console.log(`====================================================================`);
    });
});
