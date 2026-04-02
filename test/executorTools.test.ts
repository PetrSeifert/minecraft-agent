import assert from "node:assert/strict";
import test from "node:test";

import { EventStream } from "../src/agent/eventStream";
import { createExecutorToolRegistry } from "../src/agent/modules/executorTools";

test("goto_named_block resolves a live block before pathing", async () => {
  const serializedBlock = {
    biome: "plains",
    boundingBox: "block",
    diggable: true,
    name: "oak_log",
    position: { x: 3, y: 64, z: 1 },
  };
  const liveBlock = {
    boundingBox: "block",
    name: "oak_log",
    position: { x: 3, y: 64, z: 1 },
  };
  const gotoBlockCalls: unknown[] = [];
  const registry = createExecutorToolRegistry({
    actions: {} as never,
    chat: {
      history() {
        return [];
      },
      say() {
        return { text: "" };
      },
    } as never,
    combat: {} as never,
    events: new EventStream(),
    inventory: {} as never,
    memory: {
      currentGoal() {
        return "gather wood";
      },
      setGoal() {
        return { goal: null };
      },
    } as never,
    pathing: {
      gotoBlock(block: unknown, range?: number) {
        gotoBlockCalls.push(block);
        return Promise.resolve({
          block: "oak_log",
          position: { x: 3, y: 64, z: 1 },
          range: range ?? 1,
        });
      },
    } as never,
    safety: {} as never,
    world: {
      findBlockByName() {
        return serializedBlock;
      },
      getBlockAt() {
        return liveBlock;
      },
    } as never,
  });

  const invocation = await registry.invoke({
    args: {
      name: "oak_log",
      range: 2,
    },
    tool: "goto_named_block",
  });

  assert.equal(invocation.outcome, "action");
  assert.deepEqual(gotoBlockCalls, [liveBlock]);
  assert.equal((invocation.result as { movement: { range: number } }).movement.range, 2);
});

test("open_container_at returns a JSON-serializable result without the live container handle", async () => {
  let closeCalls = 0;
  const registry = createExecutorToolRegistry({
    chat: {
      history() {
        return [];
      },
      say() {
        return { text: "" };
      },
    } as never,
    actions: {
      openContainerAt() {
        return Promise.resolve({
          block: {
            biome: "plains",
            boundingBox: "block",
            diggable: true,
            name: "chest",
            position: { x: 1, y: 64, z: 1 },
          },
          container: {
            close() {
              closeCalls += 1;
            },
          },
          items: [
            {
              count: 3,
              name: "apple",
              type: 1,
            },
          ],
          window: {
            id: 5,
            slotCount: 27,
            title: "Chest",
            type: "minecraft:generic_9x3",
          },
        });
      },
    } as never,
    combat: {} as never,
    events: new EventStream(),
    inventory: {} as never,
    memory: {
      currentGoal() {
        return "loot chest";
      },
      setGoal() {
        return { goal: null };
      },
    } as never,
    pathing: {} as never,
    safety: {} as never,
    world: {} as never,
  });

  const invocation = await registry.invoke({
    args: {
      position: { x: 1, y: 64, z: 1 },
    },
    tool: "open_container_at",
  });

  assert.equal(invocation.outcome, "action");
  assert.equal(closeCalls, 1);
  assert.equal(
    JSON.stringify(invocation.result),
    JSON.stringify({
      block: {
        biome: "plains",
        boundingBox: "block",
        diggable: true,
        name: "chest",
        position: { x: 1, y: 64, z: 1 },
      },
      items: [
        {
          count: 3,
          name: "apple",
          type: 1,
        },
      ],
      window: {
        id: 5,
        slotCount: 27,
        title: "Chest",
        type: "minecraft:generic_9x3",
      },
    }),
  );
});
