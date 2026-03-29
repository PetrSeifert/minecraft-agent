import { Vec3 } from 'vec3';

import { instrumentAsyncOperation } from '../operationEvents';
import {
  CARDINAL_FACES,
  requireSpawned,
  resolveItem,
  serializeBlock,
  serializeItem,
  serializeWindow,
  toVec3,
} from '../utils';

import type {
  ActionsModule,
  BlockLike,
  EventStreamLike,
  InventoryModule,
  MinecraftBot,
  PathingModule,
  Vec3Like,
  WindowLike,
  WorldModule,
} from '../../types';

interface ActionsContext {
  events: EventStreamLike;
  inventory: InventoryModule;
  pathing: PathingModule;
  world: WorldModule;
}

function formatPosition(position: Vec3Like | Vec3): string {
  const vec = toVec3(position).floored();
  return `${vec.x},${vec.y},${vec.z}`;
}

export function createActionsModule(
  bot: MinecraftBot,
  context: ActionsContext,
): ActionsModule {
  const { events, inventory, pathing, world } = context;

  async function mineBlockAtOperation(
    position: Vec3Like,
    options: { forceLook?: boolean; reach?: number } = {},
  ) {
    requireSpawned(bot);

    const block = world.getBlockAt(position);

    if (!block?.position) {
      throw new Error('No block found at the requested position');
    }

    await pathing.gotoLookAt(block.position, options.reach ?? 4.5);

    if (!bot.canDigBlock(block as never)) {
      throw new Error(`Block is not diggable from current position: ${block.name}`);
    }

    const bestTool = bot.pathfinder?.bestHarvestTool(block as never) ?? null;

    if (bestTool) {
      await bot.equip(bestTool as never, 'hand');
    }

    await bot.dig(block as never, options.forceLook ?? true);

    events.push('action:mine', {
      block: serializeBlock(block),
      tool: serializeItem(bestTool as never),
    });

    return serializeBlock(block);
  }

  function findCraftingTable(position: Vec3Like | null = null): BlockLike | null {
    if (position) {
      const craftingTable = world.getBlockAt(position);

      if (!craftingTable || craftingTable.name !== 'crafting_table') {
        throw new Error('No crafting table at the provided position');
      }

      return craftingTable;
    }

    const tableDetails = world.findBlockByName('crafting_table', { maxDistance: 16 });
    return tableDetails?.position ? world.getBlockAt(tableDetails.position) : null;
  }

  async function craftItemOperation(
    name: string,
    count = 1,
    craftingTablePosition: Vec3Like | null = null,
  ) {
    requireSpawned(bot);

    const itemDefinition = resolveItem(bot, name);
    let craftingTable: BlockLike | null = null;
    let recipe = bot.recipesFor(itemDefinition.id, null, 1, null)[0] ?? null;

    if (!recipe) {
      craftingTable = findCraftingTable(craftingTablePosition);

      if (!craftingTable) {
        throw new Error(`No available recipe for ${itemDefinition.name} without a crafting table`);
      }

      await pathing.gotoBlock(craftingTable, 1);
      recipe = bot.recipesFor(itemDefinition.id, null, 1, craftingTable as never)[0] ?? null;
    }

    if (!recipe) {
      throw new Error(`No craftable recipe found for ${itemDefinition.name}`);
    }

    await bot.craft(recipe, count, craftingTable as never);

    events.push('action:craft', {
      count,
      craftingTable: serializeBlock(craftingTable),
      item: itemDefinition.name,
    });

    return {
      count,
      item: itemDefinition.name,
      craftingTable: serializeBlock(craftingTable),
    };
  }

  function resolvePlacementReference(targetPosition: Vec3) {
    for (const face of CARDINAL_FACES) {
      const referencePosition = targetPosition.minus(face);
      const referenceBlock = bot.blockAt(referencePosition) as BlockLike | null;

      if (!referenceBlock) {
        continue;
      }

      if (referenceBlock.boundingBox !== 'block') {
        continue;
      }

      return {
        face,
        referenceBlock,
      };
    }

    return null;
  }

  async function placeBlockAtOperation(itemName: string, position: Vec3Like) {
    requireSpawned(bot);

    const targetPosition = toVec3(position).floored();
    const targetBlock = bot.blockAt(targetPosition) as BlockLike | null;

    if (
      targetBlock &&
      targetBlock.boundingBox !== 'empty' &&
      targetBlock.name !== 'water'
    ) {
      throw new Error(`Target position is occupied by ${targetBlock.name}`);
    }

    const item = await inventory.equip(itemName, 'hand');
    const placement = resolvePlacementReference(targetPosition);

    if (!placement) {
      throw new Error('Could not find a solid reference block next to the target position');
    }

    await pathing.gotoPlace(targetPosition);
    await bot.placeBlock(placement.referenceBlock as never, placement.face);

    const placedBlock = (bot.blockAt(targetPosition) as BlockLike | null) ?? targetBlock;

    events.push('action:place', {
      item,
      position: {
        x: targetPosition.x,
        y: targetPosition.y,
        z: targetPosition.z,
      },
    });

    return serializeBlock(placedBlock);
  }

  async function openContainerAtOperation(position: Vec3Like) {
    requireSpawned(bot);

    const block = world.getBlockAt(position);

    if (!block?.position) {
      throw new Error('No block found at the requested position');
    }

    await pathing.gotoLookAt(block.position, 4.5);

    const container = (await bot.openContainer(
      block as never,
      new Vec3(0, 1, 0),
      new Vec3(0.5, 0.5, 0.5),
    )) as WindowLike & { close(): void };

    events.push('action:open_container', {
      block: serializeBlock(block),
      window: serializeWindow(container),
    });

    return {
      block: serializeBlock(block),
      container,
      items:
        typeof container.containerItems === 'function'
          ? container.containerItems().map((item) => serializeItem(item))
          : [],
      window: serializeWindow(container),
    };
  }

  const mineBlockAt = instrumentAsyncOperation(events, {
    action: 'actions.mineBlockAt',
    failure: ([position], error) => ({
      priority: 8,
      tags: ['actions', 'mine'],
      text: `Failed to mine block at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([position]) => ({
      priority: 4,
      tags: ['actions', 'mine'],
      text: `Mining block at ${formatPosition(position)}`,
    }),
    success: (_args, block) => ({
      priority: 6,
      tags: ['actions', 'mine'],
      text: `Mined ${block?.name ?? 'block'}`,
    }),
  }, mineBlockAtOperation);

  const craftItem = instrumentAsyncOperation(events, {
    action: 'actions.craftItem',
    failure: ([name, count = 1], error) => ({
      priority: 8,
      tags: ['actions', 'craft'],
      text: `Failed to craft ${count} ${name}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([name, count = 1]) => ({
      priority: 4,
      tags: ['actions', 'craft'],
      text: `Crafting ${count} ${name}`,
    }),
    success: (_args, result) => ({
      priority: 6,
      tags: ['actions', 'craft'],
      text: `Crafted ${result.count} ${result.item}`,
    }),
  }, craftItemOperation);

  const placeBlockAt = instrumentAsyncOperation(events, {
    action: 'actions.placeBlockAt',
    failure: ([itemName, position], error) => ({
      priority: 8,
      tags: ['actions', 'place'],
      text: `Failed to place ${itemName} at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([itemName, position]) => ({
      priority: 4,
      tags: ['actions', 'place'],
      text: `Placing ${itemName} at ${formatPosition(position)}`,
    }),
    success: (_args, block) => ({
      priority: 6,
      tags: ['actions', 'place'],
      text: `Placed ${block?.name ?? 'block'}`,
    }),
  }, placeBlockAtOperation);

  const openContainerAt = instrumentAsyncOperation(events, {
    action: 'actions.openContainerAt',
    failure: ([position], error) => ({
      priority: 8,
      tags: ['actions', 'container'],
      text: `Failed to open container at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([position]) => ({
      priority: 4,
      tags: ['actions', 'container'],
      text: `Opening container at ${formatPosition(position)}`,
    }),
    success: (_args, result) => ({
      priority: 6,
      tags: ['actions', 'container'],
      text: `Opened ${result.block?.name ?? 'container'}`,
    }),
  }, openContainerAtOperation);

  return {
    craftItem,
    mineBlockAt,
    openContainerAt,
    placeBlockAt,
  };
}
