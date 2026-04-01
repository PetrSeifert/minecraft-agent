import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOpenRouterGoalClient,
  openRouterClientInternals,
} from '../src/llm/openRouterClient';

import type { OrchestrationSnapshot } from '../src/types';

function createSnapshot(): OrchestrationSnapshot {
  return {
    memory: {
      longTerm: [],
      shortTerm: {
        events: [],
        summaries: [],
      },
      working: [],
    },
    perception: {
      containers: [],
      hostiles: [],
      nearbyBlocks: ['oak_log'],
      nearbyEntities: [],
      recentChat: [],
      recentEvents: [],
      shelters: [],
      visibleArea: {
        focus: {
          blockAtCursor: null,
          entityAtCursor: null,
        },
        hazards: [],
        heading: {
          cardinal: 'south',
          pitch: 0,
          yaw: 0,
        },
        highlights: [],
        visibleBlocks: [],
        visibleEntities: [],
      },
    },
    planning: {
      currentGoal: null,
      currentSkill: undefined,
      planner: null,
      plan: [],
      recentFailures: [],
    },
    self: {
      biome: 'plains',
      equipped: [],
      health: 20,
      hunger: 20,
      inventory: {},
      position: { x: 0, y: 64, z: 0 },
      risk: 'low',
      timeOfDay: 'day',
    },
  };
}

test('OpenRouter client sends the expected request and parses goal JSON', async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  const client = createOpenRouterGoalClient({
    apiKey: 'test-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/test-model',
  }, async (url, init) => {
    requests.push({
      init,
      url: String(url),
    });

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '{"goal":"Gather nearby wood"}',
          },
        },
      ],
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  const goal = await client.chooseGoal(createSnapshot());

  assert.equal(goal, 'Gather nearby wood');
  assert.equal(requests[0]?.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(requests[0]?.init?.method, 'POST');

  const body = JSON.parse(String(requests[0]?.init?.body));

  assert.equal(body.model, 'openrouter/test-model');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.match(body.messages[1].content, /"snapshot":/);
});

test('OpenRouter client rejects malformed and empty goal responses', async () => {
  const malformedClient = createOpenRouterGoalClient({
    apiKey: 'test-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/test-model',
  }, async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: 'not json',
        },
      },
    ],
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  }));

  const emptyGoalClient = createOpenRouterGoalClient({
    apiKey: 'test-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/test-model',
  }, async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: '{"goal":"   "}',
        },
      },
    ],
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  }));

  await assert.rejects(
    () => malformedClient.chooseGoal(createSnapshot()),
    /OpenRouter response was not valid JSON/,
  );
  await assert.rejects(
    () => emptyGoalClient.chooseGoal(createSnapshot()),
    /OpenRouter goal must be a non-empty string/,
  );
});

test('OpenRouter client surfaces non-JSON error responses with HTTP status context', async () => {
  const client = createOpenRouterGoalClient({
    apiKey: 'test-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/test-model',
  }, async () => new Response('upstream gateway failed', {
    status: 502,
    headers: {
      'Content-Type': 'text/plain',
    },
  }));

  await assert.rejects(
    () => client.chooseGoal(createSnapshot()),
    /OpenRouter request failed \(502\): upstream gateway failed/,
  );
});

test('OpenRouter client fails fast when planner credentials are missing', async () => {
  const client = createOpenRouterGoalClient({
    apiKey: '   ',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
  });

  await assert.rejects(
    () => client.chooseGoal(createSnapshot()),
    /OpenRouter API key is not configured/,
  );
});

test('parseGoalResponse accepts fenced JSON and enforces exact shape', () => {
  assert.equal(
    openRouterClientInternals.parseGoalResponse('```json\n{"goal":"Find shelter"}\n```'),
    'Find shelter',
  );
  assert.throws(
    () => openRouterClientInternals.parseGoalResponse('{"goal":"Find shelter","extra":true}'),
    /exactly one "goal" field/,
  );
});
