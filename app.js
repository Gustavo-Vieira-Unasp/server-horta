const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || "horta_db";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "estado_simulacao";

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

function gerarBaselineInicial() {
    return {
        id: 1,
        timestampReal: getDataBrasilia(),
        umidadeSolo: 65.0,
        pHSolo: LETTUCE_AGRONOMY.PH_IDEAL,
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
    };
}

async function fetchLatestState() {
    return await dbCollection.find().sort({ timestampReal: -1 }).limit(1).next();
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
        console.log(`Connected successfully to MongoDB Database [${DB_NAME}] -> Collection [${COLLECTION_NAME}]`);

        const count = await dbCollection.countDocuments();
        if (count === 0) {
            const initialSeed = gerarBaselineInicial();
            await dbCollection.insertOne(initialSeed);
            console.log("Database seeded with foundational tracking node.");
        }
    } catch (erro) {
        console.error("Critical Database Connection Error:", erro);
        process.exit(1);
    }
}

// =========================================================================
// NÚCLEO DE SIMULAÇÃO (PRODUZ UM NOVO ESTADO COM BASE EM UM ANTERIOR)
// =========================================================================
function obterEstacaoAtual(mesZeroBased) {
    if ([11, 0, 1].includes(mesZeroBased)) return 'verao';
    if ([2, 3, 4].includes(mesZeroBased)) return 'outono';
    if ([5, 6, 7].includes(mesZeroBased)) return 'inverno';
    return 'primavera';
}

