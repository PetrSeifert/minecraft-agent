const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 25565;
const DEFAULT_USERNAME = 'MineflayerBot';

function parsePort(rawPort) {
  const port = Number(rawPort ?? DEFAULT_PORT);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MC_PORT value: "${rawPort}"`);
  }

  return port;
}

function loadConfig(env = process.env) {
  const host = env.MC_HOST?.trim() || DEFAULT_HOST;
  const username = env.MC_USERNAME?.trim() || DEFAULT_USERNAME;
  const password = env.MC_PASSWORD?.trim() || undefined;
  const auth = env.MC_AUTH?.trim() || (password ? 'microsoft' : 'offline');
  const version = env.MC_VERSION?.trim() || false;
  const debugKnockback =
    env.MC_DEBUG_KNOCKBACK?.trim() === '1' ||
    env.MC_DEBUG_KNOCKBACK?.trim()?.toLowerCase() === 'true';
  const debugKnockbackFile =
    env.MC_DEBUG_KNOCKBACK_FILE?.trim() || 'knockback-debug.log';

  return {
    host,
    port: parsePort(env.MC_PORT),
    username,
    password,
    auth,
    version,
    debugKnockback,
    debugKnockbackFile,
  };
}

module.exports = {
  loadConfig,
};
