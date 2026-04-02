import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";

import { Vec3 } from "vec3";

import { EventStream } from "../src/agent/eventStream";
import { createMemoryModule } from "../src/agent/modules/memory";
import {
  createOrchestrationModule,
  orchestrationInternals,
} from "../src/agent/modules/orchestration";

function positionKey(position: Vec3): string {
  return `${position.x},${position.y},${position.z}`;
}

function createBlock(
  name: string,
  position: Vec3,
  options: {
    biome?: string;
    boundingBox?: string;
  } = {},
) {
  return {
    biome: options.biome ? { name: options.biome } : null,
    boundingBox: options.boundingBox ?? "block",
    name,
    position,
  };
}

function createFakeBot(
  options: {
    blocks?: Array<ReturnType<typeof createBlock>>;
    equipment?: Record<string, string>;
    food?: number;
    health?: number;
    heldItem?: string;
    inventoryItems?: Array<{ count: number; name: string }>;
    isDay?: boolean;
    position?: Vec3;
    spawned?: boolean;
  } = {},
) {
  const blocks = new Map<string, ReturnType<typeof createBlock>>();
  const equipmentSlots: Record<string, number> = {
    hand: 36,
    head: 5,
    torso: 6,
    legs: 7,
    feet: 8,
    "off-hand": 45,
  };
  const inventorySlots: Array<{ name: string; slot: number } | undefined> = [];
  const inventoryItems = options.inventoryItems ?? [];
  const basePosition = options.position ?? new Vec3(10, 64, 10);

  for (const block of options.blocks ?? []) {
    blocks.set(positionKey(block.position), block);
  }

  for (const [destination, slot] of Object.entries(equipmentSlots)) {
    const itemName = options.equipment?.[destination];

    if (!itemName) {
      continue;
    }

    inventorySlots[slot] = {
      name: itemName,
      slot,
    };
  }

  return Object.assign(new EventEmitter(), {
    entity: {
      position: options.spawned === false ? null : basePosition,
    },
    food: options.food ?? 20,
    getEquipmentDestSlot(destination: string) {
      return equipmentSlots[destination];
    },
    health: options.health ?? 20,
    heldItem: options.heldItem ? { name: options.heldItem } : null,
    inventory: {
      items() {
        return inventoryItems;
      },
      slots: inventorySlots,
    },
    blockAt(position: Vec3) {
      return blocks.get(positionKey(position.floored())) ?? null;
    },
    time: {
      isDay: options.isDay ?? true,
    },
  });
}

const {
  aggregateInventoryCounts,
  classifyRiskLevel,
  collectEquippedItemNames,
  extractContainerCues,
  extractShelterCues,
  formatChatHistoryEntry,
  formatEntitySummary,
  formatEventSummary,
  isCurrentPositionEnclosed,
} = orchestrationInternals;

test("aggregateInventoryCounts totals item stacks by name", () => {
  const counts = aggregateInventoryCounts([
    { count: 3, name: "oak_log" },
    { count: 5, name: "oak_log" },
    { count: 2, name: "bread" },
    { count: Number.NaN, name: "broken" },
    null,
  ]);

  assert.deepEqual(counts, {
    bread: 2,
    oak_log: 8,
  });
});

test("collectEquippedItemNames includes held and equipped slots without duplicates", () => {
  const bot = createFakeBot({
    equipment: {
      "off-hand": "shield",
      hand: "torch",
      head: "iron_helmet",
    },
    heldItem: "torch",
  });

  assert.deepEqual(collectEquippedItemNames(bot as never), ["torch", "iron_helmet", "shield"]);
});

test("classifyRiskLevel maps safety and health thresholds to low medium high", () => {
  assert.equal(classifyRiskLevel({ hostiles: [] } as never, 20), "low");
  assert.equal(classifyRiskLevel({ hostiles: [{ id: 1 }] } as never, 20), "medium");
  assert.equal(classifyRiskLevel({ hostiles: [], mobAggro: true } as never, 20), "high");
  assert.equal(classifyRiskLevel({ hostiles: [] } as never, 8), "high");
});

test("format helpers render compact chat event and entity summaries", () => {
  assert.equal(
    formatChatHistoryEntry({
      channel: "public",
      text: "hello",
      timestamp: new Date().toISOString(),
      username: "Alex",
    }),
    "<Alex> hello",
  );
  assert.equal(
    formatEventSummary({
      payload: { text: "Started moving", username: "Alex" },
      type: "pathing:status",
    }),
    "pathing:status: <Alex> Started moving",
  );
  assert.equal(
    formatEventSummary({
      payload: {
        args: { name: "oak_log" },
        result: {
          name: "oak_log",
          position: { x: 3, y: 64, z: 1 },
        },
        tool: "find_block_by_name",
      },
      type: "executor:success",
    }),
    "executor:success: find_block_by_name(name=oak_log) -> oak_log @ 3,64,1",
  );
  assert.equal(
    formatEntitySummary({
      distance: 4.24,
      name: "zombie",
    }),
    "zombie (4.2)",
  );
});