function simularProximoMinuto(estadoAnterior, dataAlvo) {
    const state = JSON.parse(JSON.stringify(estadoAnterior));
    
    const mes = dataAlvo.getMonth();
    const horaDecimal = dataAlvo.getHours() + (dataAlvo.getMinutes() / 60);

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
        if (dataAlvo.getMinutes() === 0) {
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

    // 8. ARREDONDAMENTOS E ALINHAMENTO DE HORÁRIO
    state.temperaturaCalculada = parseFloat(temperaturaAtual.toFixed(1));
    state.umidadeArCalculada = parseFloat(umidadeAr.toFixed(1));
    state.luzCalculada = Math.round(luzIntensidade);

    const totalMinutesToday = (dataAlvo.getHours() * 60) + dataAlvo.getMinutes();
    state.id = totalMinutesToday === 0 ? 1440 : totalMinutesToday;
    state.timestampReal = dataAlvo;

    delete state._id; 
    return state;
}

// =========================================================================
// SINCRONIZAÇÃO COMPORTAMENTAL BASEADA EM SEGUNDOS ABSOLUTOS (PROTEÇÃO UTC)
// =========================================================================
async function sincronizarEProcessarHorta() {
    if (!dbCollection) return;

    try {
        const agoraBR = getDataBrasilia();
        let ultimoEstado = await fetchLatestState();
        if (!ultimoEstado) return;

        const dataUltimoEstado = new Date(ultimoEstado.timestampReal);
        const diferencaMilissegundos = agoraBR.getTime() - dataUltimoEstado.getTime();
        const minutosPerdidos = Math.floor(diferencaMilissegundos / 60000);

        if (minutosPerdidos > 0 && minutosPerdidos < 1440) {
            console.log(`[ENGINE] Detectados ${minutosPerdidos} minutos offline. Iniciando backfill...`);
            let loteNovosRegistros = [];

            for (let i = 1; i <= minutosPerdidos; i++) {
                const dataCalculoPasso = new Date(dataUltimoEstado.getTime() + (i * 60000));

                ultimoEstado = simularProximoMinuto(ultimoEstado, dataCalculoPasso);
                loteNovosRegistros.push({ ...ultimoEstado });
            }

            await dbCollection.insertMany(loteNovosRegistros);
            console.log(`[ENGINE] Backfill concluído com segurança! ${loteNovosRegistros.length} registros injetados.`);
        }
    } catch (err) {
        console.error("[CRITICAL ENGINE ERROR]:", err.message);
    }
}

async function rodarCicloSincronizado() {
    await sincronizarEProcessarHorta();
    const agora = new Date();
    const msAteProximoMinuto = 60000 - (agora.getSeconds() * 1000 + agora.getMilliseconds());
    setTimeout(rodarCicloSincronizado, msAteProximoMinuto);
}

async function garantizarSincroniaMiddleware(req, res, next) {
    if (dbCollection) {
        await sincronizarEProcessarHorta();
    }
    next();
}

// =========================================================================
// ROTAS DA API
// =========================================================================

app.get('/', (req, res) => {
    res.send('API da Horta Inteligente ativa com persistência MongoDB.');
});

// ROTA 1: TELEMETRIA ATUAL SIMPLES
app.get(['/api/aquisicao', '/api/aquisicao/'], garantizarSincroniaMiddleware, async (req, res) => {
    try {
        const snapshot = await fetchLatestState();
        const dataHoraFormatada = formatarDataHora(snapshot.timestampReal || getDataBrasilia());

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

// ROTA 2: TELEMETRIA ATUAL AVANÇADA
app.get(['/api/aquisicao/avancada', '/api/aquisicao/avancada/'], garantizarSincroniaMiddleware, async (req, res) => {
    try {
        const snapshot = await fetchLatestState();
        const dataHoraFormatada = formatarDataHora(snapshot.timestampReal || getDataBrasilia());

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

// ROTA HISTÓRICO 1: OTIMIZADA PARA COLETAR DADOS PARA GRÁFICOS DO DASHBOARD
app.get(['/api/historico/completo', '/api/historico/completo/'], garantizarSincroniaMiddleware, async (req, res) => {
    try {
        const rawLogs = await dbCollection.find().sort({ timestampReal: 1 }).toArray();
        
        const timeline = rawLogs.map(log => ({
            id: log.id,
            timestamp: formatarDataHora(log.timestampReal || getDataBrasilia()),
            umidadeSolo: parseFloat(log.umidadeSolo.toFixed(1)),
            temperatura: log.temperaturaCalculada,
            umidadeAr: Math.round(log.umidadeArCalculada),
            pHSolo: parseFloat(log.pHSolo.toFixed(2)),
            luzSolar: log.luzCalculada,
            statusIrrigacao: log.statusIrrigacao === "LIGADO" ? 1 : 0, 
            estaChovendo: log.estaChovendo ? 1 : 0
        }));

        res.json({
            totalRegistros: timeline.length,
            dashboardData: timeline
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao extrair histórico de dados para o dashboard." });
    }
});

// ROTA HISTÓRICO 2: BUSCAR DETALHES DE UM MINUTO ESPECÍFICO
app.get('/api/historico/minuto/:id', garantizarSincroniaMiddleware, async (req, res) => {
    try {
        const targetId = parseInt(req.params.id);
        const snapshot = await dbCollection.findOne({ id: targetId });
        
        if (!snapshot) {
            return res.status(404).json({ erro: `Minuto ${targetId} ausente do histórico.` });
        }
        res.json(snapshot);
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar minuto do histórico." });
    }
});

// ROTA 3: CONTROLE DE IRRIGAÇÃO MANUAL (POST)
app.post(['/api/controle/irrigacao', '/api/controle/irrigacao/'], garantizarSincroniaMiddleware, async (req, res) => {
    try {
        const { ligar, automatico } = req.body;
        const state = await fetchLatestState();
        if (!state) return res.status(500).json({ erro: "Sem base operacional estável." });

        let novoEstado = { ...state };

        if (automatico === true) {
            novoEstado.modoIrrigacaoManual = false;
        } else if (typeof ligar === 'boolean') {
            novoEstado.modoIrrigacaoManual = true;
            novoEstado.statusIrrigacao = ligar ? "LIGADO" : "DESLIGADO";
        } else {
            return res.status(400).json({ erro: "Parâmetro 'ligar' inválido." });
        }

        novoEstado.timestampReal = getDataBrasilia();
        const totalMinutesToday = (novoEstado.timestampReal.getHours() * 60) + novoEstado.timestampReal.getMinutes();
        novoEstado.id = totalMinutesToday === 0 ? 1440 : totalMinutesToday;

        delete novoEstado._id;
        await dbCollection.insertOne(novoEstado);
        
        res.json({ 
            mensagem: "Configuração manual aplicada e persistida como novo registro log.",
            statusAtual: novoEstado.statusIrrigacao 
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar controle dos atuadores." });
    }
});

// ROTA 4: FORÇAR EVENTO DE PRECIPITAÇÃO ATMOSFÉRICA (POST)
app.post(['/api/controle/chuva', '/api/controle/chuva/'], garantizarSincroniaMiddleware, async (req, res) => {
    try {
        const { duracao, intensidade } = req.body;
        const intensidadesValidas = ["leve", "moderada", "forte"];

        if (!duracao || typeof duracao !== 'number' || duracao <= 0) {
            return res.status(400).json({ erro: "Duração inválida." });
        }

        if (!intensidade || !intensidadesValidas.includes(intensidade)) {
            return res.status(400).json({ erro: "Intensidade inválida." });
        }

        const state = await fetchLatestState();
        let novoEstado = { ...state };
        
        novoEstado.estaChovendo = true;
        novoEstado.tempoRestanteChuva = duracao;
        novoEstado.intensidadeChuva = intensidade;
        novoEstado.condicaoCeu = "chuvoso";
        novoEstado.timestampReal = getDataBrasilia();
        
        const totalMinutesToday = (novoEstado.timestampReal.getHours() * 60) + novoEstado.timestampReal.getMinutes();
        novoEstado.id = totalMinutesToday === 0 ? 1440 : totalMinutesToday;

        delete novoEstado._id;
        await dbCollection.insertOne(novoEstado);

        res.json({ 
            mensagem: `Precipitação forçada injetada com sucesso no histórico.`,
            condicaoCeu: "chuvoso",
            intensidade: intensidade
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao injetar comando climático." });
    }
});

// ROTA 5: FORÇAR RESET COMPLETO DE DADOS E DO ID DA SIMULAÇÃO (POST)
app.post(['/api/controle/reset-total', '/api/controle/reset-total/'], async (req, res) => {
    try {
        await dbCollection.deleteMany({});
        
        const baseline = gerarBaselineInicial();

        await dbCollection.insertOne(baseline);
        res.json({ 
            mensagem: "Linha do tempo limpa! Nova simulação iniciada com sucesso.",
            dadosIniciais: baseline
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao executar a rota de reset emergencial." });
    }
});

// =============================================
// INICIALIZAÇÃO SERVER
// =============================================
const PORT = process.env.PORT || 3000;

conectarBanco().then(() => {
    app.listen(PORT, () => {
        console.log(`====================================================================`);
        console.log(`BULLETPROOF CATCH-UP ENGINE POOL READY - PORTA: ${PORT}`);
        console.log(`====================================================================`);

        const agoraInicial = new Date();
        const tempoDeEsperaInicial = 60000 - (agoraInicial.getSeconds() * 1000 + agoraInicial.getMilliseconds());
        setTimeout(rodarCicloSincronizado, tempoDeEsperaInicial);
    });
});
