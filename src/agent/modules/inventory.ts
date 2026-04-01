import { instrumentAsyncOperation } from '../operationEvents';
import {
  normalizeMinecraftName,
  resolveItem,
  serializeItem,
} from '../utils';

import type {
  EventStreamLike,
  JsonValue,
  InventoryModule,
  ItemLike,
  MinecraftBot,
  SerializedItem,
} from '../../types';

interface FoodDefinition {
  effectiveQuality?: number;
  foodPoints?: number;
  id: number;
  name: string;
}

function getFoodsByName(bot: MinecraftBot): Record<string, FoodDefinition> {
  const registry = bot.registry as unknown as {
    foodsByName?: Record<string, FoodDefinition>;
  };

  return registry.foodsByName ?? {};
}

function resolveFoodDefinition(bot: MinecraftBot, name: string): FoodDefinition {
  const food = getFoodsByName(bot)[normalizeMinecraftName(name)];

  if (!food) {
    throw new Error(`Item is not edible: "${name}"`);
  }

  return food;
}

function isEdibleItem(bot: MinecraftBot, item: ItemLike | null | undefined): item is ItemLike {
  if (!item?.name) {
    return false;
  }

  return Boolean(getFoodsByName(bot)[item.name]);
}

function foodScore(food: FoodDefinition | null | undefined): number {
  if (!food) {
    return -1;
  }

  return food.effectiveQuality ?? food.foodPoints ?? 0;
}

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

  function selectFoodItem(name?: string): ItemLike {
    if (name) {
      const food = resolveFoodDefinition(bot, name);
      const item = findItemByName(food.name);

      if (!item) {
        throw new Error(`Food item not in inventory: "${food.name}"`);
      }

      return item;
    }

    if (isEdibleItem(bot, bot.heldItem as ItemLike | null | undefined)) {
      return bot.heldItem as ItemLike;
    }

    const edibleItems = bot.inventory
      .items()
      .filter((item) => isEdibleItem(bot, item as ItemLike | null | undefined))
      .map((item) => item as unknown as ItemLike)
      .sort((left, right) => {
        const qualityDelta =
          foodScore(getFoodsByName(bot)[right.name]) - foodScore(getFoodsByName(bot)[left.name]);

        if (qualityDelta !== 0) {
          return qualityDelta;
        }

        return right.count - left.count;
      });

    const candidate = edibleItems[0];

    if (!candidate) {
      throw new Error('No edible food items available in inventory');
    }

    return candidate;
  }

  async function consumeFoodOperation(name?: string): Promise<SerializedItem | null> {
    const item = selectFoodItem(name);

    await bot.equip(item as never, 'hand');
    await bot.consume();

    const serializedItem = serializeItem(item);
    events.push('inventory:consume', {
      item: serializedItem,
    } as JsonValue);

    return serializedItem;
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

  const consumeFood = instrumentAsyncOperation(events, {
    action: 'inventory.consumeFood',
    failure: ([name], error) => ({
      priority: 8,
      tags: ['inventory', 'consume', 'food'],
      text: `Failed to consume ${name ?? 'food'}: ${error instanceof Error ? error.message : String(error)}`,
    }),
    start: ([name]) => ({
      priority: 4,
      tags: ['inventory', 'consume', 'food'],
      text: `Consuming ${name ?? 'food'}`,
    }),
    success: ([name], item) => ({
      priority: 6,
      tags: ['inventory', 'consume', 'food'],
      text: `Consumed ${item?.name ?? name ?? 'food'}`,
    }),
  }, consumeFoodOperation);

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
    consumeFood,
    equip,
    findItemByName,
    heldItem,
    hotbarSlot,
    items,
    summary,
    toss,
  };
}
