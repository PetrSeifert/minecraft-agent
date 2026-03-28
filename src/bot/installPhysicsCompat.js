const { Vec3 } = require('vec3');
const { PlayerState } = require('prismarine-physics');

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function isFiniteVec3(vec) {
  return (
    vec &&
    isFiniteNumber(vec.x) &&
    isFiniteNumber(vec.y) &&
    isFiniteNumber(vec.z)
  );
}

function cloneVec3(vec, fallback = new Vec3(0, 0, 0)) {
  const source = isFiniteVec3(vec) ? vec : fallback;
  return new Vec3(source.x, source.y, source.z);
}

function sanitizeControl(control = {}) {
  return {
    back: Boolean(control.back),
    forward: Boolean(control.forward),
    jump: Boolean(control.jump),
    left: Boolean(control.left),
    right: Boolean(control.right),
    sneak: Boolean(control.sneak),
    sprint: Boolean(control.sprint),
  };
}

function sanitizeAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') {
    return {};
  }

  const safe = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    if (!isFiniteNumber(value.value)) {
      continue;
    }

    safe[key] = {
      modifiers: Array.isArray(value.modifiers) ? value.modifiers : [],
      value: value.value,
    };
  }

  return safe;
}

function sanitizeState(bot, source) {
  const safe = new PlayerState(bot, sanitizeControl(source?.control));

  safe.pos = cloneVec3(source?.pos, bot.entity?.position);
  safe.vel = cloneVec3(source?.vel, bot.entity?.velocity);
  safe.onGround = Boolean(source?.onGround);
  safe.isInWater = Boolean(source?.isInWater);
  safe.isInLava = Boolean(source?.isInLava);
  safe.isInWeb = Boolean(source?.isInWeb);
  safe.isCollidedHorizontally = Boolean(source?.isCollidedHorizontally);
  safe.isCollidedVertically = Boolean(source?.isCollidedVertically);
  safe.elytraFlying = Boolean(source?.elytraFlying);
  safe.jumpTicks = isFiniteNumber(source?.jumpTicks) ? source.jumpTicks : 0;
  safe.jumpQueued = Boolean(source?.jumpQueued);
  safe.fireworkRocketDuration = isFiniteNumber(source?.fireworkRocketDuration)
    ? source.fireworkRocketDuration
    : 0;
  safe.attributes = sanitizeAttributes(source?.attributes);
  safe.yaw = isFiniteNumber(source?.yaw) ? source.yaw : 0;
  safe.pitch = isFiniteNumber(source?.pitch) ? source.pitch : 0;
  safe.jumpBoost = isFiniteNumber(source?.jumpBoost) ? source.jumpBoost : 0;
  safe.speed = isFiniteNumber(source?.speed) ? source.speed : 0;
  safe.slowness = isFiniteNumber(source?.slowness) ? source.slowness : 0;
  safe.dolphinsGrace = isFiniteNumber(source?.dolphinsGrace)
    ? source.dolphinsGrace
    : 0;
  safe.slowFalling = isFiniteNumber(source?.slowFalling) ? source.slowFalling : 0;
  safe.levitation = isFiniteNumber(source?.levitation) ? source.levitation : 0;
  safe.depthStrider = isFiniteNumber(source?.depthStrider) ? source.depthStrider : 0;
  safe.elytraEquipped = Boolean(source?.elytraEquipped);

  return safe;
}

function hasFinitePhysicsState(state) {
  return isFiniteVec3(state?.pos) && isFiniteVec3(state?.vel);
}

function installPhysicsCompat(bot) {
  if (!bot.physics?.simulatePlayer) {
    return false;
  }

  if (bot.physics.__compatWrappedSimulatePlayer) {
    return true;
  }

  const originalSimulatePlayer = bot.physics.simulatePlayer.bind(bot.physics);
  bot.physics.__compatWrappedSimulatePlayer = true;

  bot.physics.simulatePlayer = (state, world) => {
    const baseline = sanitizeState(bot, state);
    const result = originalSimulatePlayer(state, world);

    if (hasFinitePhysicsState(result)) {
      return result;
    }

    const recovered = originalSimulatePlayer(sanitizeState(bot, baseline), world);

    if (hasFinitePhysicsState(recovered)) {
      bot.emit('physicsAnomaly', {
        kind: 'recovered_invalid_state',
        position: {
          x: recovered.pos.x,
          y: recovered.pos.y,
          z: recovered.pos.z,
        },
        velocity: {
          x: recovered.vel.x,
          y: recovered.vel.y,
          z: recovered.vel.z,
        },
      });
      return recovered;
    }

    bot.emit('physicsAnomaly', {
      kind: 'fallback_preserved_state',
      position: {
        x: baseline.pos.x,
        y: baseline.pos.y,
        z: baseline.pos.z,
      },
      velocity: {
        x: baseline.vel.x,
        y: baseline.vel.y,
        z: baseline.vel.z,
      },
    });

    return baseline;
  };

  return true;
}

module.exports = {
  installPhysicsCompat,
};
