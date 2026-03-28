const { Movements, goals, pathfinder } = require('mineflayer-pathfinder');

const {
  GoalBlock,
  GoalFollow,
  GoalGetToBlock,
  GoalInvert,
  GoalLookAtBlock,
  GoalNear,
  GoalPlaceBlock,
} = goals;

const { requireSpawned, serializeEntity, serializeVec3, toVec3 } = require('../utils');

const DEFAULT_MOVEMENT_OPTIONS = {};
const DEFAULT_PHYSICS_HOLD_MS = 1500;
const FALL_START_VELOCITY = -0.08;
const SUPPORT_SAMPLE_OFFSETS = [
  [0, 0],
  [-0.29, -0.29],
  [-0.29, 0.29],
  [0.29, -0.29],
  [0.29, 0.29],
];

function createPathingModule(bot, events) {
  let movements = null;
  const pendingMovementOptions = { ...DEFAULT_MOVEMENT_OPTIONS };
  let pausedUntil = 0;
  let pathfinderLoaded = false;
  let followState = null;
  let physicsHoldUntil = 0;
  let physicsMonitorId = null;
  let lastPhysicsState = bot.physicsEnabled;

  function groundBlock() {
    if (!bot.entity?.position) {
      return null;
    }

    return bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
  }

  function supportSamplePositions() {
    if (!bot.entity?.position) {
      return [];
    }

    return SUPPORT_SAMPLE_OFFSETS.map(([dx, dz]) =>
      bot.entity.position.offset(dx, -1, dz).floored(),
    );
  }

  function motionMagnitude() {
    const velocity = bot.entity?.velocity;

    if (!velocity) {
      return 0;
    }

    return Math.abs(velocity.x) + Math.abs(velocity.y) + Math.abs(velocity.z);
  }

  function hasSolidGroundBelow() {
    return supportSamplePositions().some((position) => {
      const block = bot.blockAt(position);
      return block?.boundingBox === 'block';
    });
  }

  function isSupportSamplePosition(position) {
    if (!position) {
      return false;
    }

    return supportSamplePositions().some((sample) => sample.equals(position));
  }

  function forceUnsupportedGroundFall(reason = 'unsupported_ground') {
    if (!bot.entity?.velocity) {
      return false;
    }

    let changed = false;

    if (bot.entity.onGround) {
      bot.entity.onGround = false;
      changed = true;
    }

    if (
      !Number.isFinite(bot.entity.velocity.y) ||
      bot.entity.velocity.y > FALL_START_VELOCITY
    ) {
      bot.entity.velocity.y = FALL_START_VELOCITY;
      changed = true;
    }

    if (changed) {
      events.push('physics:forced_fall', { reason });
    }

    return changed;
  }

  function isPhysicallyUnstable() {
    if (!bot.entity?.position) {
      return false;
    }

    if (bot.entity.isInWater) {
      return true;
    }

    if (!bot.entity.onGround) {
      return true;
    }

    if (!hasSolidGroundBelow()) {
      return true;
    }

    return motionMagnitude() > 0.02;
  }

  function resetMotionState(reason = 'reset_motion') {
    bot.clearControlStates();
    bot.jumpQueued = false;

    if (bot.entity?.velocity?.set) {
      bot.entity.velocity.set(0, 0, 0);
    }

    events.push('physics:motion_reset', { reason });
  }

  function setPhysicsEnabled(enabled, reason) {
    if (bot.physicsEnabled === enabled) {
      return;
    }

    if (enabled) {
      resetMotionState(`${reason}:before_enable`);
      bot.physicsEnabled = true;
      events.push('physics:enabled', { reason });
      lastPhysicsState = true;
      return;
    }

    bot.clearControlStates();
    bot.physicsEnabled = false;
    events.push('physics:disabled', { reason });
    lastPhysicsState = false;
  }

  function holdPhysics(reason, durationMs = DEFAULT_PHYSICS_HOLD_MS) {
    physicsHoldUntil = Math.max(physicsHoldUntil, Date.now() + durationMs);
    setPhysicsEnabled(true, reason);

    return {
      holdUntil: new Date(physicsHoldUntil).toISOString(),
      reason,
    };
  }

  function clearFollowState(reason = 'follow_cleared') {
    if (!followState) {
      return;
    }

    followState = null;
    events.push('pathing:follow_stopped', { reason });
  }

  function ensurePathfinderLoaded() {
    if (pathfinderLoaded) {
      return;
    }

    bot.loadPlugin(pathfinder);
    pathfinderLoaded = true;
    events.push('pathing:plugin_loaded', null);
  }

  function getPathfinder() {
    ensurePathfinderLoaded();

    if (!bot.pathfinder) {
      throw new Error('Pathfinder plugin is not ready yet');
    }

    return bot.pathfinder;
  }

  function ensureMovements() {
    if (!movements) {
      movements = new Movements(bot);
    }

    Object.assign(movements, pendingMovementOptions);
    getPathfinder().setMovements(movements);
    return movements;
  }

  function refreshMovements() {
    movements = new Movements(bot);
    Object.assign(movements, pendingMovementOptions);
    getPathfinder().setMovements(movements);
    return movements;
  }

  function syncPhysicsState(reason = 'monitor') {
    const hasActivePathGoal = Boolean(bot.pathfinder?.goal);
    const shouldHold =
      Date.now() < physicsHoldUntil ||
      hasActivePathGoal ||
      isPhysicallyUnstable();

    if (shouldHold) {
      setPhysicsEnabled(true, reason);
      return;
    }

    setPhysicsEnabled(false, reason);
  }

  async function preparePathing(options = {}) {
    requireSpawned(bot);

    const remainingPauseMs = pausedUntil - Date.now();
    const ignorePause = options.ignorePause === true;

    if (!ignorePause && remainingPauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingPauseMs));
    }

    holdPhysics('prepare_pathing', 5000);
    ensurePathfinderLoaded();
    await bot.waitForChunksToLoad();
    ensureMovements();
    return getPathfinder();
  }

  bot.on('spawn', () => {
    if (pathfinderLoaded) {
      refreshMovements();
      events.push('pathing:movements_ready', null);
    }

    if (!physicsMonitorId) {
      physicsMonitorId = setInterval(() => {
        syncPhysicsState('monitor');
      }, 50);
    }

    holdPhysics('spawn', 2000);
  });

  bot.on('forcedMove', () => {
    holdPhysics('forced_move', 2000);
  });

  bot.on('move', () => {
    if (isPhysicallyUnstable()) {
      holdPhysics('move_unstable', 1000);
    }
  });

  bot.on('goal_reached', () => {
    events.push('pathing:goal_reached', null);
    clearFollowState('goal_reached');
    holdPhysics('goal_reached', 1000);
  });

  bot.on('goal_updated', (goal) => {
    events.push('pathing:goal_updated', {
      goal: goal?.constructor?.name ?? null,
    });
  });

  bot.on('path_update', (result) => {
    events.push('pathing:path_update', {
      status: result?.status ?? null,
      pathLength: result?.path?.length ?? null,
      visitedNodes: result?.visitedNodes ?? null,
    });
  });

  bot.on('path_reset', (reason) => {
    events.push('pathing:path_reset', { reason });
    holdPhysics(`path_reset:${reason}`, 1500);
  });

  bot.on('path_stop', () => {
    events.push('pathing:path_stop', null);
    clearFollowState('path_stop');
    holdPhysics('path_stop', 1000);
  });

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    const changedBlock = newBlock?.position ?? oldBlock?.position;

    if (!changedBlock || !bot.entity?.position) {
      return;
    }

    if (changedBlock.distanceTo(bot.entity.position) <= 2.5) {
      holdPhysics('nearby_block_update', 2500);
    }

    const removedSupportBlock =
      isSupportSamplePosition(changedBlock) &&
      oldBlock?.boundingBox === 'block' &&
      newBlock?.boundingBox !== 'block';

    if (removedSupportBlock) {
      holdPhysics('support_block_removed', 4000);
      forceUnsupportedGroundFall('support_block_removed');
    }
  });

  bot.on('entityHurt', (entity) => {
    if (entity?.id === bot.entity?.id) {
      holdPhysics('self_hurt', 2500);
    }
  });

  bot.on('death', () => {
    holdPhysics('death', 3000);
  });

  bot.on('end', () => {
    if (physicsMonitorId) {
      clearInterval(physicsMonitorId);
      physicsMonitorId = null;
    }
  });

  async function goto(position, range = 0, options = {}) {
    const pathfinderPlugin = await preparePathing(options);
    const target = toVec3(position).floored();
    const goal =
      range > 0
        ? new GoalNear(target.x, target.y, target.z, range)
        : new GoalBlock(target.x, target.y, target.z);

    try {
      await pathfinderPlugin.goto(goal);

      return {
        position: serializeVec3(target),
        range,
      };
    } finally {
      holdPhysics('goto_complete', 1200);
    }
  }

  async function gotoBlock(block, range = 1, options = {}) {
    const pathfinderPlugin = await preparePathing(options);

    if (!block?.position) {
      throw new Error('A block with a position is required');
    }

    const target = block.position.floored();
    const goal =
      range <= 1
        ? new GoalGetToBlock(target.x, target.y, target.z)
        : new GoalNear(target.x, target.y, target.z, range);

    try {
      await pathfinderPlugin.goto(goal);

      return {
        block: block.name,
        position: serializeVec3(target),
        range,
      };
    } finally {
      holdPhysics('goto_block_complete', 1200);
    }
  }

  async function gotoLookAt(position, reach = 4.5, options = {}) {
    const pathfinderPlugin = await preparePathing(options);
    const target = toVec3(position).floored();
    const goal = new GoalLookAtBlock(target, bot.world, { reach });

    try {
      await pathfinderPlugin.goto(goal);

      return {
        position: serializeVec3(target),
        reach,
      };
    } finally {
      holdPhysics('goto_look_complete', 1200);
    }
  }

  async function gotoPlace(position, options = {}) {
    const pathfinderPlugin = await preparePathing(options);
    const target = toVec3(position).floored();
    const goal = new GoalPlaceBlock(target, bot.world, {
      range: options.range ?? 4,
      LOS: options.LOS ?? true,
    });

    try {
      await pathfinderPlugin.goto(goal);

      return {
        position: serializeVec3(target),
        range: options.range ?? 4,
      };
    } finally {
      holdPhysics('goto_place_complete', 1200);
    }
  }

  function followEntity(entity, range = 2) {
    requireSpawned(bot);

    if (!entity?.position) {
      throw new Error('Entity with position is required');
    }

    const pathfinderPlugin = getPathfinder();
    holdPhysics('follow_entity', 5000);
    ensureMovements();

    const followRange = Math.max(0.5, range);
    followState = {
      entityId: entity.id,
      range: followRange,
    };

    pathfinderPlugin.setGoal(new GoalFollow(entity, followRange), true);

    events.push('pathing:follow_started', {
      entity: serializeEntity(entity),
      range: followRange,
    });

    return {
      entity: serializeEntity(entity),
      range: followRange,
    };
  }

  async function moveAwayFrom(position, minDistance = 12, options = {}) {
    const pathfinderPlugin = await preparePathing(options);
    const threat = toVec3(position).floored();
    const goal = new GoalInvert(
      new GoalNear(threat.x, threat.y, threat.z, Math.max(1, minDistance - 1)),
    );

    try {
      await pathfinderPlugin.goto(goal);

      return {
        threat: serializeVec3(threat),
        minDistance,
      };
    } finally {
      holdPhysics('move_away_complete', 1200);
    }
  }

  function configure(options = {}) {
    Object.assign(pendingMovementOptions, options);
    ensurePathfinderLoaded();
    const nextMovements = ensureMovements();
    getPathfinder().setMovements(nextMovements);

    return {
      allow1by1towers: nextMovements.allow1by1towers,
      allowFreeMotion: nextMovements.allowFreeMotion,
      allowParkour: nextMovements.allowParkour,
      allowSprinting: nextMovements.allowSprinting,
      canDig: nextMovements.canDig,
      canOpenDoors: nextMovements.canOpenDoors,
      maxDropDown: nextMovements.maxDropDown,
    };
  }

  function stop() {
    clearFollowState('stop');

    if (bot.pathfinder) {
      bot.pathfinder.setGoal(null);
    }

    holdPhysics('stop', 1000);
  }

  function pause(durationMs = 750, reason = 'manual_pause') {
    pausedUntil = Math.max(pausedUntil, Date.now() + durationMs);

    if (bot.pathfinder) {
      bot.pathfinder.setGoal(null);
    }

    clearFollowState(reason);
    holdPhysics(reason, Math.max(durationMs, 1000));
    events.push('pathing:paused', {
      durationMs,
      reason,
    });

    return {
      durationMs,
      reason,
      until: new Date(pausedUntil).toISOString(),
    };
  }

  function stabilize(durationMs = 750, reason = 'manual_stabilize') {
    holdPhysics(reason, Math.max(durationMs, 1000));
    events.push('pathing:stabilized', {
      durationMs,
      reason,
    });

    return {
      durationMs,
      reason,
      holdUntil: new Date(physicsHoldUntil).toISOString(),
    };
  }

  function status() {
    const pathfinderPlugin = bot.pathfinder;
    const remainingPauseMs = Math.max(0, pausedUntil - Date.now());
    const remainingPhysicsHoldMs = Math.max(0, physicsHoldUntil - Date.now());

    if (!pathfinderPlugin) {
      return {
        building: false,
        goal: null,
        hasGoal: false,
        mining: false,
        moving: false,
        pausedMs: remainingPauseMs,
        physicsEnabled: bot.physicsEnabled,
        physicsHoldMs: remainingPhysicsHoldMs,
        ready: false,
      };
    }

    return {
      moving: pathfinderPlugin.isMoving(),
      mining: pathfinderPlugin.isMining(),
      building: pathfinderPlugin.isBuilding(),
      hasGoal: Boolean(pathfinderPlugin.goal),
      goal: pathfinderPlugin.goal?.constructor?.name ?? null,
      physicsEnabled: bot.physicsEnabled,
      physicsHoldMs: remainingPhysicsHoldMs,
      pausedMs: remainingPauseMs,
      ready: true,
      thinkTimeout: pathfinderPlugin.thinkTimeout,
      tickTimeout: pathfinderPlugin.tickTimeout,
      searchRadius: pathfinderPlugin.searchRadius,
      movement: {
        allow1by1towers: movements?.allow1by1towers ?? pendingMovementOptions.allow1by1towers,
        allowParkour: movements?.allowParkour ?? pendingMovementOptions.allowParkour,
        allowSprinting: movements?.allowSprinting ?? pendingMovementOptions.allowSprinting,
        canDig: movements?.canDig ?? pendingMovementOptions.canDig,
        maxDropDown: movements?.maxDropDown ?? pendingMovementOptions.maxDropDown,
      },
      follow: followState
        ? {
            entityId: followState.entityId,
            range: followState.range,
          }
        : null,
    };
  }

  return {
    configure,
    followEntity,
    get movements() {
      ensurePathfinderLoaded();
      return ensureMovements();
    },
    goto,
    gotoBlock,
    gotoLookAt,
    gotoPlace,
    moveAwayFrom,
    pause,
    status,
    stabilize,
    stop,
  };
}

module.exports = {
  createPathingModule,
};
