import type { BotConfig } from './types';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 25565;
const DEFAULT_USERNAME = 'MineflayerBot';

function parsePort(rawPort: string | undefined): number {
  const port = Number(rawPort ?? DEFAULT_PORT);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid MC_PORT value: "${rawPort}"`);
  }

  return port;
}

function parseAuth(rawAuth: string | undefined, hasPassword: boolean): BotConfig['auth'] {
  const auth = rawAuth?.trim() || (hasPassword ? 'microsoft' : 'offline');

  if (auth === 'microsoft' || auth === 'mojang' || auth === 'offline') {
    return auth;
  }

  throw new Error(`Invalid MC_AUTH value: "${rawAuth}"`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const host = env.MC_HOST?.trim() || DEFAULT_HOST;
  const username = env.MC_USERNAME?.trim() || DEFAULT_USERNAME;
  const password = env.MC_PASSWORD?.trim() || undefined;
  const auth = parseAuth(env.MC_AUTH, Boolean(password));
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
