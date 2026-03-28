const {
  distanceToBot,
  isHostileEntity,
  normalizeMinecraftName,
  requireSpawned,
  resolveBlockDefinition,
  serializeBlock,
  serializeEntity,
  serializeVec3,
  toVec3,
} = require('../utils');

function createWorldModule(bot) {
  function getBlockAt(position) {
    return bot.blockAt(toVec3(position).floored());
  }

  function getBlockDetailsAt(position) {
    return serializeBlock(getBlockAt(position));
  }

  function getBlockAtCursor(maxDistance = 4.5) {
    return bot.blockAtCursor(maxDistance);
  }

  function blockAtCursor(maxDistance = 4.5) {
    return serializeBlock(getBlockAtCursor(maxDistance));
  }

  function findBlocksByName(name, options = {}) {
    requireSpawned(bot);

    const blockDefinition = resolveBlockDefinition(bot, name);
    const positions = bot.findBlocks({
      point: options.point ? toVec3(options.point) : bot.entity.position,
      matching: blockDefinition.id,
      maxDistance: options.maxDistance ?? 32,
      count: options.count ?? 10,
    });

    return positions.map((position) => serializeBlock(bot.blockAt(position)));
  }

  function findBlockByName(name, options = {}) {
    return findBlocksByName(name, { ...options, count: 1 })[0] ?? null;
  }

  function entityByUsername(username) {
    return bot.players[username]?.entity ?? null;
  }

  function entityAtCursor(maxDistance = 4.5) {
    return serializeEntity(bot.entityAtCursor(maxDistance));
  }

  function nearestEntity(options = {}) {
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
      if (!candidate?.position) {
        return false;
      }

      if (normalizedName && normalizeMinecraftName(candidate.name ?? '') !== normalizedName) {
        return false;
      }

      if (normalizedUsername && candidate.username !== normalizedUsername) {
        return false;
      }

      if (options.type && candidate.type !== options.type) {
        return false;
      }

      if (distanceToBot(bot, candidate.position) > maxDistance) {
        return false;
      }

      return matcher ? matcher(candidate) : true;
    });

    return entity ?? null;
  }

  function nearestEntityDetails(options = {}) {
    return serializeEntity(nearestEntity(options));
  }

  function nearestHostile(maxDistance = 16) {
    return nearestEntity({
      maxDistance,
      matcher: isHostileEntity,
    });
  }

  function nearbyEntities(options = {}) {
    requireSpawned(bot);

    const maxDistance = options.maxDistance ?? 16;
    const limit = options.limit ?? 20;
    const matcher = options.matcher;

    return Object.values(bot.entities)
      .filter((entity) => entity?.position && entity !== bot.entity)
      .filter((entity) => distanceToBot(bot, entity.position) <= maxDistance)
      .filter((entity) => (matcher ? matcher(entity) : true))
      .sort(
        (left, right) =>
          distanceToBot(bot, left.position) - distanceToBot(bot, right.position),
      )
      .slice(0, limit)
      .map((entity) => ({
        ...serializeEntity(entity),
        distance: Number(distanceToBot(bot, entity.position).toFixed(2)),
      }));
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

module.exports = {
  createWorldModule,
};
