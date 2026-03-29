import { instrumentAsyncOperation } from '../operationEvents';
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

  async function equipOperation(
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

  async function tossOperation(
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

  const equip = instrumentAsyncOperation(events, {
    action: 'inventory.equip',
    failure: ([name, destination = 'hand'], error) => ({
      priority: 8,
      tags: ['inventory', 'equip'],
      text: `Failed to equip ${name} to ${destination}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([name, destination = 'hand']) => ({
      priority: 4,
      tags: ['inventory', 'equip'],
      text: `Equipping ${name} to ${destination}`,
    }),
    success: ([name, destination = 'hand'], item) => ({
      priority: 6,
      tags: ['inventory', 'equip'],
      text: `Equipped ${item?.name ?? name} to ${destination}`,
    }),
  }, equipOperation);

  const toss = instrumentAsyncOperation(events, {
    action: 'inventory.toss',
    failure: ([name, countValue = 1], error) => ({
      priority: 8,
      tags: ['inventory', 'toss'],
      text: `Failed to toss ${countValue} ${name}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([name, countValue = 1]) => ({
      priority: 4,
      tags: ['inventory', 'toss'],
      text: `Tossing ${countValue} ${name}`,
    }),
    success: (_args, result) => ({
      priority: 6,
      tags: ['inventory', 'toss'],
      text: `Tossed ${result.count} ${result.name}`,
    }),
  }, tossOperation);

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
