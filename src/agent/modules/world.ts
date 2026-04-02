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
} from "../utils";

import type {
  BlockLike,
  EntityLike,
  MinecraftBot,
  NearbyEntitySummary,
  SerializedBlock,
  SerializedEntity,
  VisibleAreaOptions,
  VisibleAreaSnapshot,
  VisibleBlockSummary,
  VisibleHazardSummary,
  Vec3Like,
  WorldModule,
  WorldQueryOptions,
} from "../../types";

const DEFAULT_VISIBLE_AREA_MAX_DISTANCE = 8;
const DEFAULT_VISIBLE_AREA_BLOCK_LIMIT = 8;
const DEFAULT_VISIBLE_AREA_ENTITY_LIMIT = 8;
const IGNORED_BLOCK_NAMES = new Set(["air", "cave_air", "void_air"]);
const DANGER_BLOCK_REASONS = new Map<string, string>([
  ["cactus", "danger_block"],
  ["campfire", "danger_block"],
  ["fire", "danger_block"],
  ["lava", "danger_block"],
  ["magma_block", "danger_block"],
  ["soul_campfire", "danger_block"],
  ["soul_fire", "danger_block"],
  ["sweet_berry_bush", "danger_block"],
]);

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

  function findBlockByName(name: string, options: WorldQueryOptions = {}): SerializedBlock | null {
    return findBlocksByName(name, { ...options, count: 1 })[0] ?? null;
  }

  function entityByUsername(username: string): EntityLike | null {
    return (bot.players[username]?.entity as EntityLike | undefined) ?? null;
  }

  function entityById(id: number): EntityLike | null {
    if (!Number.isInteger(id)) {
      return null;
    }

    return (bot.entities[id] as EntityLike | undefined) ?? null;
  }

  function entityAtCursor(maxDistance = 4.5): SerializedEntity | null {
    return serializeEntity((bot.entityAtCursor(maxDistance) as EntityLike | null) ?? null);
  }

  function inspectVisibleArea(options: VisibleAreaOptions = {}): VisibleAreaSnapshot {
    requireSpawned(bot);

    const maxDistance = options.maxDistance ?? DEFAULT_VISIBLE_AREA_MAX_DISTANCE;
    const blockLimit = options.blockLimit ?? DEFAULT_VISIBLE_AREA_BLOCK_LIMIT;
    const entityLimit = options.entityLimit ?? DEFAULT_VISIBLE_AREA_ENTITY_LIMIT;
    const visibleBlocks = collectVisibleBlocks(bot, {
      blockLimit,
      maxDistance,
    });
    const visibleEntities = collectVisibleEntities(bot, {
      entityLimit,
      maxDistance,
    });
    const focus = {
      blockAtCursor: blockAtCursor(maxDistance),
      entityAtCursor: entityAtCursor(maxDistance),
    };
    const hazards = collectHazards(visibleBlocks, visibleEntities);

    return {
      focus,
      hazards,
      heading: getHeading(bot),
      highlights: buildHighlights({
        focus,
        focusBlockDistance: distanceFromSerializedPosition(
          bot,
          focus.blockAtCursor?.position ?? null,
        ),
        focusEntityDistance: distanceFromSerializedPosition(
          bot,
          focus.entityAtCursor?.position ?? null,
        ),
        hazards,
        visibleBlocks,
        visibleEntities,
      }),
      visibleBlocks,
      visibleEntities,
    };
  }

  function nearestEntity(options: WorldQueryOptions = {}): EntityLike | null {
    requireSpawned(bot);

    const normalizedName = options.name ? normalizeMinecraftName(options.name) : null;
    const normalizedUsername = options.username ? String(options.username).trim() : null;
    const maxDistance = options.maxDistance ?? Infinity;
    const matcher = options.matcher;

    const entity = bot.nearestEntity((candidate) => {
      const typedCandidate = candidate as EntityLike;

      if (!typedCandidate?.position) {
        return false;
      }

      if (normalizedName && normalizeMinecraftName(typedCandidate.name ?? "") !== normalizedName) {
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
    entityById,
    entityByUsername,
    findBlockByName,
    findBlocksByName,
    getBlockAt,
    getBlockDetailsAt,
    inspectVisibleArea,
    nearbyEntities,
    nearestEntity,
    nearestEntityDetails,
    nearestHostile,
    position,
  };
}

function serializeNearbyEntity(bot: MinecraftBot, entity: EntityLike): NearbyEntitySummary {
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

function getHeading(bot: MinecraftBot): VisibleAreaSnapshot["heading"] {
  requireSpawned(bot);

  const entity = bot.entity as { pitch?: number; yaw?: number };
  const yaw = Number(entity.yaw ?? 0);
  const pitch = Number(entity.pitch ?? 0);

  return {
    cardinal: deriveCardinalDirection(yaw),
    pitch: Number(pitch.toFixed(2)),
    yaw: Number(yaw.toFixed(2)),
  };
}

function deriveCardinalDirection(yaw: number): string {
  const normalizedYaw = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const quarterTurns = Math.round(normalizedYaw / (Math.PI / 2)) % 4;
  const cardinalLabels = ["south", "west", "north", "east"];
  return cardinalLabels[quarterTurns] ?? "south";
}

function collectVisibleBlocks(
  bot: MinecraftBot,
  options: Required<Pick<VisibleAreaOptions, "blockLimit" | "maxDistance">>,
): VisibleBlockSummary[] {
  requireSpawned(bot);

  const sampleRadius = Math.ceil(options.maxDistance);
  const origin = bot.entity.position;
  const originFloor = origin.floored();
  const closestByName = new Map<string, VisibleBlockSummary>();

  for (let yOffset = -sampleRadius; yOffset <= sampleRadius; yOffset += 1) {
    for (let xOffset = -sampleRadius; xOffset <= sampleRadius; xOffset += 1) {
      for (let zOffset = -sampleRadius; zOffset <= sampleRadius; zOffset += 1) {
        const samplePosition = originFloor.offset(xOffset, yOffset, zOffset);
        const block = (bot.blockAt(samplePosition) as BlockLike | null) ?? null;

        if (!block?.name || IGNORED_BLOCK_NAMES.has(block.name)) {
          continue;
        }

        const blockPosition = block.position ?? samplePosition;
        const distance = origin.distanceTo(blockPosition);

        if (distance > options.maxDistance) {
          continue;
        }

        if (typeof bot.canSeeBlock === "function" && !bot.canSeeBlock(block as never)) {
          continue;
        }

        const serialized = serializeBlock(block);

        if (!serialized) {
          continue;
        }

        const candidate: VisibleBlockSummary = {
          ...serialized,
          distance: Number(distance.toFixed(2)),
        };
        const current = closestByName.get(candidate.name);

        if (
          !current ||
          candidate.distance < current.distance ||
          (candidate.distance === current.distance &&
            comparePositions(candidate.position, current.position) < 0)
        ) {
          closestByName.set(candidate.name, candidate);
        }
      }
    }
  }

  return Array.from(closestByName.values())
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, options.blockLimit);
}

function collectVisibleEntities(
  bot: MinecraftBot,
  options: Required<Pick<VisibleAreaOptions, "entityLimit" | "maxDistance">>,
): NearbyEntitySummary[] {
  requireSpawned(bot);

  return Object.values(bot.entities ?? {})
    .map((entity) => entity as EntityLike)
    .filter((entity) => entity?.position && entity !== bot.entity)
    .map((entity) => serializeNearbyEntity(bot, entity))
    .filter((entity) => entity.distance <= options.maxDistance)
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return getEntityLabel(left).localeCompare(getEntityLabel(right));
    })
    .slice(0, options.entityLimit);
}