test("shelter and container cues stay compact and conservative", () => {
  const blockEntries = [
    {
      biome: null,
      boundingBox: "block",
      diggable: true,
      distance: 1.2,
      name: "barrel",
      position: null,
    },
    {
      biome: null,
      boundingBox: "block",
      diggable: true,
      distance: 1.8,
      name: "oak_door",
      position: null,
    },
    {
      biome: null,
      boundingBox: "block",
      diggable: true,
      distance: 2.4,
      name: "red_bed",
      position: null,
    },
    {
      biome: null,
      boundingBox: "block",
      diggable: true,
      distance: 3.1,
      name: "blue_shulker_box",
      position: null,
    },
    {
      biome: null,
      boundingBox: "block",
      diggable: true,
      distance: 3.8,
      name: "stone",
      position: null,
    },
  ];

  assert.deepEqual(extractShelterCues(blockEntries, true), [
    "current_position_enclosed",
    "oak_door (1.8)",
    "red_bed (2.4)",
  ]);
  assert.deepEqual(extractContainerCues(blockEntries), ["barrel (1.2)", "blue_shulker_box (3.1)"]);
});

test("isCurrentPositionEnclosed requires ground headroom and a roof", () => {
  const enclosedBot = createFakeBot({
    blocks: [
      createBlock("stone", new Vec3(10, 63, 10), { biome: "plains" }),
      createBlock("stone", new Vec3(10, 66, 10)),
    ],
  });
  const openBot = createFakeBot({
    blocks: [createBlock("stone", new Vec3(10, 63, 10), { biome: "plains" })],
  });

  assert.equal(isCurrentPositionEnclosed(enclosedBot as never), true);
  assert.equal(isCurrentPositionEnclosed(openBot as never), false);
});

