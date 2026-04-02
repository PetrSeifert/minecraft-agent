import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { Vec3 } from "vec3";

import { EventStream } from "../src/agent/eventStream";
import { createSafetyModule } from "../src/agent/modules/safety";

function positionKey(position: Vec3): string {
  return `${position.x},${position.y},${position.z}`;
}

function createBlock(name: string, position: Vec3, boundingBox = "block") {
  return {
    boundingBox,
    name,
    position,
  };
}

function createSafetyBot(
  options: {
    blocks?: Array<ReturnType<typeof createBlock>>;
    fireFlag?: boolean;
    getPathTo?: (goal: { x: number; y: number; z: number }) => {
      status: "noPath" | "success" | "timeout";
    };
    position?: Vec3;
  } = {},
) {
  const blocks = new Map<string, ReturnType<typeof createBlock>>();

  for (const block of options.blocks ?? []) {
    blocks.set(positionKey(block.position), block);
  }

  return Object.assign(new EventEmitter(), {
    blockAt(position: Vec3) {
      return blocks.get(positionKey(position.floored())) ?? null;
    },
    entity: {
      metadata: [options.fireFlag ? 0x01 : 0],
      onGround: true,
      position: options.position ?? new Vec3(0, 64, 0),
    },
    food: 20,
    health: 20,
    oxygenLevel: 400,
    pathfinder: options.getPathTo
      ? {
          getPathTo(_movements: unknown, goal: { x: number; y: number; z: number }) {
            return options.getPathTo!(goal);
          },
        }
      : null,
  });
}

test("escapeDanger enters water instead of stopping beside it when extinguishing fire", async () => {
  const events = new EventStream();
  const bot = createSafetyBot({
    blocks: [
      createBlock("water", new Vec3(4, 64, 1), "empty"),
      createBlock("air", new Vec3(4, 65, 1), "empty"),
    ],
    fireFlag: true,
  });
  const gotoCalls: Array<{
    options?: Record<string, unknown>;
    position: { x: number; y: number; z: number };
    range?: number;
  }> = [];
  const safety = createSafetyModule(bot as never, {
    combat: {} as never,
    events,
    pathing: {
      get movements() {
        return {};
      },
      goto(
        position: { x: number; y: number; z: number },
        range?: number,
        options?: Record<string, unknown>,
      ) {
        gotoCalls.push({
          options,
          position,
          range,
        });
        return Promise.resolve({
          position,
          range: range ?? 0,
        });
      },
      moveAwayFrom() {
        return Promise.reject(new Error("not used"));
      },
      status() {
        return {
          building: false,
          goal: null,
          hasGoal: false,
          mining: false,
          moving: false,
          pausedMs: 0,
          physicsEnabled: true,
          physicsHoldMs: 0,
          ready: true,
        };
      },
    } as never,
    world: {
      findBlocksByName() {
        return [
          {
            position: { x: 4, y: 64, z: 1 },
          },
        ];
      },
      nearbyEntities() {
        return [];
      },
      nearestHostile() {
        return null;
      },
    } as never,
  });

  const result = await safety.escapeDanger("test_fire");

  assert.equal(result.action, "water_escape");
  assert.deepEqual(result.target, { x: 4, y: 64, z: 1 });
  assert.deepEqual(gotoCalls, [
    {
      options: { ignorePause: true },
      position: { x: 4, y: 64, z: 1 },
      range: 0,
    },
  ]);
});

test("escapeDanger skips unreachable safe tiles when pathfinder has a better reachable option", async () => {
  const candidateA = new Vec3(1, 64, 0);
  const candidateB = new Vec3(2, 64, 0);
  const events = new EventStream();
  const bot = createSafetyBot({
    blocks: [
      createBlock("stone", new Vec3(1, 63, 0)),
      createBlock("air", candidateA, "empty"),
      createBlock("air", candidateA.offset(0, 1, 0), "empty"),
      createBlock("stone", new Vec3(2, 63, 0)),
      createBlock("air", candidateB, "empty"),
      createBlock("air", candidateB.offset(0, 1, 0), "empty"),
      createBlock("stone", new Vec3(0, 64, 0)),
    ],
    getPathTo(goal) {
      if (goal.x === 1 && goal.y === 64 && goal.z === 0) {
        return { status: "noPath" };
      }

      if (goal.x === 2 && goal.y === 64 && goal.z === 0) {
        return { status: "success" };
      }

      return { status: "noPath" };
    },
  });
  const gotoCalls: Array<{ x: number; y: number; z: number }> = [];
  const safety = createSafetyModule(bot as never, {
    combat: {} as never,
    events,
    pathing: {
      get movements() {
        return {};
      },
      goto(position: { x: number; y: number; z: number }) {
        gotoCalls.push(position);
        return Promise.resolve({
          position,
          range: 0,
        });
      },
      moveAwayFrom() {
        return Promise.reject(new Error("not used"));
      },
      status() {
        return {
          building: false,
          goal: null,
          hasGoal: false,
          mining: false,
          moving: false,
          pausedMs: 0,
          physicsEnabled: true,
          physicsHoldMs: 0,
          ready: true,
        };
      },
    } as never,
    world: {
      findBlocksByName() {
        return [];
      },
      nearbyEntities() {
        return [];
      },
      nearestHostile() {
        return null;
      },
    } as never,
  });

  const result = await safety.escapeDanger("test_safe_tile");

  assert.equal(result.action, "move_to_safe_position");
  assert.deepEqual(result.target, { x: 2, y: 64, z: 0 });
  assert.deepEqual(
    gotoCalls.map((position) => ({ x: position.x, y: position.y, z: position.z })),
    [{ x: 2, y: 64, z: 0 }],
  );
});

test("escapeDanger times out stuck movement, stops pathing, and clears the in-progress flag", async () => {
  const events = new EventStream();
  const bot = createSafetyBot({
    blocks: [
      createBlock("water", new Vec3(4, 64, 1), "empty"),
      createBlock("air", new Vec3(4, 65, 1), "empty"),
    ],
    fireFlag: true,
  });
  let stopCalls = 0;
  const safety = createSafetyModule(
    bot as never,
    {
      combat: {} as never,
      events,
      pathing: {
        get movements() {
          return {};
        },
        goto() {
          return new Promise(() => {});
        },
        moveAwayFrom() {
          return Promise.reject(new Error("not used"));
        },
        status() {
          return {
            building: false,
            goal: null,
            hasGoal: false,
            mining: false,
            moving: true,
            pausedMs: 0,
            physicsEnabled: true,
            physicsHoldMs: 0,
            ready: true,
          };
        },
        stop() {
          stopCalls += 1;
        },
      } as never,
      world: {
        findBlocksByName() {
          return [
            {
              position: { x: 4, y: 64, z: 1 },
            },
          ];
        },
        nearbyEntities() {
          return [];
        },
        nearestHostile() {
          return null;
        },
      } as never,
    },
    {
      escapeActionTimeoutMs: 20,
    },
  );

  await assert.rejects(
    () => safety.escapeDanger("stuck_escape"),
    /Safety escape timed out after 20ms/,
  );

  assert.equal(stopCalls, 1);
  assert.equal(safety.status().escapeInProgress, false);
  assert.equal(
    events.recent(20).some((event) => event.type === "safety:escape_timeout"),
    true,
  );
});