function collectHazards(
  visibleBlocks: VisibleBlockSummary[],
  visibleEntities: NearbyEntitySummary[],
): VisibleHazardSummary[] {
  const entityHazards = visibleEntities
    .filter((entity) => isHostileEntity(entity))
    .map<VisibleHazardSummary>((entity) => ({
      category: "entity",
      distance: entity.distance,
      name: getEntityLabel(entity),
      position: entity.position,
      reason: "hostile",
    }));
  const blockHazards = visibleBlocks
    .filter((block) => DANGER_BLOCK_REASONS.has(block.name))
    .map<VisibleHazardSummary>((block) => ({
      category: "block",
      distance: block.distance,
      name: block.name,
      position: block.position,
      reason: DANGER_BLOCK_REASONS.get(block.name) ?? "danger_block",
    }));

  return [...entityHazards, ...blockHazards].sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    if (left.category !== right.category) {
      return left.category.localeCompare(right.category);
    }

    return left.name.localeCompare(right.name);
  });
}

function buildHighlights(context: {
  focus: VisibleAreaSnapshot["focus"];
  focusBlockDistance: number | null;
  focusEntityDistance: number | null;
  hazards: VisibleHazardSummary[];
  visibleBlocks: VisibleBlockSummary[];
  visibleEntities: NearbyEntitySummary[];
}): string[] {
  const highlights: string[] = [];

  if (context.focus.blockAtCursor?.name) {
    highlights.push(
      `focus block: ${context.focus.blockAtCursor.name} (${formatDistanceForHighlight(context.focusBlockDistance)})`,
    );
  }

  if (context.focus.entityAtCursor) {
    highlights.push(
      `focus entity: ${getEntityLabel(context.focus.entityAtCursor)} (${formatDistanceForHighlight(context.focusEntityDistance)})`,
    );
  }

  for (const block of context.visibleBlocks.slice(0, 3)) {
    highlights.push(`block: ${block.name} (${block.distance.toFixed(1)})`);
  }

  for (const entity of context.visibleEntities.slice(0, 3)) {
    highlights.push(`entity: ${getEntityLabel(entity)} (${entity.distance.toFixed(1)})`);
  }

  for (const hazard of context.hazards.slice(0, 3)) {
    highlights.push(`hazard: ${hazard.name} (${hazard.distance.toFixed(1)})`);
  }

  return highlights;
}

function distanceFromSerializedPosition(
  bot: MinecraftBot,
  position: ReturnType<typeof serializeVec3>,
): number | null {
  if (!position) {
    return null;
  }

  return Number(distanceToBot(bot, position).toFixed(2));
}

function formatDistanceForHighlight(distance: number | null): string {
  return Number.isFinite(distance) ? Number(distance).toFixed(1) : "?";
}

function comparePositions(
  left: ReturnType<typeof serializeVec3>,
  right: ReturnType<typeof serializeVec3>,
): number {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  if (left.y !== right.y) {
    return left.y - right.y;
  }

  if (left.x !== right.x) {
    return left.x - right.x;
  }

  return left.z - right.z;
}

function getEntityLabel(
  entity: Pick<SerializedEntity, "displayName" | "name" | "type" | "username">,
): string {
  return entity.username ?? entity.name ?? entity.displayName ?? entity.type ?? "unknown";
}

export const worldInternals = {
  buildHighlights,
  collectHazards,
  collectVisibleBlocks,
  collectVisibleEntities,
  deriveCardinalDirection,
  getEntityLabel,
};
