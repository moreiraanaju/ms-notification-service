import "dotenv/config";
import pino from "pino";
import { startConsumers } from "./mq.js";

const log = pino({ name: "notification-service:bootstrap" });

(async () => {
  try {
    await startConsumers();
    log.info("Service up. Pressione Ctrl+C para sair.");
  } catch (err) {
    log.error({ err: err.message }, "Falha ao subir consumidores");
    process.exit(1);
  }
})();

// Encerrar limpo
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
