const fs = require('node:fs');
const path = require('node:path');

const { serializeVec3 } = require('../utils');

function serializeControls(bot) {
  return {
    back: bot.controlState?.back ?? false,
    forward: bot.controlState?.forward ?? false,
    jump: bot.controlState?.jump ?? false,
    left: bot.controlState?.left ?? false,
    right: bot.controlState?.right ?? false,
    sneak: bot.controlState?.sneak ?? false,
    sprint: bot.controlState?.sprint ?? false,
  };
}

function blockSummary(block) {
  if (!block) {
    return null;
  }

  return {
    boundingBox: block.boundingBox ?? null,
    name: block.name ?? null,
    position: serializeVec3(block.position),
  };
}

function createKnockbackDebugger(bot, pathing, options = {}) {
  const enabled = Boolean(options.enabled);

  if (!enabled) {
    return {
      enabled: false,
    };
  }

  const filePath = path.resolve(options.filePath || 'knockback-debug.log');
  let sampleTicksRemaining = 0;
  let sequence = 0;

  fs.appendFileSync(
    filePath,
    `\n# knockback debug session ${new Date().toISOString()}\n`,
  );

  function snapshot() {
    const feetPosition = bot.entity?.position?.floored?.() ?? null;
    const groundPosition = feetPosition?.offset?.(0, -1, 0) ?? null;

    return {
      blockFeet: blockSummary(feetPosition ? bot.blockAt(feetPosition) : null),
      blockGround: blockSummary(groundPosition ? bot.blockAt(groundPosition) : null),
      controlState: serializeControls(bot),
      food: bot.food ?? null,
      health: bot.health ?? null,
      jumpQueued: bot.jumpQueued ?? null,
      onGround: bot.entity?.onGround ?? null,
      oxygenLevel: bot.oxygenLevel ?? null,
      pathing: pathing.status(),
      physicsEnabled: bot.physicsEnabled,
      position: serializeVec3(bot.entity?.position),
      velocity: serializeVec3(bot.entity?.velocity),
    };
  }

  function write(event, payload = {}) {
    const line = JSON.stringify({
      event,
      payload,
      sequence: ++sequence,
      state: snapshot(),
      timestamp: new Date().toISOString(),
    });

    fs.appendFileSync(filePath, `${line}\n`);
  }

  function sampleTicks(reason, count = 30) {
    sampleTicksRemaining = Math.max(sampleTicksRemaining, count);
    write('sample_ticks_start', { count, reason });
  }

  bot.on('entityHurt', (entity) => {
    if (entity?.id !== bot.entity?.id) {
      return;
    }

    write('self_hurt');
    sampleTicks('self_hurt', 40);
  });

  bot._client.on('entity_velocity', (packet) => {
    if (packet.entityId !== bot.entity?.id) {
      return;
    }

    write('entity_velocity', { packet });
    sampleTicks('entity_velocity', 40);
  });

  bot._client.on('position', (packet) => {
    write('server_position', { packet });
    sampleTicks('server_position', 40);
  });

  bot._client.on('explosion', (packet) => {
    write('explosion', { packet });
    sampleTicks('explosion', 40);
  });

  bot.on('forcedMove', () => {
    write('forced_move');
    sampleTicks('forced_move', 20);
  });

  bot.on('physicsTick', () => {
    if (sampleTicksRemaining <= 0) {
      return;
    }

    write('physics_tick', { remaining: sampleTicksRemaining });
    sampleTicksRemaining -= 1;
  });

  bot.on('move', () => {
    if (sampleTicksRemaining <= 0) {
      return;
    }

    write('move');
  });

  bot.on('physicsAnomaly', (details) => {
    write('physics_anomaly', details);
    sampleTicks('physics_anomaly', 20);
  });

  bot.on('kicked', (reason) => {
    write('kicked', { reason });
  });

  bot.on('error', (error) => {
    write('error', { message: error?.message ?? String(error) });
  });

  bot.on('end', () => {
    write('end');
  });

  write('debug_enabled', { filePath });

  return {
    enabled: true,
    filePath,
    sampleTicks,
    write,
  };
}

module.exports = {
  createKnockbackDebugger,
};
