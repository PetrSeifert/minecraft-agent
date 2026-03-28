const { Vec3 } = require('vec3');

const HOSTILE_ENTITY_NAMES = new Set([
  'blaze',
  'bogged',
  'breeze',
  'cave_spider',
  'creeper',
  'drowned',
  'elder_guardian',
  'enderman',
  'endermite',
  'evoker',
  'ghast',
  'guardian',
  'hoglin',
  'husk',
  'illusioner',
  'magma_cube',
  'phantom',
  'piglin_brute',
  'pillager',
  'ravager',
  'shulker',
  'silverfish',
  'skeleton',
  'slime',
  'spider',
  'stray',
  'vex',
  'vindicator',
  'warden',
  'witch',
  'wither_skeleton',
  'zoglin',
  'zombie',
  'zombie_villager',
]);

const CARDINAL_FACES = [
  new Vec3(0, 1, 0),
  new Vec3(0, -1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

function normalizeMinecraftName(value) {
  return String(value).trim().toLowerCase().replace(/[ -]+/g, '_');
}

function toFixedNumber(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function toVec3(value) {
  if (!value) {
    throw new Error('Position is required');
  }

  if (value instanceof Vec3) {
    return value;
  }

  if (Array.isArray(value) && value.length >= 3) {
    return new Vec3(Number(value[0]), Number(value[1]), Number(value[2]));
  }

  if (
    typeof value === 'object' &&
    value.x !== undefined &&
    value.y !== undefined &&
    value.z !== undefined
  ) {
    return new Vec3(Number(value.x), Number(value.y), Number(value.z));
  }

  throw new Error(`Unable to convert value to Vec3: ${JSON.stringify(value)}`);
}

function requireSpawned(bot) {
  if (!bot.entity?.position) {
    throw new Error('Bot has not spawned yet');
  }
}

function serializeVec3(vec) {
  if (!vec) {
    return null;
  }

  return {
    x: toFixedNumber(vec.x),
    y: toFixedNumber(vec.y),
    z: toFixedNumber(vec.z),
  };
}

function serializeItem(item) {
  if (!item) {
    return null;
  }

  return {
    name: item.name,
    displayName: item.displayName,
    count: item.count,
    slot: item.slot,
    type: item.type,
    metadata: item.metadata,
  };
}

function serializeBlock(block) {
  if (!block) {
    return null;
  }

  return {
    name: block.name,
    displayName: block.displayName,
    position: serializeVec3(block.position),
    type: block.type,
    metadata: block.metadata,
    biome: block.biome?.name ?? null,
    diggable: Boolean(block.diggable),
    boundingBox: block.boundingBox ?? null,
  };
}

function serializeEntity(entity) {
  if (!entity) {
    return null;
  }

  return {
    id: entity.id,
    type: entity.type,
    name: entity.name ?? null,
    displayName: entity.displayName ?? null,
    username: entity.username ?? null,
    kind: entity.kind ?? null,
    height: entity.height ?? null,
    position: serializeVec3(entity.position),
    velocity: serializeVec3(entity.velocity),
  };
}

function serializeWindow(window) {
  if (!window) {
    return null;
  }

  return {
    id: window.id,
    type: window.type ?? null,
    title: window.title ?? null,
    slotCount: window.slots?.length ?? null,
  };
}

function resolveRegistryEntry(registryMap, rawName, kind) {
  const name = normalizeMinecraftName(rawName);
  const entry = registryMap[name];

  if (!entry) {
    throw new Error(`Unknown ${kind}: "${rawName}"`);
  }

  return entry;
}

function resolveItem(bot, name) {
  return resolveRegistryEntry(bot.registry.itemsByName, name, 'item');
}

function resolveBlockDefinition(bot, name) {
  return resolveRegistryEntry(bot.registry.blocksByName, name, 'block');
}

function distanceToBot(bot, position) {
  requireSpawned(bot);
  return bot.entity.position.distanceTo(toVec3(position));
}

function isHostileEntity(entity) {
  if (!entity) {
    return false;
  }

  const entityType = normalizeMinecraftName(entity.type ?? '');
  const kind = normalizeMinecraftName(entity.kind ?? '');
  const shortName = normalizeMinecraftName(entity.name ?? '');
  const displayName = normalizeMinecraftName(entity.displayName ?? '');

  if (entityType === 'hostile') {
    return true;
  }

  if (kind === 'hostile_mobs') {
    return true;
  }

  if (entityType !== 'mob') {
    return false;
  }

  return (
    HOSTILE_ENTITY_NAMES.has(shortName) ||
    HOSTILE_ENTITY_NAMES.has(displayName)
  );
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload ?? null;
  }

  if (payload.message) {
    return payload.message;
  }

  if (payload.reason) {
    return payload.reason;
  }

  if (payload.username && payload.text) {
    return `<${payload.username}> ${payload.text}`;
  }

  if (payload.name && payload.position) {
    const { x, y, z } = payload.position;
    return `${payload.name} @ ${x},${y},${z}`;
  }

  if (payload.position) {
    const { x, y, z } = payload.position;
    return `${x},${y},${z}`;
  }

  return null;
}

module.exports = {
  CARDINAL_FACES,
  distanceToBot,
  isHostileEntity,
  normalizeMinecraftName,
  requireSpawned,
  resolveBlockDefinition,
  resolveItem,
  serializeBlock,
  serializeEntity,
  serializeItem,
  serializeVec3,
  serializeWindow,
  summarizePayload,
  toVec3,
};
