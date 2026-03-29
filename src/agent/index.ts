import { createKnockbackDebugger } from './debug/knockback';
import { EventStream } from './eventStream';
import { createActionsModule } from './modules/actions';
import { createChatModule } from './modules/chat';
import { createCombatModule } from './modules/combat';
import { createInventoryModule } from './modules/inventory';
import { createMemoryModule } from './modules/memory';
import { createOrchestrationModule } from './modules/orchestration';
import { createPathingModule } from './modules/pathing';
import { createSafetyModule } from './modules/safety';
import { createWorldModule } from './modules/world';
import {
  serializeBlock,
  serializeEntity,
  serializeVec3,
  serializeWindow,
} from './utils';

import type { Agent, BotConfig, MinecraftBot } from '../types';

export function createAgent(
  bot: MinecraftBot,
  config: Partial<BotConfig> = {},
): Agent {
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
    events,
    pathing,
    world,
  });
  safety.enable();
  const memory = createMemoryModule(bot, {
    events,
    safety,
  });
  const orchestration = createOrchestrationModule(bot, {
    chat,
    events,
    inventory,
    memory,
    safety,
    world,
  });
  const knockbackDebug = createKnockbackDebugger(bot, pathing, {
    enabled: config.debugKnockback,
    filePath: config.debugKnockbackFile,
  });

  const agent: Agent = {
    actions,
    chat,
    combat,
    debug: {
      knockback: knockbackDebug,
    },
    events,
    inventory,
    memory,
    orchestration,
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
    events.push('window:open', serializeWindow(window as never));
  });

  bot.on('windowClose', (window) => {
    events.push('window:close', serializeWindow(window as never));
  });

  bot.agent = agent;
  return agent;
}
