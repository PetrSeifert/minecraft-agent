const { summarizePayload, requireSpawned, serializeVec3 } = require('../utils');

const BLOCK_SCAN_HORIZONTAL_RADIUS = 4;
const BLOCK_SCAN_VERTICAL_OFFSETS = [-1, 0, 1, 2];
const BLOCK_SCAN_MAX_DISTANCE = 4.75;
const MAX_NEARBY_BLOCKS = 20;
const MAX_PERCEPTION_ITEMS = 10;
const EQUIPMENT_DESTINATIONS = [
  'hand',
  'head',
  'torso',
  'legs',
  'feet',
  'off-hand',
];
const IGNORED_BLOCK_NAMES = new Set(['air', 'cave_air', 'void_air']);
const CONTAINER_BLOCK_NAMES = new Set([
  'barrel',
  'blast_furnace',
  'chest',
  'dispenser',
  'dropper',
  'furnace',
  'hopper',
  'smoker',
  'trapped_chest',
]);

function formatDistance(distance) {
  return Number(distance.toFixed(1));
}

function aggregateInventoryCounts(items) {
  return items.reduce((counts, item) => {
    if (!item?.name || !Number.isFinite(item.count)) {
      return counts;
    }

    counts[item.name] = (counts[item.name] ?? 0) + item.count;
    return counts;
  }, {});
}

function collectEquippedItemNames(bot) {
  const equipped = [];
  const seen = new Set();

  function pushItem(item) {
    if (!item?.name || seen.has(item.name)) {
      return;
    }

    seen.add(item.name);
    equipped.push(item.name);
  }

  pushItem(bot.heldItem);

  if (typeof bot.getEquipmentDestSlot !== 'function') {
    return equipped;
  }

  for (const destination of EQUIPMENT_DESTINATIONS) {
    const slot = bot.getEquipmentDestSlot(destination);

    if (!Number.isInteger(slot) || slot < 0) {
      continue;
    }

    pushItem(bot.inventory?.slots?.[slot] ?? null);
  }

  return equipped;
}

function classifyRiskLevel(safetyStatus, health = null) {
  const currentHealth =
    Number.isFinite(health) ? health : Number(safetyStatus?.health ?? NaN);
  const hostileCount = safetyStatus?.hostiles?.length ?? 0;

  if (
    safetyStatus?.inLava ||
    safetyStatus?.onFire ||
    safetyStatus?.drowning ||
    safetyStatus?.mobAggro ||
    (Number.isFinite(currentHealth) && currentHealth <= 8)
  ) {
    return 'high';
  }

  if (hostileCount > 0 || (Number.isFinite(currentHealth) && currentHealth <= 14)) {
    return 'medium';
  }

  return 'low';
}

function formatEntitySummary(entity) {
  if (!entity) {
    return null;
  }

  const label =
    entity.username ??
    entity.name ??
    entity.displayName ??
    entity.type ??
    'unknown';

  const distanceValue = Number(entity.distance);
  return Number.isFinite(distanceValue)
    ? `${label} (${formatDistance(distanceValue)})`
    : label;
}

function formatChatHistoryEntry(entry) {
  if (!entry) {
    return null;
  }

  if (entry.channel === 'public' && entry.username && entry.text) {
    return `<${entry.username}> ${entry.text}`;
  }

  if (entry.channel === 'server' && entry.text) {
    return entry.text;
  }

  if (entry.username && entry.text) {
    return `[${entry.channel ?? 'chat'}] <${entry.username}> ${entry.text}`;
  }

  if (entry.text) {
    return `[${entry.channel ?? 'chat'}] ${entry.text}`;
  }

  return null;
}

function formatEventSummary(event) {
  if (!event?.type) {
    return null;
  }

  const summary = summarizePayload(event.payload);
  return summary ? `${event.type}: ${summary}` : event.type;
}

function isSolidBlock(block) {
  return block?.boundingBox === 'block';
}

function isEmptyBlock(block) {
  return !block || block.boundingBox === 'empty';
}

function isShelterCueBlockName(name) {
  if (!name) {
    return false;
  }

  return (
    name.endsWith('_bed') ||
    name.endsWith('_door') ||
    name.endsWith('_trapdoor')
  );
}

function isContainerBlockName(name) {
  if (!name) {
    return false;
  }

  return CONTAINER_BLOCK_NAMES.has(name) || name.endsWith('_shulker_box');
}

function scanNearbyBlocks(bot) {
  requireSpawned(bot);

  const origin = bot.entity.position.floored();
  const closestByName = new Map();

  for (const yOffset of BLOCK_SCAN_VERTICAL_OFFSETS) {
    for (let xOffset = -BLOCK_SCAN_HORIZONTAL_RADIUS; xOffset <= BLOCK_SCAN_HORIZONTAL_RADIUS; xOffset += 1) {
      for (let zOffset = -BLOCK_SCAN_HORIZONTAL_RADIUS; zOffset <= BLOCK_SCAN_HORIZONTAL_RADIUS; zOffset += 1) {
        const horizontalDistance = Math.sqrt(xOffset ** 2 + zOffset ** 2);

        if (horizontalDistance > BLOCK_SCAN_HORIZONTAL_RADIUS) {
          continue;
        }

        const blockPosition = origin.offset(xOffset, yOffset, zOffset);
        const distance = blockPosition.distanceTo(origin);

        if (distance > BLOCK_SCAN_MAX_DISTANCE) {
          continue;
        }

        const block = bot.blockAt(blockPosition);

        if (!block || IGNORED_BLOCK_NAMES.has(block.name)) {
          continue;
        }

        const current = closestByName.get(block.name);

        if (current && current.distance <= distance) {
          continue;
        }

        closestByName.set(block.name, {
          biome: block.biome?.name ?? null,
          distance,
          name: block.name,
          position: serializeVec3(block.position),
        });
      }
    }
  }

  return Array.from(closestByName.values()).sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    return left.name.localeCompare(right.name);
  });
}

