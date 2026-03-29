import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { EventStream } from '../src/agent/eventStream';
import { instrumentAsyncOperation } from '../src/agent/operationEvents';
import {
  createMemoryModule,
  memoryInternals,
} from '../src/agent/modules/memory';

import type {
  SafetyStatus,
  SerializedEntity,
  ShortTermEvent,
  ShortTermSummary,
} from '../src/types';

function createMemoryBot() {
  return Object.assign(new EventEmitter(), {
    entity: {
      id: 1,
      metadata: [],
      position: null,
    },
    username: 'TestBot',
  });
}

function createSafetyStatus(overrides: Partial<SafetyStatus> = {}): SafetyStatus {
  return {
    blocks: {
      feet: null,
      ground: null,
      head: null,
    },
    drowning: false,
    health: 20,
    hostiles: [],
    inLava: false,
    inWater: false,
    mobAggro: false,
    monitorEnabled: true,
    onFire: false,
    oxygenLevel: 400,
    pathing: {
      building: false,
      goal: null,
      hasGoal: false,
      mining: false,
      moving: false,
      pausedMs: 0,
      physicsEnabled: true,
      physicsHoldMs: 0,
      ready: true,
    },
    position: null,
    recentSelfHurt: false,
    ...overrides,
  };
}

function createSerializedEntity(
  overrides: Partial<SerializedEntity> = {},
): SerializedEntity {
  return {
    displayName: null,
    height: null,
    id: null,
    kind: null,
    name: null,
    position: null,
    type: null,
    username: null,
    velocity: null,
    ...overrides,
  };
}

function makeEvent(
  id: number,
  type: ShortTermEvent['type'],
  text: string,
  options: {
    payload?: unknown;
    priority?: number;
    tags?: string[];
    timestamp?: string;
  } = {},
): ShortTermEvent {
  return {
    id,
    payload: options.payload,
    priority: options.priority,
    sourceEventId: null,
    sourceType: null,
    tags: options.tags ?? [],
    text,
    timestamp: options.timestamp ?? `2026-01-01T00:00:${String(id).padStart(2, '0')}.000Z`,
    type,
  };
}

function makeSummary(
  text: string,
  timestamp = '2026-01-01T00:01:00.000Z',
  tags: string[] = ['summary'],
): ShortTermSummary {
  return {
    endEventId: 10,
    startEventId: 1,
    tags,
    text,
    timestamp,
  };
}

test('memory normalizes chat events and goal updates', () => {
  const bot = createMemoryBot();
  const events = new EventStream();
  const memory = createMemoryModule(bot as never, {
    events,
    safety: {
      status: () => createSafetyStatus(),
    } as never,
  }, {
    autoSummarize: false,
  });

  memory.setGoal('Find shelter');
  events.push('chat:public', { text: 'hello there', username: 'Alex' });

  const rawTypes = events.recent(10).map((event) => event.type);
  const shortTerm = memory.state().shortTerm.events;

  assert.ok(rawTypes.includes('goal:update'));
  assert.equal(shortTerm[0]?.type, 'goal_update');
  assert.equal(shortTerm[1]?.type, 'dialogue_received');
  assert.equal(shortTerm[1]?.text, '<Alex> hello there');
});

