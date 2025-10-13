## 🧾 `README.md` — **ms-notification-service**

```md
# ms-notification-service

Serviço responsável por receber mensagens do **RabbitMQ** e notificar usuários sobre o andamento de seus pagamentos.  
Opera de forma independente do `ms-payment-service`.

---

## 🧱 Infraestrutura
A infraestrutura compartilhada (Postgres + RabbitMQ) está disponível no repositório:
👉 [ms-infra](https://github.com/moreiraanaju/ms_infra)

---

## 🧱 Arquitetura

RabbitMQ (exchange: payments.x)
├─ notifications.payment.requested.q → evento payment.requested
└─ notifications.payment.confirmed.q → evento payment.confirmed
↳ DLQ: notifications.dlq (retry até 3x)

---

## ⚙️ Requisitos

- Node.js LTS  
- RabbitMQ ativo (compose do projeto)

---

## 🚀 Como executar

1. Criar `.env`:
AMQP_URL=amqp://guest:guest@localhost:5672

2. Instalar dependências e iniciar:
```bash
npm install
node src/index.js
Ao iniciar, o serviço cria automaticamente as filas e começa a consumir mensagens.

## 📨 Eventos consumidos

payment.requested
Simula envio de notificação: “Recebemos sua solicitação de pagamento.”

payment.confirmed
Simula envio de notificação: “Pagamento confirmado com sucesso.”

---

## Logs exibem:

Notify: payment requested
Notify: payment confirmed

---

## 🧰 Robustez

Retry automático (até 3 tentativas)
DLQ (notifications.dlq) para mensagens que falham repetidamente
Logs estruturados (Pino)
Script auxiliar (`scripts/publish.js`) para publicar mensagens de teste diretamente na exchange `payments.x`, facilitando a validação do fluxo sem precisar acionar o serviço de pagamento.

## 📁 Estrutura
ms_notification_service/
├─ src/
│ ├─ index.js
│ └─ mq.js
├─ scripts/
│ └─ publish.js
├─ .env
├─ package.json
└─ README.md