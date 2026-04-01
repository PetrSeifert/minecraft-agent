import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config';

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MC_AUTH: 'offline',
    MC_HOST: 'localhost',
    MC_PORT: '25565',
    MC_USERNAME: 'MineflayerBot',
    ...overrides,
  };
}

test('loadConfig applies default OpenRouter base URL and planner and executor intervals', () => {
  const config = loadConfig(createEnv({
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_MODEL: 'openrouter/test-model',
  }));

  assert.equal(config.openRouterBaseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(config.goalExecutorIntervalMs, 5_000);
  assert.equal(config.goalPlannerIntervalMs, 60_000);
  assert.equal(config.openRouterApiKey, 'test-key');
  assert.equal(config.openRouterModel, 'openrouter/test-model');
});

test('loadConfig leaves OpenRouter credentials blank when planner is not configured', () => {
  const config = loadConfig(createEnv({
    OPENROUTER_API_KEY: '   ',
    OPENROUTER_MODEL: '',
  }));

  assert.equal(config.openRouterApiKey, '');
  assert.equal(config.openRouterModel, '');
});

test('loadConfig validates planner interval', () => {
  assert.throws(
    () => loadConfig(createEnv({ GOAL_PLANNER_INTERVAL_MS: '0' })),
    /Invalid GOAL_PLANNER_INTERVAL_MS value/,
  );
});

test('loadConfig validates executor interval', () => {
  assert.throws(
    () => loadConfig(createEnv({ GOAL_EXECUTOR_INTERVAL_MS: '0' })),
    /Invalid GOAL_EXECUTOR_INTERVAL_MS value/,
  );
});
