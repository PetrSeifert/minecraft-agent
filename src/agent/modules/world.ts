import {
  distanceToBot,
  isHostileEntity,
  normalizeMinecraftName,
  requireSpawned,
  resolveBlockDefinition,
  serializeBlock,
  serializeEntity,
  serializeVec3,
  toVec3,
} from '../utils';

import type {
  BlockLike,
  EntityLike,
  MinecraftBot,
  NearbyEntitySummary,
  SerializedBlock,
  SerializedEntity,
  Vec3Like,
  WorldModule,
  WorldQueryOptions,
} from '../../types';

export function createWorldModule(bot: MinecraftBot): WorldModule {
  function getBlockAt(position: Vec3Like): BlockLike | null {
    return (bot.blockAt(toVec3(position).floored()) as BlockLike | null) ?? null;
  }

  function getBlockDetailsAt(position: Vec3Like): SerializedBlock | null {
    return serializeBlock(getBlockAt(position));
  }

  function getBlockAtCursor(maxDistance = 4.5): BlockLike | null {
    return (bot.blockAtCursor(maxDistance) as BlockLike | null) ?? null;
  }

  function blockAtCursor(maxDistance = 4.5): SerializedBlock | null {
    return serializeBlock(getBlockAtCursor(maxDistance));
  }

  function findBlocksByName(
    name: string,
    options: WorldQueryOptions = {},
  ): Array<SerializedBlock | null> {
    requireSpawned(bot);

    const blockDefinition = resolveBlockDefinition(bot, name);
    const positions = bot.findBlocks({
      point: options.point ? toVec3(options.point) : bot.entity.position,
      matching: blockDefinition.id,
      maxDistance: options.maxDistance ?? 32,
      count: options.count ?? 10,
    });

    return positions.map((position) =>
      serializeBlock((bot.blockAt(position) as BlockLike | null) ?? null),
    );
  }

  function findBlockByName(
    name: string,
    options: WorldQueryOptions = {},
  ): SerializedBlock | null {
    return findBlocksByName(name, { ...options, count: 1 })[0] ?? null;
  }

  function entityByUsername(username: string): EntityLike | null {
    return (bot.players[username]?.entity as EntityLike | undefined) ?? null;
  }

  function entityAtCursor(maxDistance = 4.5): SerializedEntity | null {
    return serializeEntity((bot.entityAtCursor(maxDistance) as EntityLike | null) ?? null);
  }

  function nearestEntity(options: WorldQueryOptions = {}): EntityLike | null {
    requireSpawned(bot);

    const normalizedName = options.name
      ? normalizeMinecraftName(options.name)
      : null;
    const normalizedUsername = options.username
      ? String(options.username).trim()
      : null;
    const maxDistance = options.maxDistance ?? Infinity;
    const matcher = options.matcher;

    const entity = bot.nearestEntity((candidate) => {
      const typedCandidate = candidate as EntityLike;

      if (!typedCandidate?.position) {
        return false;
      }

      if (
        normalizedName &&
        normalizeMinecraftName(typedCandidate.name ?? '') !== normalizedName
      ) {
        return false;
      }

      if (normalizedUsername && typedCandidate.username !== normalizedUsername) {
        return false;
      }

      if (options.type && typedCandidate.type !== options.type) {
        return false;
      }

      if (distanceToBot(bot, typedCandidate.position) > maxDistance) {
        return false;
      }

      return matcher ? matcher(serializeNearbyEntity(bot, typedCandidate)) : true;
    });

    return (entity as EntityLike | undefined) ?? null;
  }

  function nearestEntityDetails(options: WorldQueryOptions = {}): SerializedEntity | null {
    return serializeEntity(nearestEntity(options));
  }

  function nearestHostile(maxDistance = 16): EntityLike | null {
    return nearestEntity({
      maxDistance,
      matcher: isHostileEntity,
    });
  }

  function nearbyEntities(options: WorldQueryOptions = {}): NearbyEntitySummary[] {
    requireSpawned(bot);

    const maxDistance = options.maxDistance ?? 16;
    const limit = options.limit ?? 20;
    const matcher = options.matcher;

    return Object.values(bot.entities)
      .map((entity) => entity as EntityLike)
      .filter((entity) => entity?.position && entity !== bot.entity)
      .map((entity) => serializeNearbyEntity(bot, entity))
      .filter((entity) => entity.distance <= maxDistance)
      .filter((entity) => (matcher ? matcher(entity) : true))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, limit);
  }

  function position() {
    requireSpawned(bot);
    return serializeVec3(bot.entity.position);
  }

  return {
    blockAtCursor,
    entityAtCursor,
    entityByUsername,
    findBlockByName,
    findBlocksByName,
    getBlockAt,
    getBlockDetailsAt,
    nearbyEntities,
    nearestEntity,
    nearestEntityDetails,
    nearestHostile,
    position,
  };
}

function serializeNearbyEntity(
  bot: MinecraftBot,
  entity: EntityLike,
): NearbyEntitySummary {
  const serialized = serializeEntity(entity);

  return {
    displayName: serialized?.displayName ?? null,
    height: serialized?.height ?? null,
    id: serialized?.id ?? null,
    kind: serialized?.kind ?? null,
    name: serialized?.name ?? null,
    position: serialized?.position ?? null,
    type: serialized?.type ?? null,
    username: serialized?.username ?? null,
    velocity: serialized?.velocity ?? null,
    distance: Number(distanceToBot(bot, entity.position!).toFixed(2)),
  };
}
