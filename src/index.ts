import { createBot } from './bot/createBot';
import { loadConfig } from './config';

function main(): void {
  const config = loadConfig();
  const authLabel = config.password ? `${config.auth}:password` : config.auth;

  console.log(
    `[bot] Connecting to ${config.host}:${config.port} as ${config.username} (${authLabel})`,
  );

  createBot(config);
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[startup] Failed to start bot:', message);
  process.exitCode = 1;
}
