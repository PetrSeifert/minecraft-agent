import assert from "node:assert/strict";
import { test } from "vitest";

import { EventStream } from "../src/agent/eventStream";
import { createInventoryModule } from "../src/agent/modules/inventory";

function createItem(name: string, type: number, count = 1) {
  return {
    count,
    name,
    type,
  };
}

function createInventoryBot(options: {
  heldItem?: ReturnType<typeof createItem> | null;
  items?: Array<ReturnType<typeof createItem>>;
}) {
  const inventoryItems = options.items ?? [];
  const equipCalls: string[] = [];
  let consumeCalls = 0;

  const bot = {
    consume() {
      consumeCalls += 1;
      return Promise.resolve();
    },
    equip(item: { name: string }) {
      equipCalls.push(item.name);
      return Promise.resolve();
    },
    heldItem: options.heldItem ?? null,
    inventory: {
      items() {
        return inventoryItems;
      },
    },
    quickBarSlot: 0,
    registry: {
      foodsByName: {
        apple: {
          effectiveQuality: 4,
          foodPoints: 4,
          id: 1,
          name: "apple",
        },
        bread: {
          effectiveQuality: 6,
          foodPoints: 5,
          id: 2,
          name: "bread",
        },
      },
      itemsByName: {
        apple: { id: 1, name: "apple" },
        bread: { id: 2, name: "bread" },
        stone: { id: 3, name: "stone" },
      },
    },
  };

  return {
    bot,
    consumeCalls() {
      return consumeCalls;
    },
    equipCalls() {
      return equipCalls;
    },
  };
}

test("consumeFood prefers the held edible item before other inventory food", async () => {
  const harness = createInventoryBot({
    heldItem: createItem("apple", 1, 1),
    items: [createItem("apple", 1, 1), createItem("bread", 2, 2)],
  });
  const inventory = createInventoryModule(harness.bot as never, new EventStream());

  const consumed = await inventory.consumeFood();

  assert.equal(consumed?.name, "apple");
  assert.deepEqual(harness.equipCalls(), ["apple"]);
  assert.equal(harness.consumeCalls(), 1);
});

test("consumeFood chooses the best available edible item when none is held", async () => {
  const harness = createInventoryBot({
    heldItem: createItem("stone", 3, 1),
    items: [createItem("apple", 1, 1), createItem("bread", 2, 2)],
  });
  const inventory = createInventoryModule(harness.bot as never, new EventStream());

  const consumed = await inventory.consumeFood();

  assert.equal(consumed?.name, "bread");
  assert.deepEqual(harness.equipCalls(), ["bread"]);
  assert.equal(harness.consumeCalls(), 1);
});

test("consumeFood fails when no edible item is available", async () => {
  const harness = createInventoryBot({
    heldItem: createItem("stone", 3, 1),
    items: [createItem("stone", 3, 4)],
  });
  const inventory = createInventoryModule(harness.bot as never, new EventStream());

  await assert.rejects(
    () => inventory.consumeFood(),
    /No edible food items available in inventory/,
  );
});