test("snapshot returns the full AgentState contract and throws before spawn", () => {
  const unspawned = createOrchestrationModule(
    createFakeBot({ spawned: false }) as never,
    {
      chat: { history: () => [] },
      events: { recent: () => [] },
      getPlannerStatus: () => null,
      inventory: { items: () => [] },
      memory: {
        currentGoal: () => null,
        setGoal: () => ({ goal: null }),
        state: () => ({
          longTerm: [],
          shortTerm: {
            events: [],
            summaries: [],
          },
          working: [],
        }),
        summarizeNow: () => null,
      },
      safety: { status: () => ({ hostiles: [] }) },
      world: {
        inspectVisibleArea: () => ({
          focus: {
            blockAtCursor: null,
            entityAtCursor: null,
          },
          hazards: [],
          heading: {
            cardinal: "south",
            pitch: 0,
            yaw: 0,
          },
          highlights: [],
          visibleBlocks: [],
          visibleEntities: [],
        }),
      },
    } as never,
  );

  assert.throws(() => unspawned.snapshot(), /Bot has not spawned yet/);

  const entities = [
    { distance: 2.2, id: 100, name: "zombie" },
    { distance: 6.7, id: 101, username: "Steve" },
  ];
  const events = new EventStream();
  const bot = createFakeBot({
    blocks: [
      createBlock("stone", new Vec3(10, 63, 10), { biome: "plains" }),
      createBlock("stone", new Vec3(10, 66, 10)),
      createBlock("barrel", new Vec3(11, 64, 10)),
      createBlock("oak_door", new Vec3(10, 64, 11)),
      createBlock("red_bed", new Vec3(12, 64, 10)),
    ],
    equipment: {
      "off-hand": "shield",
      hand: "torch",
      head: "iron_helmet",
    },
    food: 17,
    health: 18,
    heldItem: "torch",
    inventoryItems: [
      { count: 16, name: "oak_log" },
      { count: 3, name: "oak_log" },
      { count: 4, name: "bread" },
    ],
    isDay: false,
  });
  const safety = {
    status() {
      return {
        drowning: false,
        hostiles: [entities[0]],
        inLava: false,
        mobAggro: false,
        nearestThreat: {
          name: "zombie",
        },
        onFire: false,
      };
    },
  };
  const memory = createMemoryModule(
    bot as never,
    {
      events,
      safety: safety as never,
    },
    {
      autoSummarize: false,
    },
  );

  memory.setGoal("Gather wood");
  events.push("chat:public", { text: "Need wood", username: "Alex" });
  events.push("pathing:goal_reached", { reason: "goal_reached" });
  events.push("action:success", {
    action: "actions.craftItem",
    tags: ["actions", "craft"],
    text: "Crafted 4 planks",
  });
  events.push("action:failure", {
    action: "actions.mineBlockAt",
    tags: ["actions", "mine"],
    text: "Failed to mine oak_log: out of reach",
  });
  events.push("entity:spawn", {
    name: "zombie",
    position: { x: 10, y: 64, z: 12 },
    type: "mob",
  });
  memory.summarizeNow();

  const orchestration = createOrchestrationModule(
    bot as never,
    {
      chat: {
        history(limit: number) {
          return [
            {
              channel: "public",
              text: "Need wood",
              timestamp: new Date().toISOString(),
              username: "Alex",
            },
            {
              channel: "server",
              text: "Night is coming",
              timestamp: new Date().toISOString(),
              username: null,
            },
          ].slice(-limit);
        },
      },
      events,
      inventory: {
        items() {
          return bot.inventory.items();
        },
      },
      memory,
      safety: safety as never,
      world: {
        inspectVisibleArea() {
          return {
            focus: {
              blockAtCursor: {
                biome: "plains",
                boundingBox: "block",
                diggable: true,
                name: "barrel",
                position: { x: 11, y: 64, z: 10 },
              },
              entityAtCursor: {
                id: 100,
                name: "zombie",
                position: { x: 10, y: 64, z: 12 },
                type: "mob",
              },
            },
            hazards: [
              {
                category: "entity",
                distance: 2.2,
                name: "zombie",
                position: { x: 10, y: 64, z: 12 },
                reason: "hostile",
              },
            ],
            heading: {
              cardinal: "south",
              pitch: 0,
              yaw: 0,
            },
            highlights: [
              "focus block: barrel (1.0)",
              "focus entity: zombie (2.0)",
              "block: barrel (1.0)",
              "entity: zombie (2.2)",
              "hazard: zombie (2.2)",
            ],
            visibleBlocks: [
              {
                biome: "plains",
                boundingBox: "block",
                diggable: true,
                distance: 1,
                name: "barrel",
                position: { x: 11, y: 64, z: 10 },
              },
              {
                biome: "plains",
                boundingBox: "block",
                diggable: true,
                distance: 1,
                name: "oak_door",
                position: { x: 10, y: 64, z: 11 },
              },
              {
                biome: "plains",
                boundingBox: "block",
                diggable: true,
                distance: 2,
                name: "red_bed",
                position: { x: 12, y: 64, z: 10 },
              },
            ],
            visibleEntities: entities,
          };
        },
      },
      getPlannerStatus() {
        return {
          currentGoal: "Gather wood",
          enabled: true,
          inFlight: false,
          lastError: null,
          lastPlannedAt: "2026-01-01T00:00:00.000Z",
          lastTrigger: "spawn",
          model: "openrouter/test-model",
          provider: "openrouter" as const,
        };
      },
    } as never,
  );

  const snapshot = orchestration.snapshot();

  assert.equal(snapshot.self.health, 18);
  assert.equal(snapshot.self.hunger, 17);
  assert.equal(snapshot.self.biome, "plains");
  assert.equal(snapshot.self.timeOfDay, "night");
  assert.equal(snapshot.self.risk, "medium");
  assert.deepEqual(snapshot.self.inventory, {
    bread: 4,
    oak_log: 19,
  });
  assert.deepEqual(snapshot.self.equipped, ["torch", "iron_helmet", "shield"]);
  assert.deepEqual(snapshot.perception.nearbyEntities, ["zombie (2.2)", "Steve (6.7)"]);
  assert.deepEqual(snapshot.perception.hostiles, ["zombie (2.2)"]);
  assert.equal(snapshot.perception.nearbyBlocks[0], "barrel");
  assert.deepEqual(snapshot.perception.shelters, [
    "current_position_enclosed",
    "oak_door (1)",
    "red_bed (2)",
  ]);
  assert.deepEqual(snapshot.perception.containers, ["barrel (1)"]);
  assert.equal(snapshot.perception.visibleArea.heading.cardinal, "south");
  assert.deepEqual(snapshot.perception.visibleArea.highlights, [
    "focus block: barrel (1.0)",
    "focus entity: zombie (2.0)",
    "block: barrel (1.0)",
    "entity: zombie (2.2)",
    "hazard: zombie (2.2)",
  ]);
  assert.deepEqual(snapshot.perception.recentChat, ["<Alex> Need wood", "Night is coming"]);
  assert.deepEqual(snapshot.perception.recentEvents, [
    "goal:update",
    "pathing:goal_reached: goal_reached",
    "action:success: Crafted 4 planks",
    "action:failure: Failed to mine oak_log: out of reach",
    "entity:spawn: zombie @ 10,64,12",
  ]);
  assert.equal(snapshot.memory.shortTerm.events[0]?.type, "goal_update");
  assert.equal(snapshot.memory.shortTerm.events[1]?.type, "dialogue_received");
  assert.ok(snapshot.memory.shortTerm.summaries.length >= 1);
  assert.equal(snapshot.memory.longTerm.length, 0);
  assert.ok(
    snapshot.memory.working.some(
      (item) => item.tags.includes("goal") && item.text === "Gather wood",
    ),
  );
  assert.ok(snapshot.memory.working.some((item) => item.tags.includes("failure")));
  assert.equal(snapshot.planning.currentGoal, "Gather wood");
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.planning, "currentSkill"));
  assert.equal(snapshot.planning.planner?.model, "openrouter/test-model");
  assert.equal(snapshot.planning.planner?.lastTrigger, "spawn");
  assert.deepEqual(snapshot.planning.plan, []);
  assert.ok(snapshot.planning.recentFailures.length >= 1);
});
