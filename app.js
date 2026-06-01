const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

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
// SIMULAÇÃO
// =========================================================================

class HortaSimulador {
    constructor() {
        this.state = {
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
        };
    }

    obterEstacaoAtual(mesZeroBased) {
        if ([11, 0, 1].includes(mesZeroBased)) return 'verao';
        if ([2, 3, 4].includes(mesZeroBased)) return 'outono';
        if ([5, 6, 7].includes(mesZeroBased)) return 'inverno';
        return 'primavera';
    }

    atualizarCicloMinuto() {
        const agoraBR = getDataBrasilia();
        const mes = agoraBR.getMonth();
        const horaDecimal = agoraBR.getHours() + (agoraBR.getMinutes() / 60);

        this.state.estacaoCalculada = this.obterEstacaoAtual(mes);
        const estacao = VARIAVEIS_ESTACAO[this.state.estacaoCalculada];

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
        if (!this.state.estaChovendo) {
            if (agoraBR.getMinutes() === 0) {
                const dadosCeuRoll = Math.random();
                this.state.condicaoCeu = dadosCeuRoll < 0.65 ? "ensolarado" : "nublado";
            }
        } else {
            this.state.condicaoCeu = "chuvoso";
        }

        if (this.state.condicaoCeu === "nublado") {
            luzIntensidade *= 0.55;
            temperaturaAtual -= 1.5;
            umidadeAr = Math.min(umidadeAr + 10, 90);
        }

        // 4. CHUVA
        if (this.state.estaChovendo) {
            this.state.tempoRestanteChuva--;
            umidadeAr = 95.0;

            if (this.state.intensidadeChuva === "leve") {
                luzIntensidade *= 0.35;
                temperaturaAtual -= 1.0;
            } else if (this.state.intensidadeChuva === "moderada") {
                luzIntensidade *= 0.20;
                temperaturaAtual -= 2.2;
            } else if (this.state.intensidadeChuva === "forte") {
                luzIntensidade *= 0.08;
                temperaturaAtual -= 3.8;
                umidadeAr = 99.0;
            }

            let ganhoAguaMinuto = 0.05;
            if (this.state.intensidadeChuva === "moderada") ganhoAguaMinuto = 0.15;
            if (this.state.intensidadeChuva === "forte") ganhoAguaMinuto = 0.40;

            this.state.umidadeSolo = Math.min(this.state.umidadeSolo + ganhoAguaMinuto, SOIL_PHYSICS.MAX_ABSOLUTE_MOISTURE);
            
            if (this.state.pHSolo > SOIL_PHYSICS.RAIN_WATER_PH) {
                this.state.pHSolo = Math.max(this.state.pHSolo - 0.002, SOIL_PHYSICS.RAIN_WATER_PH);
            }

            if (this.state.tempoRestanteChuva <= 0) {
                this.state.estaChovendo = false;
                this.state.intensidadeChuva = "nenhuma";
                this.state.condicaoCeu = "nublado";
            }
        } 
        else {
            if (Math.random() < estacao.chanceChuvaPorMin) {
                this.state.estaChovendo = true;
                this.state.tempoRestanteChuva = Math.floor(Math.random() * 45) + 15;

                const rollIntensidade = Math.random();
                if (rollIntensidade < 0.5) this.state.intensidadeChuva = "leve";
                else if (rollIntensidade < 0.85) this.state.intensidadeChuva = "moderada";
                else this.state.intensidadeChuva = "forte";
            }
        }

        // 5. IRRIGAÇÃO AUTOMÁTICA / MANUAL
        if (!this.state.modoIrrigacaoManual) {
            if (this.state.umidadeSolo < LETTUCE_AGRONOMY.MOISTURE_CRITICAL_ALERT) {
                this.state.statusIrrigacao = "LIGADO";
            }
            if (this.state.statusIrrigacao === "LIGADO" && this.state.umidadeSolo >= LETTUCE_AGRONOMY.IRRIGATION_TARGET_MAX) {
                this.state.statusIrrigacao = "DESLIGADO";
            }
        }

        if (this.state.statusIrrigacao === "LIGADO") {
            this.state.umidadeSolo = Math.min(this.state.umidadeSolo + ACTUATOR_SPECS.IRRIGATION_GAIN_PER_MIN, SOIL_PHYSICS.MAX_ABSOLUTE_MOISTURE);
            
            const diferencaPH = LETTUCE_AGRONOMY.PH_IDEAL - this.state.pHSolo;
            this.state.pHSolo += diferencaPH * SOIL_PHYSICS.PH_BUFFER_FACTOR;
        }

        // 6. EVAPORAÇÃO, DRENAGEM DO SOLO & ABSORÇÃO
        let modificadorCeuEvaporacao = 1.0;
        if (this.state.condicaoCeu === "nublado") modificadorCeuEvaporacao = 0.5;
        if (this.state.condicaoCeu === "chuvoso") modificadorCeuEvaporacao = 0.1;

        const taxaSecagem = (0.005 + (temperaturaAtual * 0.0012) + (luzIntensidade * 0.00022)) * modificadorCeuEvaporacao;
        const absorcaoPlanta = (temperaturaAtual > 23 ? 0.08 : 0.04) * (luzIntensidade / 100);
        
        this.state.umidadeSolo -= (taxaSecagem + absorcaoPlanta);

        if (this.state.umidadeSolo > SOIL_PHYSICS.CAPACIDADE_CAMPO) {
            const excessoCapacidade = this.state.umidadeSolo - SOIL_PHYSICS.CAPACIDADE_CAMPO;
            this.state.umidadeSolo -= (excessoCapacidade * SOIL_PHYSICS.DRAINAGE_RATE_PER_MIN);
        }

        this.state.umidadeSolo = Math.max(this.state.umidadeSolo, SOIL_PHYSICS.MIN_ABSOLUTE_MOISTURE);

        // 7. TEMPERATURA DO SOLO
        this.state.tempSolo = (this.state.tempSolo * (1 - SOIL_PHYSICS.THERMAL_INERTIA_WEIGHT)) + (temperaturaAtual * SOIL_PHYSICS.THERMAL_INERTIA_WEIGHT);

        // 8. PERSISTÊNCIA DOS ARREDONDAMENTOS
        this.state.temperaturaCalculada = parseFloat(temperaturaAtual.toFixed(1));
        this.state.umidadeArCalculada = parseFloat(umidadeAr.toFixed(1));
        this.state.luzCalculada = Math.round(luzIntensidade);
        this.state.id++;
    }

