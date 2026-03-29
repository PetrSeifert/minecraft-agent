import { distanceToBot, isHostileEntity, serializeEntity, toVec3 } from '../utils';
import { instrumentAsyncOperation } from '../operationEvents';

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

  async function attackEntityOperation(
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

  async function attackNearestHostileOperation(
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

  const attackEntity = instrumentAsyncOperation(events, {
    action: 'combat.attackEntity',
    failure: ([entity], error) => ({
      priority: 9,
      tags: ['combat', 'attack'],
      text: `Failed to attack ${entity?.name ?? entity?.username ?? 'target'}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([entity]) => ({
      priority: 5,
      tags: ['combat', 'attack'],
      text: `Attacking ${entity?.name ?? entity?.username ?? 'target'}`,
    }),
    success: (_args, entity) => ({
      priority: 7,
      tags: ['combat', 'attack'],
      text: `Attacked ${entity?.name ?? entity?.username ?? 'target'}`,
    }),
  }, attackEntityOperation);

  const attackNearestHostile = instrumentAsyncOperation(events, {
    action: 'combat.attackNearestHostile',
    failure: ([maxDistance = 16], error) => ({
      priority: 9,
      tags: ['combat', 'attack', 'hostile'],
      text: `Failed to attack nearest hostile within ${maxDistance}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([maxDistance = 16]) => ({
      priority: 5,
      tags: ['combat', 'attack', 'hostile'],
      text: `Attacking nearest hostile within ${maxDistance}`,
    }),
    success: (_args, entity) => ({
      priority: 7,
      tags: ['combat', 'attack', 'hostile'],
      text: `Attacked hostile ${entity?.name ?? entity?.username ?? 'target'}`,
    }),
  }, attackNearestHostileOperation);

  return {
    attackEntity,
    attackNearestHostile,
    hostiles,
  };
}
