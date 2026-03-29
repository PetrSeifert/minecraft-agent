import { distanceToBot, isHostileEntity, serializeEntity, toVec3 } from '../utils';

import type {
  CombatModule,
  EntityLike,
  EventStreamLike,
  MinecraftBot,
  PathingModule,
  WorldModule,
} from '../../types';

interface CombatContext {
  events: EventStreamLike;
  pathing: PathingModule;
  world: WorldModule;
}

export function createCombatModule(
  bot: MinecraftBot,
  context: CombatContext,
): CombatModule {
  const { events, pathing, world } = context;

  async function attackEntity(
    entity: EntityLike,
    options: { approachRange?: number; swing?: boolean } = {},
  ) {
    if (!entity?.position) {
      throw new Error('A valid entity target is required');
    }

    const approachRange = options.approachRange ?? 3;

    if (distanceToBot(bot, entity.position) > approachRange) {
      await pathing.goto(entity.position, approachRange);
    }

    await bot.lookAt(toVec3(entity.position).offset(0, entity.height ?? 1, 0), true);
    (bot as any).attack(entity, options.swing ?? true);

    events.push('combat:attack', {
      entity: serializeEntity(entity),
      swing: options.swing ?? true,
    });

    return serializeEntity(entity);
  }

  async function attackNearestHostile(
    maxDistance = 16,
    options: { approachRange?: number; swing?: boolean } = {},
  ) {
    const entity = world.nearestHostile(maxDistance);

    if (!entity) {
      throw new Error(`No hostile entities found within ${maxDistance} blocks`);
    }

    return attackEntity(entity, options);
  }

  function hostiles(maxDistance = 16) {
    return world.nearbyEntities({
      maxDistance,
      matcher: isHostileEntity,
    });
  }

  return {
    attackEntity,
    attackNearestHostile,
    hostiles,
  };
}
