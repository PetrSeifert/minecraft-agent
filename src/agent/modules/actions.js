const { Vec3 } = require('vec3');

const {
  CARDINAL_FACES,
  requireSpawned,
  resolveItem,
  serializeBlock,
  serializeItem,
  serializeWindow,
  toVec3,
} = require('../utils');

function createActionsModule(bot, context) {
  const { events, inventory, pathing, world } = context;

  async function mineBlockAt(position, options = {}) {
    requireSpawned(bot);

    const block = world.getBlockAt(position);

    if (!block) {
      throw new Error('No block found at the requested position');
    }

    await pathing.gotoLookAt(block.position, options.reach ?? 4.5);

    if (!bot.canDigBlock(block)) {
      throw new Error(`Block is not diggable from current position: ${block.name}`);
    }

    const bestTool = bot.pathfinder.bestHarvestTool(block);

    if (bestTool) {
      await bot.equip(bestTool, 'hand');
    }

    await bot.dig(block, options.forceLook ?? true);

    events.push('action:mine', {
      block: serializeBlock(block),
      tool: serializeItem(bestTool),
    });

    return serializeBlock(block);
  }

  function findCraftingTable(position = null) {
    if (position) {
      const craftingTable = world.getBlockAt(position);

      if (!craftingTable || craftingTable.name !== 'crafting_table') {
        throw new Error('No crafting table at the provided position');
      }

      return craftingTable;
    }

    const tableDetails = world.findBlockByName('crafting_table', { maxDistance: 16 });
    return tableDetails ? world.getBlockAt(tableDetails.position) : null;
  }

  async function craftItem(name, count = 1, craftingTablePosition = null) {
    requireSpawned(bot);

    const itemDefinition = resolveItem(bot, name);
    let craftingTable = null;
    let recipe = bot.recipesFor(itemDefinition.id, null, 1, null)[0] ?? null;

    if (!recipe) {
      craftingTable = findCraftingTable(craftingTablePosition);

      if (!craftingTable) {
        throw new Error(`No available recipe for ${itemDefinition.name} without a crafting table`);
      }

      await pathing.gotoBlock(craftingTable, 1);
      recipe = bot.recipesFor(itemDefinition.id, null, 1, craftingTable)[0] ?? null;
    }

    if (!recipe) {
      throw new Error(`No craftable recipe found for ${itemDefinition.name}`);
    }

    await bot.craft(recipe, count, craftingTable);

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

  function resolvePlacementReference(targetPosition) {
    for (const face of CARDINAL_FACES) {
      const referencePosition = targetPosition.minus(face);
      const referenceBlock = bot.blockAt(referencePosition);

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

  async function placeBlockAt(itemName, position) {
    requireSpawned(bot);

    const targetPosition = toVec3(position).floored();
    const targetBlock = bot.blockAt(targetPosition);

    if (targetBlock && targetBlock.boundingBox !== 'empty' && targetBlock.name !== 'water') {
      throw new Error(`Target position is occupied by ${targetBlock.name}`);
    }

    const item = await inventory.equip(itemName, 'hand');
    const placement = resolvePlacementReference(targetPosition);

    if (!placement) {
      throw new Error('Could not find a solid reference block next to the target position');
    }

    await pathing.gotoPlace(targetPosition);
    await bot.placeBlock(placement.referenceBlock, placement.face);

    const placedBlock = bot.blockAt(targetPosition) ?? targetBlock;

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

  async function openContainerAt(position) {
    requireSpawned(bot);

    const block = world.getBlockAt(position);

    if (!block) {
      throw new Error('No block found at the requested position');
    }

    await pathing.gotoLookAt(block.position, 4.5);

    const container = await bot.openContainer(
      block,
      new Vec3(0, 1, 0),
      new Vec3(0.5, 0.5, 0.5),
    );

    events.push('action:open_container', {
      block: serializeBlock(block),
      window: serializeWindow(container),
    });

    return {
      block: serializeBlock(block),
      container,
      items:
        typeof container.containerItems === 'function'
          ? container.containerItems().map(serializeItem)
          : [],
      window: serializeWindow(container),
    };
  }

  return {
    craftItem,
    mineBlockAt,
    openContainerAt,
    placeBlockAt,
  };
}

module.exports = {
  createActionsModule,
};
