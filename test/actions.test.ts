import assert from "node:assert/strict";
import test from "node:test";

import { Vec3 } from "vec3";

import { EventStream } from "../src/agent/eventStream";
import { createActionsModule } from "../src/agent/modules/actions";

test("mineBlockAt refreshes the target block after pathing and digs with a raycast face", async () => {
  const initialBlock = {
    biome: { name: "plains" },
    boundingBox: "block",
    diggable: true,
    name: "stone",
    position: new Vec3(3, 64, 1),
    type: 1,
  };
  const liveBlock = {
    ...initialBlock,
    metadata: 7,
  };
  const getBlockAtCalls: unknown[] = [];
  const gotoLookAtCalls: unknown[] = [];
  const equipCalls: unknown[] = [];
  const digCalls: unknown[] = [];
  let getBlockAtCount = 0;

  const actions = createActionsModule(
    {
      canDigBlock(block: unknown) {
        return block === liveBlock;
      },
      dig(block: unknown, forceLook: boolean, digFace: string) {
        digCalls.push({ block, digFace, forceLook });
        return Promise.resolve();
      },
      entity: {
        position: new Vec3(0, 64, 0),
      },
      equip(item: unknown, destination: string) {
        equipCalls.push({ destination, item });
        return Promise.resolve();
      },
      pathfinder: {
        bestHarvestTool(block: unknown) {
          assert.equal(block, liveBlock);
          return {
            count: 1,
            name: "iron_pickaxe",
            type: 257,
          };
        },
      },
    } as never,
    {
      events: new EventStream(),
      inventory: {} as never,
      pathing: {
        gotoLookAt(position: unknown, reach: number) {
          gotoLookAtCalls.push({ position, reach });
          return Promise.resolve({
            position,
            reach,
          });
        },
      } as never,
      world: {
        getBlockAt(position: unknown) {
          getBlockAtCalls.push(position);
          getBlockAtCount += 1;
          return getBlockAtCount === 1 ? initialBlock : liveBlock;
        },
      } as never,
    },
  );

  const minedBlock = await actions.mineBlockAt({ x: 3, y: 64, z: 1 });

  assert.deepEqual(gotoLookAtCalls, [
    {
      position: initialBlock.position,
      reach: 4.5,
    },
  ]);
  assert.deepEqual(equipCalls, [
    {
      destination: "hand",
      item: {
        count: 1,
        name: "iron_pickaxe",
        type: 257,
      },
    },
  ]);
  assert.deepEqual(digCalls, [
    {
      block: liveBlock,
      digFace: "raycast",
      forceLook: true,
    },
  ]);
  assert.equal(getBlockAtCalls.length, 2);
  assert.equal(minedBlock?.metadata, 7);
});
