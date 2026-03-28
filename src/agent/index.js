const { EventStream } = require('./eventStream');
const { createActionsModule } = require('./modules/actions');
const { createChatModule } = require('./modules/chat');
const { createCombatModule } = require('./modules/combat');
const { createInventoryModule } = require('./modules/inventory');
const { createPathingModule } = require('./modules/pathing');
const { createSafetyModule } = require('./modules/safety');
const { createWorldModule } = require('./modules/world');
const { createKnockbackDebugger } = require('./debug/knockback');
const {
  serializeBlock,
  serializeEntity,
  serializeVec3,
  serializeWindow,
} = require('./utils');

function createAgent(bot, config = {}) {
  const events = new EventStream();
  const chat = createChatModule(bot, events);
  const world = createWorldModule(bot);
  const pathing = createPathingModule(bot, events);
  const inventory = createInventoryModule(bot, events);
  const actions = createActionsModule(bot, {
    events,
    inventory,
    pathing,
    world,
  });
  const combat = createCombatModule(bot, {
    events,
    pathing,
    world,
  });
  const safety = createSafetyModule(bot, {
    combat,
    pathing,
    world,
  });
  safety.enable();
  const knockbackDebug = createKnockbackDebugger(bot, pathing, {
    enabled: config.debugKnockback,
    filePath: config.debugKnockbackFile,
  });

  const agent = {
    actions,
    chat,
    combat,
    debug: {
      knockback: knockbackDebug,
    },
    events,
    inventory,
    pathing,
    safety,
    world,
  };

  bot.once('login', () => {
    events.push('bot:login', { username: bot.username });
  });

  bot.once('spawn', () => {
    events.push('bot:spawn', {
      position: serializeVec3(bot.entity.position),
    });
  });

  bot.on('end', (reason) => {
    events.push('bot:end', { reason: reason ?? null });
  });

  bot.on('kicked', (reason) => {
    events.push('bot:kicked', { reason });
  });

  bot.on('error', (error) => {
    events.push('bot:error', { message: error?.message ?? String(error) });
  });

  bot.on('health', () => {
    events.push('bot:health', {
      food: bot.food ?? null,
      health: bot.health ?? null,
      oxygenLevel: bot.oxygenLevel ?? null,
    });
  });

  bot.on('death', () => {
    events.push('bot:death', null);
  });

  bot.on('playerJoined', (player) => {
    events.push('player:joined', {
      username: player.username ?? null,
      uuid: player.uuid ?? null,
    });
  });

  bot.on('playerLeft', (player) => {
    events.push('player:left', {
      username: player.username ?? null,
      uuid: player.uuid ?? null,
    });
  });

  bot.on('entitySpawn', (entity) => {
    events.push('entity:spawn', serializeEntity(entity));
  });

  bot.on('entityGone', (entity) => {
    events.push('entity:gone', serializeEntity(entity));
  });

  bot.on('entityHurt', (entity) => {
    if (entity?.id === bot.entity?.id) {
      const stabilize = pathing.stabilize(1000, 'self_hurt');
      events.push('safety:self_hurt_stabilize', stabilize);
    }

    events.push('entity:hurt', serializeEntity(entity));
  });

  bot.on('entityDead', (entity) => {
    events.push('entity:dead', serializeEntity(entity));
  });

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    events.push('world:block_update', {
      newBlock: serializeBlock(newBlock),
      oldBlock: serializeBlock(oldBlock),
    });
  });

  bot.on('windowOpen', (window) => {
    events.push('window:open', serializeWindow(window));
  });

  bot.on('windowClose', (window) => {
    events.push('window:close', serializeWindow(window));
  });

  bot.agent = agent;
  return agent;
}

module.exports = {
  createAgent,
};