test('instrumented async operations emit normalized action lifecycle events', async () => {
  const bot = createMemoryBot();
  const events = new EventStream();
  const memory = createMemoryModule(bot as never, {
    events,
    safety: {
      status: () => createSafetyStatus(),
    } as never,
  }, {
    autoSummarize: false,
  });

  const operation = instrumentAsyncOperation<[string, boolean?], string>(events, {
    action: 'test.operation',
    failure: ([label], error) => ({
      priority: 8,
      tags: ['test'],
      text: `Failed ${label}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([label]) => ({
      priority: 4,
      tags: ['test'],
      text: `Starting ${label}`,
    }),
    success: ([label]) => ({
      priority: 6,
      tags: ['test'],
      text: `Finished ${label}`,
    }),
  }, async (label: string, shouldFail = false) => {
    if (shouldFail) {
      throw new Error('boom');
    }

    return label.toUpperCase();
  });

  await operation('first');
  await assert.rejects(() => operation('second', true), /boom/);

  const shortTerm = memory.state().shortTerm.events;
  const eventTypes = shortTerm.map((event) => event.type);

  assert.deepEqual(eventTypes, [
    'action_start',
    'action_success',
    'action_start',
    'action_failure',
  ]);
  assert.equal(shortTerm[3]?.text, 'Failed second: boom');
});

test('summaries only compact unsummarized events and preserve important facts', () => {
  const bot = createMemoryBot();
  const events = new EventStream();
  const memory = createMemoryModule(bot as never, {
    events,
    safety: {
      status: () =>
        createSafetyStatus({
          nearestThreat: createSerializedEntity({
            name: 'zombie',
          }),
        }),
    } as never,
  }, {
    autoSummarize: false,
  });

  memory.setGoal('Build shelter');
  events.push('chat:public', { text: 'Night is coming', username: 'Alex' });
  events.push('action:success', {
    action: 'actions.craftItem',
    tags: ['actions', 'craft'],
    text: 'Crafted 8 planks',
  });
  events.push('action:failure', {
    action: 'actions.placeBlockAt',
    tags: ['actions', 'place'],
    text: 'Failed to place oak_planks: occupied',
  });
  events.push('entity:spawn', {
    name: 'zombie',
    type: 'mob',
  });

  const firstSummary = memory.summarizeNow();

  assert.ok(firstSummary);
  assert.match(firstSummary!.text, /Goal updated: Build shelter|Goal: Build shelter/);
  assert.match(firstSummary!.text, /Failures:/);
  assert.match(firstSummary!.text, /Successes:/);
  assert.match(firstSummary!.text, /Dialogue:/);
  assert.match(firstSummary!.text, /Observations:/);
  assert.equal(memory.summarizeNow(), null);

  events.push('action:success', {
    action: 'pathing.goto',
    tags: ['pathing', 'movement'],
    text: 'Reached 10,64,10 within range 0',
  });

  const secondSummary = memory.summarizeNow();

  assert.ok(secondSummary);
  assert.ok((secondSummary?.startEventId ?? 0) > (firstSummary?.endEventId ?? 0));
});

test('working memory stays capped and prioritizes failures above routine observations', () => {
  const nowMs = Date.parse('2026-01-01T00:10:00.000Z');
  const events = Array.from({ length: 14 }, (_value, index) =>
    makeEvent(index + 1, 'dialogue_received', `dialogue ${index + 1}`, {
      priority: 3,
      tags: ['dialogue'],
    }),
  );

  events.push(
    makeEvent(20, 'observation', 'Nearby threat spotted: zombie', {
      priority: 5,
      tags: ['observation', 'threat'],
    }),
  );
  events.push(
    makeEvent(21, 'action_failure', 'Failed to mine oak_log: out of reach', {
      payload: { action: 'actions.mineBlockAt' },
      priority: 9,
      tags: ['action', 'failure'],
    }),
  );

  const working = memoryInternals.buildWorkingMemory(
    nowMs,
    null,
    events,
    [],
    createSafetyStatus(),
  );

  assert.ok(working.length <= 12);
  assert.ok(working[0]?.tags.includes('failure'));
  assert.ok(working.some((item) => item.text === 'Failed to mine oak_log: out of reach'));
});

test('working memory drops expired transient items, dedupes reminders, and reflects active threats', () => {
  const baseNowMs = Date.parse('2026-01-01T00:00:00.000Z');
  const successEvent = makeEvent(1, 'action_success', 'Crafted 4 planks', {
    payload: { action: 'actions.craftItem' },
    priority: 6,
    tags: ['action', 'success'],
    timestamp: '2026-01-01T00:00:00.000Z',
  });
  const summaries = [
    makeSummary('Keep building shelter'),
    makeSummary('Keep building shelter'),
  ];

  const activeThreatWorking = memoryInternals.buildWorkingMemory(
    baseNowMs,
    'Build shelter',
    [successEvent],
    summaries,
    createSafetyStatus({
      nearestThreat: createSerializedEntity({
        name: 'zombie',
      }),
    }),
  );

  assert.ok(activeThreatWorking.some((item) => item.text === 'Build shelter'));
  assert.ok(activeThreatWorking.some((item) => item.text === 'Crafted 4 planks'));
  assert.equal(
    activeThreatWorking.filter((item) => item.tags.includes('summary')).length,
    1,
  );
  assert.ok(activeThreatWorking.some((item) => item.text === 'Nearby threat: zombie'));

  const staleWorking = memoryInternals.buildWorkingMemory(
    baseNowMs + 91_000,
    'Build shelter',
    [successEvent],
    summaries,
    createSafetyStatus(),
  );

  assert.ok(!staleWorking.some((item) => item.text === 'Crafted 4 planks'));
  assert.ok(!staleWorking.some((item) => item.text === 'Nearby threat: zombie'));
});