    forcarChuvaManual(duracaoMinutos, intensidade) {
        this.state.estaChovendo = true;
        this.state.tempoRestanteChuva = duracaoMinutos;
        this.state.intensidadeChuva = intensidade;
        this.state.condicaoCeu = "chuvoso";
    }

    configurarIrrigacaoManual(statusAtuador) {
        this.state.modoIrrigacaoManual = true;
        this.state.statusIrrigacao = statusAtuador ? "LIGADO" : "DESLIGADO";
    }

    restaurarIrrigacaoAutomatica() {
        this.state.modoIrrigacaoManual = false;
    }
}

const simulador = new HortaSimulador();
setInterval(() => simulador.atualizarCicloMinuto(), 60000);

// =========================================================================
// ROTAS DA API
// =========================================================================

app.get('/', (req, res) => {
    res.send('API da Horta Inteligente ativa. Consulte a documentação para acessar as rotas de telemetria.');
});

// ROTA 1: BÁSICA
app.get('/api/aquisicao', (req, res) => {
    try {
        const agoraBR = getDataBrasilia();
        const dataHoraFormatada = formatarDataHora(agoraBR);
        const snapshot = simulador.state;

        res.json({
            "id": snapshot.id,
            "dataHora": dataHoraFormatada,
            "temperatura": snapshot.temperaturaCalculada,
            "UmidadeAr": Math.round(snapshot.umidadeArCalculada),
            "pHSolo": parseFloat(snapshot.pHSolo.toFixed(1))
        });
    } catch (erro) {
        res.status(500).json({ erro: "Falha interna ao processar telemetria básica." });
    }
});

// ROTA 2: AVANÇADA
app.get('/api/aquisicao/avancada', (req, res) => {
    try {
        const agoraBR = getDataBrasilia();
        const dataHoraFormatada = formatarDataHora(agoraBR);
        const snapshot = simulador.state;

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
        res.status(500).json({ erro: "Falha interna ao processar telemetria avançada." });
    }
});

// ROTA 3: CONTROLE DE IRRIGAÇÃO MANUAL (POST)
app.post('/api/controle/irrigacao', (req, res) => {
    try {
        const { ligar, automatico } = req.body;

        if (automatico === true) {
            simulador.restaurarIrrigacaoAutomatica();
            return res.json({ mensagem: "Controle de irrigação devolvido ao sistema automático com sucesso." });
        }

        if (typeof ligar !== 'boolean') {
            return res.status(400).json({ erro: "Parâmetro 'ligar' inválido. Forneça um valor booleano." });
        }

        simulador.configurarIrrigacaoManual(ligar);
        res.json({ 
            mensagem: `Bomba de irrigação configurada manualmente para: ${simulador.state.statusIrrigacao}`,
            statusAtual: simulador.state.statusIrrigacao 
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao processar alteração manual dos atuadores." });
    }
});

// ROTA 4: FORÇAR EVENTO DE PRECIPITAÇÃO ATMOSFÉRICA (POST)
app.post('/api/controle/chuva', (req, res) => {
    try {
        const { duracao, intensidade } = req.body;
        const intensidadesValidas = ["leve", "moderada", "forte"];

        if (!duracao || typeof duracao !== 'number' || duracao <= 0) {
            return res.status(400).json({ erro: "Duração inválida. Especifique o tempo em minutos." });
        }

        if (!intensidade || !intensidadesValidas.includes(intensidade)) {
            return res.status(400).json({ erro: "Intensidade inválida. Escolha entre: leve, moderada ou forte." });
        }

        simulador.forcarChuvaManual(duracao, intensidade);
        res.json({ 
            mensagem: `Evento climático inserido. Chovendo em Engenheiro Coelho por ${duracao} minutos.`,
            condicaoCeu: simulador.state.condicaoCeu,
            intensidade: simulador.state.intensidadeChuva
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao processar injeção do evento climático." });
    }
});

// =============================================
// INICIALIZAÇÃO
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`====================================================================`);
    console.log(` ENGINE POOL OPERATIONAL - SIMULAÇÃO HORTA INTELIGENTE PORTA: ${PORT}`);
    console.log(`====================================================================`);
});
