import { Vec3 } from 'vec3';

import type {
  BlockLike,
  EntityLike,
  ItemLike,
  MinecraftBot,
  SerializedBlock,
  SerializedEntity,
  SerializedItem,
  SerializedVec3,
  SerializedWindow,
  Vec3Like,
  WindowLike,
} from '../types';

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

export const CARDINAL_FACES = [
  new Vec3(0, 1, 0),
  new Vec3(0, -1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

export function normalizeMinecraftName(value: unknown): string {
  return String(value).trim().toLowerCase().replace(/[ -]+/g, '_');
}

function toFixedNumber(value: number, digits = 2): number {
  return Number(Number(value).toFixed(digits));
}

export function toVec3(value: Vec3Like | Vec3 | readonly [number, number, number]): Vec3 {
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
    'x' in value &&
    'y' in value &&
    'z' in value
  ) {
    return new Vec3(Number(value.x), Number(value.y), Number(value.z));
  }

  throw new Error(`Unable to convert value to Vec3: ${JSON.stringify(value)}`);
}

export function requireSpawned(bot: MinecraftBot): void {
  if (!bot.entity?.position) {
    throw new Error('Bot has not spawned yet');
  }
}

export function serializeVec3(
  vec: Vec3Like | Vec3 | null | undefined,
): SerializedVec3 | null {
  if (!vec) {
    return null;
  }

  return {
    x: toFixedNumber(vec.x),
    y: toFixedNumber(vec.y),
    z: toFixedNumber(vec.z),
  };
}

export function serializeItem(item: ItemLike | null | undefined): SerializedItem | null {
  if (!item) {
    return null;
  }

  return {
    name: item.name,
    displayName: item.displayName ?? null,
    count: item.count,
    slot: item.slot ?? null,
    type: item.type,
    metadata: item.metadata ?? null,
  };
}

export function serializeBlock(block: BlockLike | null | undefined): SerializedBlock | null {
  if (!block) {
    return null;
  }

  return {
    name: block.name,
    displayName: block.displayName ?? null,
    position: serializeVec3(block.position ?? null),
    type: block.type ?? null,
    metadata: block.metadata ?? null,
    biome: block.biome?.name ?? null,
    diggable: Boolean(block.diggable),
    boundingBox: block.boundingBox ?? null,
  };
}

export function serializeEntity(
  entity: EntityLike | null | undefined,
): SerializedEntity | null {
  if (!entity) {
    return null;
  }

  return {
    id: entity.id ?? null,
    type: entity.type ?? null,
    name: entity.name ?? null,
    displayName: entity.displayName ?? null,
    username: entity.username ?? null,
    kind: entity.kind ?? null,
    height: entity.height ?? null,
    position: serializeVec3(entity.position ?? null),
    velocity: serializeVec3(entity.velocity ?? null),
  };
}

export function serializeWindow(
  window: WindowLike | null | undefined,
): SerializedWindow | null {
  if (!window) {
    return null;
  }

  return {
    id: window.id ?? null,
    type: window.type ?? null,
    title: window.title ?? null,
    slotCount: window.slots?.length ?? null,
  };
}

function resolveRegistryEntry<T>(
  registryMap: Record<string, T>,
  rawName: string,
  kind: string,
): T {
  const name = normalizeMinecraftName(rawName);
  const entry = registryMap[name];

  if (!entry) {
    throw new Error(`Unknown ${kind}: "${rawName}"`);
  }

  return entry;
}

export function resolveItem(bot: MinecraftBot, name: string): { id: number; name: string } {
  const registry = bot.registry as unknown as {
    itemsByName: Record<string, { id: number; name: string }>;
  };

  return resolveRegistryEntry(registry.itemsByName, name, 'item');
}

export function resolveBlockDefinition(
  bot: MinecraftBot,
  name: string,
): { id: number; name: string } {
  const registry = bot.registry as unknown as {
    blocksByName: Record<string, { id: number; name: string }>;
  };

  return resolveRegistryEntry(registry.blocksByName, name, 'block');
}

export function distanceToBot(
  bot: MinecraftBot,
  position: Vec3Like | Vec3 | readonly [number, number, number],
): number {
  requireSpawned(bot);
  return bot.entity.position.distanceTo(toVec3(position));
}

export function isHostileEntity(entity: {
  displayName?: string | null;
  kind?: string | null;
  name?: string | null;
  type?: string | null;
} | null | undefined): boolean {
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

export function summarizePayload(payload: unknown): string | number | boolean | null {
  if (!payload || typeof payload !== 'object') {
    return (payload as string | number | boolean | null | undefined) ?? null;
  }

  const candidate = payload as {
    message?: string;
    name?: string;
    position?: Vec3Like;
    reason?: string;
    text?: string;
    username?: string;
  };

  if (candidate.message) {
    return candidate.message;
  }

  if (candidate.reason) {
    return candidate.reason;
  }

  if (candidate.username && candidate.text) {
    return `<${candidate.username}> ${candidate.text}`;
  }

  if (candidate.text) {
    return candidate.text;
  }

  if (candidate.name && candidate.position) {
    const { x, y, z } = candidate.position;
    return `${candidate.name} @ ${x},${y},${z}`;
  }

  if (candidate.position) {
    const { x, y, z } = candidate.position;
    return `${x},${y},${z}`;
  }

  return null;
}
