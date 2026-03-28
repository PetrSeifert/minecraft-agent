const { createBot } = require('./bot/createBot');
const { loadConfig } = require('./config');

function main() {
  const config = loadConfig();
  const authLabel = config.password ? `${config.auth}:password` : config.auth;

  console.log(
    `[bot] Connecting to ${config.host}:${config.port} as ${config.username} (${authLabel})`,
  );

  createBot(config);
}

try {
  main();
} catch (error) {
  console.error('[startup] Failed to start bot:', error.message);
  process.exitCode = 1;
}
