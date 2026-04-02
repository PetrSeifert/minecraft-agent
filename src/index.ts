import { createBot } from "./bot/createBot";
import { loadConfig } from "./config";

async function main(): Promise<void> {
  const config = loadConfig();
  const authLabel = config.password ? `${config.auth}:password` : config.auth;

  console.log(
    `[bot] Connecting to ${config.host}:${config.port} as ${config.username} (${authLabel})`,
  );

  await createBot(config);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[startup] Failed to start bot:", message);
  process.exitCode = 1;
});
