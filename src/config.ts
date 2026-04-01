import type { BotConfig } from './types';

const DEFAULT_HOST = 'localhost';
const DEFAULT_GOAL_PLANNER_INTERVAL_MS = 60_000;
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
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

function parsePositiveInteger(
  rawValue: string | undefined,
  fallback: number,
  label: string,
): number {
  const value = Number(rawValue ?? fallback);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label} value: "${rawValue}"`);
  }

  return value;
}

function parseOptionalEnv(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() || '';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const host = env.MC_HOST?.trim() || DEFAULT_HOST;
  const username = env.MC_USERNAME?.trim() || DEFAULT_USERNAME;
  const password = env.MC_PASSWORD?.trim() || undefined;
  const auth = parseAuth(env.MC_AUTH, Boolean(password));
  const version = env.MC_VERSION?.trim() || false;
  const openRouterApiKey = parseOptionalEnv(env, 'OPENROUTER_API_KEY');
  const openRouterModel = parseOptionalEnv(env, 'OPENROUTER_MODEL');
  const openRouterBaseUrl =
    env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL;
  const goalPlannerIntervalMs = parsePositiveInteger(
    env.GOAL_PLANNER_INTERVAL_MS,
    DEFAULT_GOAL_PLANNER_INTERVAL_MS,
    'GOAL_PLANNER_INTERVAL_MS',
  );
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
    openRouterApiKey,
    openRouterModel,
    openRouterBaseUrl,
    goalPlannerIntervalMs,
    debugKnockback,
    debugKnockbackFile,
  };
}
