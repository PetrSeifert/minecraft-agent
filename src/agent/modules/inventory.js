const {
  normalizeMinecraftName,
  resolveItem,
  serializeItem,
} = require('../utils');

function createInventoryModule(bot, events) {
  function items() {
    return bot.inventory.items().map(serializeItem);
  }

  function heldItem() {
    return serializeItem(bot.heldItem);
  }

  function findItemByName(name) {
    const itemDefinition = resolveItem(bot, name);
    return bot.inventory.items().find((item) => item.type === itemDefinition.id) ?? null;
  }

  function count(name) {
    const itemName = normalizeMinecraftName(name);

    return bot
      .inventory.items()
      .filter((item) => item.name === itemName)
      .reduce((sum, item) => sum + item.count, 0);
  }

  async function equip(name, destination = 'hand') {
    const item = findItemByName(name);

    if (!item) {
      throw new Error(`Item not in inventory: "${name}"`);
    }

    await bot.equip(item, destination);
    events.push('inventory:equip', {
      destination,
      item: serializeItem(item),
    });

    return serializeItem(item);
  }

  async function toss(name, countValue = 1) {
    const itemDefinition = resolveItem(bot, name);
    await bot.toss(itemDefinition.id, null, countValue);

    events.push('inventory:toss', {
      count: countValue,
      name: itemDefinition.name,
    });

    return {
      count: countValue,
      name: itemDefinition.name,
    };
  }

  function hotbarSlot() {
    return bot.quickBarSlot;
  }

  function summary() {
    return {
      slotsUsed: bot.inventory.items().length,
      heldItem: heldItem(),
      hotbarSlot: hotbarSlot(),
      items: items(),
    };
  }

  return {
    count,
    equip,
    findItemByName,
    heldItem,
    hotbarSlot,
    items,
    summary,
    toss,
  };
}

module.exports = {
  createInventoryModule,
};
