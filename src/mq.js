import amqp from "amqplib";
import pino from "pino";

const log = pino({ name: "notification-service" });

// Exchange de eventos do domínio (onde chegam payment.requested/confirmed)
const EVENTS_EXCHANGE = process.env.EVENTS_EXCHANGE || "payments.x";   // tipo topic

// Nossas filas de consumo (uma por evento que queremos ouvir)
const QUEUES = [
  { name: "notification.payment.requested", bindingKey: "payment.requested" },
  { name: "notification.payment.confirmed", bindingKey: "payment.confirmed" },
];

// Dead Letter Exchange/Queue para mensagens "mortas"
const DLX_EXCHANGE = "notification.dlx"; // tipo topic
const DLQ_NAME = "notification.dlq";     // fila única para tudo do DLX

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);
const RETRY_DELAY_MS_BASE = parseInt(process.env.RETRY_DELAY_MS_BASE || "1000", 10);

let connection;
let channel;

/**
 * Publica com retry-count (quando falha o processamento)
 */
async function republishWithRetry(routingKey, contentBuffer, headers) {
  const current = parseInt(headers?.["x-retry-count"] || "0", 10) + 1;

  if (current <= MAX_RETRIES) {
    const delay = RETRY_DELAY_MS_BASE * Math.pow(2, current - 1); // backoff exponencial
    log.warn({ routingKey, retry: current, delay }, "Reenfileirando para retry");

    // Importante: ACK da mensagem original acontece no caller.
    // Aqui apenas agendamos a republicação com cabeçalho atualizado.
    setTimeout(() => {
      channel.publish(
        EVENTS_EXCHANGE,
        routingKey,
        contentBuffer,
        {
          persistent: true,
          headers: { ...(headers || {}), "x-retry-count": current }
        }
      );
    }, delay);
  } else {
    log.error({ routingKey, retries: current - 1 }, "Estourou retries; enviando para DLQ");
    channel.publish(
      DLX_EXCHANGE,
      routingKey,        // mantém a routing key original
      contentBuffer,
      { persistent: true, headers }
    );
  }
}

/**
 * Processamento de mensagem de forma "simples":
 * - Aqui estamos só logando. Em produção, chamaria e-mail/SMS/WhatsApp, etc.
 * - Para simular erro, se payload.fail === true, disparamos um erro.
 */
async function handleMessage(routingKey, msg) {
  try {
    const contentStr = msg.content.toString("utf8");
    const payload = JSON.parse(contentStr);

    // Simular falha controlada (útil para ver retry e DLQ funcionando):
    if (payload.fail === true) {
      throw new Error("Falha simulada no consumer de notificacao");
    }

    // Aqui você faria a integração real (e-mail, SMS, push...)
    log.info({ routingKey, payload, headers: msg.properties.headers }, "Notificação processada com sucesso");

    // ACK finaliza a mensagem
    channel.ack(msg);
  } catch (err) {
    log.error({ err: err.message, routingKey, headers: msg.properties.headers }, "Erro ao processar mensagem");

    // Estratégia de retry:
    // 1) ACK da original (para não ficar em loop de redelivery)
    // 2) Republishes com x-retry-count incrementado OU manda pra DLQ se estourou.
    const headers = msg.properties.headers || {};
    const body = msg.content; // Buffer original
    channel.ack(msg);
    await republishWithRetry(routingKey, body, headers);
  }
}

export async function startConsumers() {
  const amqpUrl = process.env.AMQP_URL;
  if (!amqpUrl) throw new Error("AMQP_URL não definida no .env");

  connection = await amqp.connect(amqpUrl);
  channel = await connection.createConfirmChannel(); // confirmChannel para publish seguro
  await channel.prefetch(10);

  // Exchanges
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DLX_EXCHANGE, "topic", { durable: true });

  // DLQ
  await channel.assertQueue(DLQ_NAME, { durable: true });
  await channel.bindQueue(DLQ_NAME, DLX_EXCHANGE, "#"); // tudo que morrer vem pra cá

  // Filas de consumo (cada uma com DLX configurado)
  for (const { name, bindingKey } of QUEUES) {
    await channel.assertQueue(name, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLX_EXCHANGE
      }
    });
    await channel.bindQueue(name, EVENTS_EXCHANGE, bindingKey);

    await channel.consume(name, (msg) => {
      if (!msg) return;
      const routingKey = msg.fields.routingKey;
      handleMessage(routingKey, msg).catch((err) => {
        // fallback absoluto: se algo estourar fora do fluxo, n-ack sem requeue
        // (na prática quase nunca cai aqui, porque usamos try/catch em handleMessage)
        log.error({ err: err.message }, "Erro inesperado no consumo; nacking sem requeue");
        channel.nack(msg, false, false);
      });
    }, { noAck: false });
  }

  log.info("Notification consumers iniciados. Aguardando mensagens...");
}

export async function close() {
  await channel?.close().catch(() => {});
  await connection?.close().catch(() => {});
}
