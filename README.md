<h1 align="center">Server-Horta</h1>
  <h4 align="center">
    <a href="#sobre">Sobre</a> •
    <a href="#acesso-ao-servidor">Acesso ao Servidor</a> •
    <a href="#instalação">Instalação</a> •
    <a href="#tecnologias-utilizadas">Tecnologias Utilizadas</a>
  </h4>

<p align="center">
  <img src="https://img.shields.io/badge/status-em%20funcionamento-green" alt="Status">
  <img src="https://img.shields.io/badge/licence-open%20source-blue" alt="Licence">
  <img src="https://img.shields.io/badge/campus-UNASP--EC-orange" alt="Campus">
</p>

## Sobre

Este projeto é uma **API REST** desenvolvida para o Projeto Integrador (PI) do 5º semestre de Engenharia da Computação do **UNASP-EC**.

Inicialmente planejada para integrar com uma horta inteligente física, a API foi adaptada para funcionar como um **servidor de mock/simulação** de dados, permitindo o desenvolvimento e testes do frontend mesmo sem o hardware físico. Os dados simulados são persistidos em um banco **MongoDB Atlas** na nuvem, permitindo histórico contínuo mesmo após reinicializações do servidor.

## Acesso ao servidor

A API é pública e pode ser integrada diretamente no seu front-end ou consumida por ferramentas como Postman, Insomnia ou VS Code REST Client.

Está hospedada em dois ambientes — use o Azure como primário e o Render como fallback caso o Azure esteja indisponível.

| Ambiente | Base URL |
| -------- | -------- |
| Azure (primário) | `https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net` |
| Render (fallback) | `https://server-horta.onrender.com` |

### Endpoints Públicos de Leitura (GET)

* **Telemetria Básica:** Retorna os dados simplificados e estruturados de aquisição
  * Azure: [`/api/aquisicao`](https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/aquisicao)
  * Render: [`/api/aquisicao`](https://server-horta.onrender.com/api/aquisicao)

* **Telemetria Avançada:** Fornece o conjunto de metadados detalhado (condições ambientais, sensores do solo e estado dos atuadores).
  * Azure: [`/api/aquisicao/avancada`](https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/aquisicao/avancada)
  * Render: [`/api/aquisicao/avancada`](https://server-horta.onrender.com/api/aquisicao/avancada)

* **Histórico Completo:** Retorna todos os registros da simulação, ordenados por tempo, ideal para alimentar gráficos e dashboards.
  * Azure: [`/api/historico/completo`](https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/historico/completo)
  * Render: [`/api/historico/completo`](https://server-horta.onrender.com/api/historico/completo)

* **Histórico por Minuto:** Retorna os dados detalhados de um registro específico pelo seu `id`.
  * `/api/historico/minuto/:id` — Exemplo: `.../api/historico/minuto/42`

### Endpoints de Controle (POST)

Para interagir com o motor físico da simulação enviando payloads em JSON. Os exemplos abaixo usam a base URL do Azure; substitua pelo Render se necessário.

#### 1. Inserir Evento Climático (Forçar Chuva)

* **URL:** `.../api/controle/chuva`
* **Body (JSON):**

```json
    {
        "duracao": 20,
        "intensidade": "forte"
    }
```

#### 2. Sobrescrever Bomba de Irrigação (Modo Manual)

* **URL:** `.../api/controle/irrigacao`
* **Body (JSON):**

```json
    {
        "ligar": "true",
        "automatico": "false"
    }
```

#### 3. Devolver Controle de Irrigação ao Sistema Automático

> Faça isso depois de Sobrescrever Bomba de Irrigação

* **URL:** `.../api/controle/irrigacao`
* **Body (JSON):**

```json
    {
        "automatico": "true"
    }
```

#### 4. Reset Total da Simulação

> **Atenção:** apaga todo o histórico do banco e reinicia a simulação do zero.

* **URL:** `.../api/controle/reset-total`
* **Body:** nenhum (requisição POST vazia)

## Instalação

### Pré-requisitos

* Node.js (Recomendado v20 LTS ou superior)
* Git
* Uma instância MongoDB (local ou Atlas) — configure a URI via variável de ambiente

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
MONGO_URI=sua_connection_string_aqui
DB_NAME=horta_db_v2             # opcional, este é o padrão
COLLECTION_NAME=estado_simulacao  # opcional, este é o padrão
```

### Inicialização Local

```bash
git clone https://github.com/Gustavo-Vieira-Unasp/server-horta
cd server-horta
code .
npm install
node app.js
```

### Testes Locais

Após a inicialização com `node app.js` acesse os links GET ou use [`teste.http`](./teste.http)

> Em caso de uso do `teste.http` é recomendado a extensão `REST Client` no VS Code.

## Tecnologias Utilizadas

* **Runtime:** Node.js (v24.12)
* **Framework Web:** Express
* **Banco de Dados:** MongoDB Atlas (via driver oficial `mongodb`)
* **Configuração:** dotenv
* **Middleware:** CORS (Cross-Origin Resource Sharing habilitado)
* **Infraestrutura & CI/CD:** Azure App Service (Linux) & GitHub Actions
* **Hospedagem Alternativa:** Render
