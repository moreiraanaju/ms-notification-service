// scripts/publish.js
import amqp from "amqplib";
import "dotenv/config";
import { randomUUID } from "crypto";

const AMQP_URL = process.env.AMQP_URL || "amqp://guest:guest@localhost:5672";
const EXCHANGE = process.env.EXCHANGE || "payments.x"; 
const TYPE = process.argv[2] || "requested";           // uso: node scripts/publish.js requested|confirmed [--fail]
const FAIL = process.argv.includes("--fail");

function buildPayload(kind) {
  const traceId = randomUUID();
  const paymentId = randomUUID();
  const base = {
    paymentId,
    user: { id: "u1", email: FAIL ? "fail@example.com" : "aluno@exemplo.com" },
    amount: 129.9,
    currency: "BRL",
    timestamp: new Date().toISOString(),
    traceId
  };

  if (kind === "requested") {
    return { eventType: "payment.requested", ...base, ...(FAIL ? { fail: true } : {}) };
  }
  if (kind === "confirmed") {
    return { eventType: "payment.confirmed", ...base };
  }
  throw new Error(`Tipo inválido: ${kind}. Use "requested" ou "confirmed".`);
}

function routingKey(kind) {
  return kind === "requested" ? "payment.requested" : "payment.confirmed";
}

async function main() {
  const kind = TYPE === "confirmed" ? "confirmed" : "requested";
  const rk = routingKey(kind);
  const payload = buildPayload(kind);

  const conn = await amqp.connect(AMQP_URL);
  const ch = await conn.createConfirmChannel();

  await ch.assertExchange(EXCHANGE, "topic", { durable: true });

  const buf = Buffer.from(JSON.stringify(payload));
  const ok = ch.publish(EXCHANGE, rk, buf, {
    persistent: true,
    contentType: "application/json",
    messageId: payload.paymentId,
    correlationId: payload.traceId,
    headers: {
      "x-retry-count": 0,      
      "x-trace-id": payload.traceId
    }
  });

  if (!ok) {
    console.warn("Backpressure: publish retornou false. Aguardando confirmação…");
  }

  console.log("Publicado:", rk, payload);
  await ch.waitForConfirms();
  await ch.close();
  await conn.close();
  console.log("Done.");
}

main().catch((e) => {
  console.error("Publisher error:", e);
  process.exit(1);
});
