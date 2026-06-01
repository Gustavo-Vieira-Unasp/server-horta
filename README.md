<h1 align="center">Server-Horta</h1>
  <h4 align="center">
    <a href="#sobre">Sobre</a> •
    <a href="#acesso-ao-servidor">Acesso ao Servidor</a> •
    <a href="#instalação">Instalação</a> •
    <a href="#tecnologias-utilizadas">Tecnologias Utilizadas</a>
  </h4>

<p align="center">
  <img src="https://img.shields.io/badge/status-em%20funcionamento-green" alt="Status">
  <img src="https://img.shields.io/badge/licença-open%20source-blue" alt="Licença">
  <img src="https://img.shields.io/badge/campus-UNASP--EC-orange" alt="Campus">
</p>

## Sobre

Este projeto é uma **API REST** desenvolvida para o Projeto Integrador (PI) do 5º semestre de Engenharia da Computação do **UNASP-EC**.

Inicialmente planejada para integrar com uma horta inteligente física, a API foi adaptada para funcionar como um **servidor de mock/simulação** de dados, permitindo o desenvolvimento e testes do frontend mesmo sem o hardware físico.

## Acesso ao servidor

A API é pública e está hospedada no Azure App Services e pode ser integrada diretamente no seu front-end ou consumida por ferramentas como Postman, Insomnia ou VS Code REST Client.

### Endpoints Públicos de Leitura (GET)

* **Telemetria Básica:** Retorna os dados simplificados e estruturados de aquisição
  * [`https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/aquisicao`](https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/aquisicao)

* **Telemetria Avançada:** Fornece o conjunto de metadados detalhado (condições ambientais, sensores do solo e estado dos atuadores).
  * [`https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/aquisicao/avancada`](https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/aquisicao/avancada)

### Endpoints de Controle (POST)

Para interagir com o motor físico da simulação enviando payloads em JSON:

#### 1. Inserir Evento Climático (Forçar Chuva)

* **URL:** `https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/controle/chuva`
* **Body (JSON):**

    ```json
    {
        "duracao": 20,
        "intensidade": "forte"
    }
    ```

#### 2. Sobrescrever Bomba de Irrigação (Modo Manual)

* **URL:** `https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/controle/irrigacao`
* **Body (JSON):**

    ```json
    {
        "ligar": "true",
        "automatico": "false"
    }
    ```

#### 3. Devolver Controle de Irrigação ao Sistema Automático

> Faça isso depois de Sobrescrever Bomba de Irrigação

* **URL:** `https://horta-api-htggarb3eagagpgm.brazilsouth-01.azurewebsites.net/api/controle/irrigacao`
* **Body (JSON):**

    ```json
    {
        "automatico": "true"
    }
    ```

## Instalação

### Pré-requisitos

* Node.js (Recomendado v20 LTS ou superior)
* Git

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
* **Middleware:** CORS (Cross-Origin Resource Sharing habilitado)
* **Infraestrutura & CI/CD:** Azure App Service (Linux) & GitHub Actions
