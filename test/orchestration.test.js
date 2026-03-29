const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

const {
  createOrchestrationModule,
  orchestrationInternals,
} = require('../src/agent/modules/orchestration');

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

function positionKey(position) {
  return `${position.x},${position.y},${position.z}`;
}

function createBlock(name, position, options = {}) {
  return {
    biome: options.biome ? { name: options.biome } : null,
    boundingBox: options.boundingBox ?? 'block',
    name,
    position,
  };
}

function createFakeBot(options = {}) {
  const blocks = new Map();
  const equipmentSlots = {
    hand: 36,
    head: 5,
    torso: 6,
    legs: 7,
    feet: 8,
    'off-hand': 45,
  };
  const inventorySlots = [];
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

  return {
    entity: {
      position: options.spawned === false ? null : basePosition,
    },
    food: options.food ?? 20,
    getEquipmentDestSlot(destination) {
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
    blockAt(position) {
      return blocks.get(positionKey(position.floored())) ?? null;
    },
    time: {
      isDay: options.isDay ?? true,
    },
  };
}

test('aggregateInventoryCounts totals item stacks by name', () => {
  const counts = aggregateInventoryCounts([
    { count: 3, name: 'oak_log' },
    { count: 5, name: 'oak_log' },
    { count: 2, name: 'bread' },
    { count: NaN, name: 'broken' },
    null,
  ]);

  assert.deepEqual(counts, {
    bread: 2,
    oak_log: 8,
  });
});

test('collectEquippedItemNames includes held and equipped slots without duplicates', () => {
  const bot = createFakeBot({
    equipment: {
      'off-hand': 'shield',
      hand: 'torch',
      head: 'iron_helmet',
    },
    heldItem: 'torch',
  });

  assert.deepEqual(collectEquippedItemNames(bot), [
    'torch',
    'iron_helmet',
    'shield',
  ]);
});

test('classifyRiskLevel maps safety and health thresholds to low medium high', () => {
  assert.equal(classifyRiskLevel({ hostiles: [] }, 20), 'low');
  assert.equal(classifyRiskLevel({ hostiles: [{ id: 1 }] }, 20), 'medium');
  assert.equal(classifyRiskLevel({ hostiles: [], mobAggro: true }, 20), 'high');
  assert.equal(classifyRiskLevel({ hostiles: [] }, 8), 'high');
});

test('format helpers render compact chat event and entity summaries', () => {
  assert.equal(
    formatChatHistoryEntry({
      channel: 'public',
      text: 'hello',
      username: 'Alex',
    }),
    '<Alex> hello',
  );
  assert.equal(
    formatEventSummary({
      payload: { text: 'Started moving', username: 'Alex' },
      type: 'pathing:status',
    }),
    'pathing:status: <Alex> Started moving',
  );
  assert.equal(
    formatEntitySummary({
      distance: 4.24,
      name: 'zombie',
    }),
    'zombie (4.2)',
  );
});

test('shelter and container cues stay compact and conservative', () => {
  const blockEntries = [
    { distance: 1.2, name: 'barrel' },
    { distance: 1.8, name: 'oak_door' },
    { distance: 2.4, name: 'red_bed' },
    { distance: 3.1, name: 'blue_shulker_box' },
    { distance: 3.8, name: 'stone' },
  ];

  assert.deepEqual(extractShelterCues(blockEntries, true), [
    'current_position_enclosed',
    'oak_door (1.8)',
    'red_bed (2.4)',
  ]);
  assert.deepEqual(extractContainerCues(blockEntries), [
    'barrel (1.2)',
    'blue_shulker_box (3.1)',
  ]);
});

test('isCurrentPositionEnclosed requires ground headroom and a roof', () => {
  const enclosedBot = createFakeBot({
    blocks: [
      createBlock('stone', new Vec3(10, 63, 10), { biome: 'plains' }),
      createBlock('stone', new Vec3(10, 66, 10)),
    ],
  });
  const openBot = createFakeBot({
    blocks: [createBlock('stone', new Vec3(10, 63, 10), { biome: 'plains' })],
  });

  assert.equal(isCurrentPositionEnclosed(enclosedBot), true);
  assert.equal(isCurrentPositionEnclosed(openBot), false);
});

test('snapshot returns the full AgentState contract and throws before spawn', () => {
  const unspawned = createOrchestrationModule(
    createFakeBot({ spawned: false }),
    {
      chat: { history: () => [] },
      events: { recent: () => [] },
      inventory: { items: () => [] },
      safety: { status: () => ({ hostiles: [] }) },
      world: { nearbyEntities: () => [] },
    },
  );

  assert.throws(() => unspawned.snapshot(), /Bot has not spawned yet/);

  const entities = [
    { distance: 2.2, id: 100, name: 'zombie' },
    { distance: 6.7, id: 101, username: 'Steve' },
  ];
  const bot = createFakeBot({
    blocks: [
      createBlock('stone', new Vec3(10, 63, 10), { biome: 'plains' }),
      createBlock('stone', new Vec3(10, 66, 10)),
      createBlock('barrel', new Vec3(11, 64, 10)),
      createBlock('oak_door', new Vec3(10, 64, 11)),
      createBlock('red_bed', new Vec3(12, 64, 10)),
    ],
    equipment: {
      'off-hand': 'shield',
      hand: 'torch',
      head: 'iron_helmet',
    },
    food: 17,
    health: 18,
    heldItem: 'torch',
    inventoryItems: [
      { count: 16, name: 'oak_log' },
      { count: 3, name: 'oak_log' },
      { count: 4, name: 'bread' },
    ],
    isDay: false,
  });
  const orchestration = createOrchestrationModule(bot, {
    chat: {
      history(limit) {
        return [
          { channel: 'public', text: 'Need wood', username: 'Alex' },
          { channel: 'server', text: 'Night is coming' },
        ].slice(-limit);
      },
    },
    events: {
      recent(limit) {
        return [
          { payload: { text: 'Need wood', username: 'Alex' }, type: 'chat:public' },
          { payload: { reason: 'goal_reached' }, type: 'pathing:goal_reached' },
          { payload: { name: 'zombie', position: { x: 10, y: 64, z: 12 } }, type: 'entity:spawn' },
        ].slice(-limit);
      },
    },
    inventory: {
      items() {
        return bot.inventory.items();
      },
    },
    safety: {
      status() {
        return {
          drowning: false,
          hostiles: [entities[0]],
          inLava: false,
          mobAggro: false,
          onFire: false,
        };
      },
    },
    world: {
      nearbyEntities({ limit = 10, matcher } = {}) {
        return entities.filter((entity) => (matcher ? matcher(entity) : true)).slice(0, limit);
      },
    },
  });

  const snapshot = orchestration.snapshot();

  assert.equal(snapshot.self.health, 18);
  assert.equal(snapshot.self.hunger, 17);
  assert.equal(snapshot.self.biome, 'plains');
  assert.equal(snapshot.self.timeOfDay, 'night');
  assert.equal(snapshot.self.risk, 'medium');
  assert.deepEqual(snapshot.self.inventory, {
    bread: 4,
    oak_log: 19,
  });
  assert.deepEqual(snapshot.self.equipped, [
    'torch',
    'iron_helmet',
    'shield',
  ]);
  assert.deepEqual(snapshot.perception.nearbyEntities, [
    'zombie (2.2)',
    'Steve (6.7)',
  ]);
  assert.deepEqual(snapshot.perception.hostiles, ['zombie (2.2)']);
  assert.equal(snapshot.perception.nearbyBlocks[0], 'barrel');
  assert.deepEqual(snapshot.perception.shelters, [
    'current_position_enclosed',
    'oak_door (1)',
    'red_bed (2)',
  ]);
  assert.deepEqual(snapshot.perception.containers, ['barrel (1)']);
  assert.deepEqual(snapshot.perception.recentChat, [
    '<Alex> Need wood',
    'Night is coming',
  ]);
  assert.deepEqual(snapshot.perception.recentEvents, [
    'pathing:goal_reached: goal_reached',
    'entity:spawn: zombie @ 10,64,12',
  ]);
  assert.deepEqual(snapshot.memory, {
    longTerm: [],
    shortTerm: [],
    working: [],
  });
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.planning, 'currentGoal'));
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.planning, 'currentSkill'));
  assert.deepEqual(snapshot.planning.plan, []);
  assert.deepEqual(snapshot.planning.recentFailures, []);
});
