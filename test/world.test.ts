import assert from "node:assert/strict";
import { test } from "vitest";

import { Vec3 } from "vec3";

import { createWorldModule } from "../src/agent/modules/world";

function positionKey(position: Vec3): string {
  return `${position.x},${position.y},${position.z}`;
}

function createBlock(
  name: string,
  position: Vec3,
  options: {
    biome?: string;
    boundingBox?: string;
    diggable?: boolean;
  } = {},
) {
  return {
    biome: options.biome ? { name: options.biome } : null,
    boundingBox: options.boundingBox ?? "block",
    diggable: options.diggable ?? true,
    name,
    position,
  };
}

function createEntity(
  name: string,
  position: Vec3,
  options: {
    id?: number;
    type?: string;
    username?: string;
  } = {},
) {
  return {
    id: options.id ?? 0,
    name,
    position,
    type: options.type ?? "mob",
    username: options.username ?? null,
    velocity: new Vec3(0, 0, 0),
  };
}

function createFakeBot(
  options: {
    blockAtCursor?: ReturnType<typeof createBlock> | null;
    blocks?: Array<ReturnType<typeof createBlock>>;
    canSeeBlock?: (block: ReturnType<typeof createBlock>) => boolean;
    entities?: Array<ReturnType<typeof createEntity>>;
    entityAtCursor?: ReturnType<typeof createEntity> | null;
    pitch?: number;
    position?: Vec3 | null;
    yaw?: number;
  } = {},
) {
  const blocks = new Map<string, ReturnType<typeof createBlock>>();
  const entities = new Map<number, ReturnType<typeof createEntity>>();

  for (const block of options.blocks ?? []) {
    blocks.set(positionKey(block.position), block);
  }

  for (const entity of options.entities ?? []) {
    entities.set(entity.id, entity);
  }

  return {
    blockAt(position: Vec3) {
      return blocks.get(positionKey(position.floored())) ?? null;
    },
    blockAtCursor() {
      return options.blockAtCursor ?? null;
    },
    canSeeBlock(block: ReturnType<typeof createBlock>) {
      return options.canSeeBlock ? options.canSeeBlock(block) : true;
    },
    entities: Object.fromEntries(entities.entries()),
    entity: {
      pitch: options.pitch ?? 0,
      position: options.position === undefined ? new Vec3(0, 64, 0) : options.position,
      yaw: options.yaw ?? 0,
    },
    entityAtCursor() {
      return options.entityAtCursor ?? null;
    },
    nearestEntity() {
      return null;
    },
    players: {},
  };
}

test("inspectVisibleArea reports full-radius blocks on all sides independent of yaw", () => {
  const blocks = [
    createBlock("stone", new Vec3(1, 64, 0), { biome: "plains" }),
    createBlock("dirt", new Vec3(-1, 64, 0), { biome: "plains" }),
    createBlock("oak_log", new Vec3(0, 64, -1), { biome: "plains" }),
    createBlock("chest", new Vec3(0, 64, 1), { biome: "plains" }),
  ];
  const southFacing = createWorldModule(
    createFakeBot({
      blocks,
      yaw: 0,
    }) as never,
  );
  const northFacing = createWorldModule(
    createFakeBot({
      blocks,
      yaw: Math.PI,
    }) as never,
  );

  const southSnapshot = southFacing.inspectVisibleArea({
    blockLimit: 10,
    entityLimit: 10,
    maxDistance: 2,
  });
  const northSnapshot = northFacing.inspectVisibleArea({
    blockLimit: 10,
    entityLimit: 10,
    maxDistance: 2,
  });

  assert.deepEqual(
    southSnapshot.visibleBlocks.map((block) => block.name),
    ["chest", "dirt", "oak_log", "stone"],
  );
  assert.deepEqual(
    northSnapshot.visibleBlocks.map((block) => block.name),
    ["chest", "dirt", "oak_log", "stone"],
  );
  assert.equal(southSnapshot.heading.cardinal, "south");
  assert.equal(northSnapshot.heading.cardinal, "north");
});

test("inspectVisibleArea filters invisible blocks, deduplicates by nearest block, and reports hazards", () => {
  const cursorBlock = createBlock("barrel", new Vec3(1, 64, 0), { biome: "plains" });
  const zombie = createEntity("zombie", new Vec3(1, 64, 0), { id: 10 });
  const skeleton = createEntity("skeleton", new Vec3(0, 64, 2), { id: 11 });
  const bot = createWorldModule(
    createFakeBot({
      blockAtCursor: cursorBlock,
      blocks: [
        cursorBlock,
        createBlock("oak_log", new Vec3(1, 64, 1), { biome: "plains" }),
        createBlock("oak_log", new Vec3(2, 64, 2), { biome: "plains" }),
        createBlock("lava", new Vec3(2, 64, 0), { biome: "plains" }),
        createBlock("cactus", new Vec3(-1, 64, 0), { biome: "desert" }),
      ],
      canSeeBlock(block) {
        return block.name !== "cactus";
      },
      entities: [
        zombie,
        skeleton,
        createEntity("cow", new Vec3(0, 64, 3), { id: 12, type: "animal" }),
      ],
      entityAtCursor: zombie,
    }) as never,
  );

  const snapshot = bot.inspectVisibleArea({
    blockLimit: 10,
    entityLimit: 2,
    maxDistance: 3,
  });

  assert.equal(snapshot.focus.blockAtCursor?.name, "barrel");
  assert.equal(snapshot.focus.entityAtCursor?.name, "zombie");
  assert.deepEqual(
    snapshot.visibleBlocks.map((block) => block.name),
    ["barrel", "oak_log", "lava"],
  );
  assert.equal(snapshot.visibleBlocks.find((block) => block.name === "oak_log")?.distance, 1.41);
  assert.deepEqual(
    snapshot.visibleEntities.map((entity) => entity.name),
    ["zombie", "skeleton"],
  );
  assert.deepEqual(
    snapshot.hazards.map((hazard) => `${hazard.category}:${hazard.name}`),
    ["entity:zombie", "block:lava", "entity:skeleton"],
  );
  assert.deepEqual(snapshot.highlights, [
    "focus block: barrel (1.0)",
    "focus entity: zombie (1.0)",
    "block: barrel (1.0)",
    "block: oak_log (1.4)",
    "block: lava (2.0)",
    "entity: zombie (1.0)",
    "entity: skeleton (2.0)",
    "hazard: zombie (1.0)",
    "hazard: lava (2.0)",
    "hazard: skeleton (2.0)",
  ]);
});

test("inspectVisibleArea preserves requireSpawned behavior before spawn", () => {
  const world = createWorldModule(
    createFakeBot({
      position: null,
    }) as never,
  );

  assert.throws(() => world.inspectVisibleArea(), /Bot has not spawned yet/);
});
