import {
  normalizeMinecraftName,
  resolveItem,
  serializeItem,
} from '../utils';

import type {
  EventStreamLike,
  InventoryModule,
  ItemLike,
  MinecraftBot,
  SerializedItem,
} from '../../types';

export function createInventoryModule(
  bot: MinecraftBot,
  events: EventStreamLike,
): InventoryModule {
  function items(): Array<SerializedItem | null> {
    return bot.inventory.items().map((item) => serializeItem(item as ItemLike | null));
  }

  function heldItem(): SerializedItem | null {
    return serializeItem(bot.heldItem as ItemLike | null);
  }

  function findItemByName(name: string): ItemLike | null {
    const itemDefinition = resolveItem(bot, name);
    return (
      bot.inventory
        .items()
        .find((item) => item.type === itemDefinition.id) as ItemLike | undefined
    ) ?? null;
  }

  function count(name: string): number {
    const itemName = normalizeMinecraftName(name);

    return bot
      .inventory.items()
      .filter((item) => item.name === itemName)
      .reduce((sum, item) => sum + item.count, 0);
  }

  async function equip(
    name: string,
    destination = 'hand',
  ): Promise<SerializedItem | null> {
    const item = findItemByName(name);

    if (!item) {
      throw new Error(`Item not in inventory: "${name}"`);
    }

    await bot.equip(item as never, destination as never);
    events.push('inventory:equip', {
      destination,
      item: serializeItem(item),
    });

    return serializeItem(item);
  }

  async function toss(
    name: string,
    countValue = 1,
  ): Promise<{ count: number; name: string }> {
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

  function hotbarSlot(): number {
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
