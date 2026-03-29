import assert from 'node:assert/strict';
import test from 'node:test';

import { terminalInternals } from '../src/bot/terminal';

test('help text includes inspect command', () => {
  assert.match(terminalInternals.helpText(), /\/inspect \[distance\]/);
});

test('inspect command returns serialized visible-area output and forwards optional distance', async () => {
  const calls: Array<number | undefined> = [];
  const payload = {
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
    highlights: ['block: barrel (1.0)'],
    visibleBlocks: [
      {
        biome: 'plains',
        boundingBox: 'block',
        diggable: true,
        distance: 1,
        name: 'barrel',
        position: { x: 1, y: 64, z: 0 },
      },
    ],
    visibleEntities: [],
  };
  const agent = {
    world: {
      inspectVisibleArea(options?: { maxDistance?: number }) {
        calls.push(options?.maxDistance);
        return payload;
      },
    },
  };
  const bot = {
    quit() {},
  };

  const defaultOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    '/inspect',
  );
  const overrideOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    '/inspect 12',
  );

  assert.deepEqual(calls, [undefined, 12]);
  assert.deepEqual(JSON.parse(defaultOutput ?? 'null'), payload);
  assert.deepEqual(JSON.parse(overrideOutput ?? 'null'), payload);
});