function isCurrentPositionEnclosed(bot) {
  requireSpawned(bot);

  const origin = bot.entity.position.floored();
  const feet = bot.blockAt(origin);
  const head = bot.blockAt(origin.offset(0, 1, 0));
  const ground = bot.blockAt(origin.offset(0, -1, 0));
  const roof = bot.blockAt(origin.offset(0, 2, 0));

  return (
    isSolidBlock(ground) &&
    isEmptyBlock(feet) &&
    isEmptyBlock(head) &&
    isSolidBlock(roof)
  );
}

function extractShelterCues(blockEntries, shelteredNow) {
  const cues = shelteredNow ? ['current_position_enclosed'] : [];

  for (const block of blockEntries) {
    if (!isShelterCueBlockName(block.name)) {
      continue;
    }

    cues.push(`${block.name} (${formatDistance(block.distance)})`);

    if (cues.length >= MAX_PERCEPTION_ITEMS) {
      break;
    }
  }

  return cues;
}

function extractContainerCues(blockEntries) {
  return blockEntries
    .filter((block) => isContainerBlockName(block.name))
    .slice(0, MAX_PERCEPTION_ITEMS)
    .map((block) => `${block.name} (${formatDistance(block.distance)})`);
}

function findBiome(bot) {
  requireSpawned(bot);

  const origin = bot.entity.position.floored();
  const feetBlock = bot.blockAt(origin);
  const groundBlock = bot.blockAt(origin.offset(0, -1, 0));

  return feetBlock?.biome?.name ?? groundBlock?.biome?.name ?? 'unknown';
}

function buildPerception(context) {
  const { bot, chat, events, safetyStatus, world } = context;
  const nearbyEntities = world.nearbyEntities({
    limit: MAX_PERCEPTION_ITEMS,
    maxDistance: 16,
  });
  const hostileIds = new Set((safetyStatus?.hostiles ?? []).map((entity) => entity.id));
  const hostileEntities = world.nearbyEntities({
    limit: MAX_PERCEPTION_ITEMS,
    matcher: (entity) => hostileIds.has(entity.id),
    maxDistance: 16,
  });
  const scannedBlocks = scanNearbyBlocks(bot);

  return {
    nearbyBlocks: scannedBlocks
      .slice(0, MAX_NEARBY_BLOCKS)
      .map((block) => block.name),
    nearbyEntities: nearbyEntities.map(formatEntitySummary).filter(Boolean),
    hostiles: hostileEntities.map(formatEntitySummary).filter(Boolean),
    shelters: extractShelterCues(scannedBlocks, isCurrentPositionEnclosed(bot)),
    containers: extractContainerCues(scannedBlocks),
    recentChat: chat.history(10).map(formatChatHistoryEntry).filter(Boolean),
    recentEvents: events
      .recent(50)
      .filter(
        (event) => typeof event?.type === 'string' && !event.type.startsWith('chat:'),
      )
      .slice(-10)
      .map(formatEventSummary)
      .filter(Boolean),
  };
}

function createOrchestrationModule(bot, context) {
  const { chat, events, inventory, safety, world } = context;

  function snapshot() {
    requireSpawned(bot);

    const safetyStatus = safety.status(16);

    return {
      self: {
        health: bot.health ?? 0,
        hunger: bot.food ?? 0,
        position: serializeVec3(bot.entity.position),
        biome: findBiome(bot),
        timeOfDay: bot.time?.isDay === false ? 'night' : 'day',
        inventory: aggregateInventoryCounts(inventory.items()),
        equipped: collectEquippedItemNames(bot),
        risk: classifyRiskLevel(safetyStatus, bot.health),
      },
      perception: buildPerception({
        bot,
        chat,
        events,
        safetyStatus,
        world,
      }),
      memory: {
        working: [],
        shortTerm: [],
        longTerm: [],
      },
      planning: {
        currentGoal: undefined,
        currentSkill: undefined,
        plan: [],
        recentFailures: [],
      },
    };
  }

  return {
    snapshot,
  };
}

module.exports = {
  createOrchestrationModule,
  orchestrationInternals: {
    aggregateInventoryCounts,
    classifyRiskLevel,
    collectEquippedItemNames,
    extractContainerCues,
    extractShelterCues,
    formatChatHistoryEntry,
    formatEntitySummary,
    formatEventSummary,
    isContainerBlockName,
    isCurrentPositionEnclosed,
    isShelterCueBlockName,
    scanNearbyBlocks,
  },
};
