import { normalizeMinecraftName } from '../utils';

import type {
  ActionsModule,
  CombatModule,
  EventStreamLike,
  ExecutorDecision,
  InventoryModule,
  JsonValue,
  MemoryModule,
  PathingModule,
  SafetyModule,
  Vec3Like,
  WorldModule,
} from '../../types';

interface ExecutorToolDefinition {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
}

type ExecutorToolOutcome = 'action' | 'goal_blocked' | 'goal_complete' | 'observe' | 'wait';

export interface ExecutorToolInvocation {
  nextDelayMs?: number;
  outcome: ExecutorToolOutcome;
  result: JsonValue;
}

export interface ExecutorToolRegistry {
  definitions(): ExecutorToolDefinition[];
  invoke(decision: ExecutorDecision): Promise<ExecutorToolInvocation>;
}

interface ExecutorToolContext {
  actions: ActionsModule;
  combat: CombatModule;
  events: EventStreamLike;
  inventory: InventoryModule;
  memory: MemoryModule;
  pathing: PathingModule;
  safety: SafetyModule;
  world: WorldModule;
}

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<ExecutorToolInvocation> | ExecutorToolInvocation;

function expectObject(value: JsonValue): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Executor tool arguments must be a JSON object');
  }

  return value as Record<string, unknown>;
}

function readString(
  args: Record<string, unknown>,
  key: string,
  required = true,
): string | undefined {
  const value = args[key];

  if (value == null) {
    if (required) {
      throw new Error(`Missing required string argument: ${key}`);
    }

    return undefined;
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Expected ${key} to be a non-empty string`);
  }

  return value.trim();
}

function readNumber(
  args: Record<string, unknown>,
  key: string,
  fallback?: number,
): number {
  const value = args[key];

  if (value == null) {
    if (fallback == null) {
      throw new Error(`Missing required numeric argument: ${key}`);
    }

    return fallback;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected ${key} to be a finite number`);
  }

  return value;
}

function readPosition(
  args: Record<string, unknown>,
  key = 'position',
  required = true,
): Vec3Like | undefined {
  const value = args[key];

  if (value == null) {
    if (required) {
      throw new Error(`Missing required position argument: ${key}`);
    }

    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${key} to be an object with x, y, z`);
  }

  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y) ||
    typeof candidate.z !== 'number' ||
    !Number.isFinite(candidate.z)
  ) {
    throw new Error(`Expected ${key} to contain finite x, y, z values`);
  }

  return {
    x: candidate.x,
    y: candidate.y,
    z: candidate.z,
  };
}

function schemaForPosition(description: string): Record<string, unknown> {
  return {
    type: 'object',
    description,
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      z: { type: 'number' },
    },
    required: ['x', 'y', 'z'],
    additionalProperties: false,
  };
}

function createDefinitions(): ExecutorToolDefinition[] {
  return [
    {
      name: 'inspect_visible_area',
      description: 'Inspect the nearby visible area to understand blocks, entities, hazards, and focus targets.',
      parameters: {
        type: 'object',
        properties: {
          max_distance: { type: 'number', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'find_block_by_name',
      description: 'Find the nearest visible or nearby block by Minecraft block name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          max_distance: { type: 'number', minimum: 1 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'inventory_summary',
      description: 'Inspect current inventory contents and held item.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'count_item',
      description: 'Count how many of a given item are currently in inventory.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'goto_position',
      description: 'Move to a specific world position.',
      parameters: {
        type: 'object',
        properties: {
          position: schemaForPosition('Target world position'),
          range: { type: 'number', minimum: 0 },
        },
        required: ['position'],
        additionalProperties: false,
      },
    },
    {
      name: 'goto_named_block',
      description: 'Find a nearby block by name and move into range of it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          max_distance: { type: 'number', minimum: 1 },
          range: { type: 'number', minimum: 0 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'mine_block_at',
      description: 'Mine the block at a specific position.',
      parameters: {
        type: 'object',
        properties: {
          position: schemaForPosition('Target block position'),
        },
        required: ['position'],
        additionalProperties: false,
      },
    },
    {
      name: 'craft_item',
      description: 'Craft an item, optionally using a known crafting table position.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number', minimum: 1 },
          crafting_table_position: schemaForPosition('Optional crafting table position'),
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'place_block_at',
      description: 'Place an inventory block item at a target position.',
      parameters: {
        type: 'object',
        properties: {
          item_name: { type: 'string' },
          position: schemaForPosition('Placement position'),
        },
        required: ['item_name', 'position'],
        additionalProperties: false,
      },
    },
    {
      name: 'open_container_at',
      description: 'Open a container block and inspect its contents.',
      parameters: {
        type: 'object',
        properties: {
          position: schemaForPosition('Container block position'),
        },
        required: ['position'],
        additionalProperties: false,
      },
    },
    {
      name: 'equip_item',
      description: 'Equip an item from inventory to a destination such as hand, head, torso, legs, feet, or off-hand.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          destination: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'consume_food',
      description: 'Consume an edible food item from inventory or hand.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'attack_nearest_hostile',
      description: 'Attack the nearest hostile mob within range.',
      parameters: {
        type: 'object',
        properties: {
          max_distance: { type: 'number', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'retreat_from_nearest_hostile',
      description: 'Retreat away from the nearest hostile mob until a minimum distance is reached.',
      parameters: {
        type: 'object',
        properties: {
          min_distance: { type: 'number', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'wait',
      description: 'Do nothing for a short period and try again later.',
      parameters: {
        type: 'object',
        properties: {
          duration_ms: { type: 'number', minimum: 250 },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'mark_goal_complete',
      description: 'Mark the current goal as satisfied and clear it so a new goal can be planned.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'mark_goal_blocked',
      description: 'Mark the current goal as blocked for now, include a short reason, and clear it so a new goal can be planned.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  ];
}

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export function createExecutorToolRegistry(
  context: ExecutorToolContext,
): ExecutorToolRegistry {
  const { actions, combat, events, inventory, memory, pathing, safety, world } = context;
  const definitions = createDefinitions();

  const handlers = new Map<string, ToolHandler>([
    [
      'inspect_visible_area',
      (args) => ({
        outcome: 'observe',
        result: toJsonValue(world.inspectVisibleArea({
          maxDistance: args.max_distance == null ? undefined : readNumber(args, 'max_distance'),
        })),
      }),
    ],
    [
      'find_block_by_name',
      (args) => ({
        outcome: 'observe',
        result: (world.findBlockByName(readString(args, 'name')!, {
          maxDistance: args.max_distance == null ? undefined : readNumber(args, 'max_distance'),
        }) ?? null) as JsonValue,
      }),
    ],
    [
      'inventory_summary',
      () => ({
        outcome: 'observe',
        result: toJsonValue(inventory.summary()),
      }),
    ],
    [
      'count_item',
      (args) => {
        const name = readString(args, 'name')!;
        return {
          outcome: 'observe',
          result: {
            count: inventory.count(name),
            name: normalizeMinecraftName(name),
          },
        };
      },
    ],
    [
      'goto_position',
      async (args) => ({
        outcome: 'action',
        result: (await pathing.goto(
          readPosition(args)!,
          args.range == null ? 0 : readNumber(args, 'range'),
        )) as JsonValue,
      }),
    ],
    [
      'goto_named_block',
      async (args) => {
        const name = readString(args, 'name')!;
        const block = world.findBlockByName(name, {
          maxDistance: args.max_distance == null ? undefined : readNumber(args, 'max_distance'),
        });

        if (!block?.position) {
          throw new Error(`No nearby block found for ${name}`);
        }

        const liveBlock = world.getBlockAt(block.position);

        if (!liveBlock?.position) {
          throw new Error(`Could not resolve live block state for ${name}`);
        }

        return {
          outcome: 'action',
          result: toJsonValue({
            block,
            movement: await pathing.gotoBlock(
              liveBlock,
              args.range == null ? 1 : readNumber(args, 'range'),
            ),
          }),
        };
      },
    ],
    [
      'mine_block_at',
      async (args) => ({
        outcome: 'action',
        result: (await actions.mineBlockAt(readPosition(args)!)) as JsonValue,
      }),
    ],
    [
      'craft_item',
      async (args) => ({
        outcome: 'action',
        result: (await actions.craftItem(
          readString(args, 'name')!,
          args.count == null ? 1 : readNumber(args, 'count'),
          readPosition(args, 'crafting_table_position', false),
        )) as JsonValue,
      }),
    ],
    [
      'place_block_at',
      async (args) => ({
        outcome: 'action',
        result: (await actions.placeBlockAt(
          readString(args, 'item_name')!,
          readPosition(args)!,
        )) as JsonValue,
      }),
    ],
    [
      'open_container_at',
      async (args) => {
        const result = await actions.openContainerAt(readPosition(args)!);
        result.container.close();

        return {
          outcome: 'action',
          result: {
            block: result.block,
            items: result.items,
            window: result.window,
          } as JsonValue,
        };
      },
    ],
    [
      'equip_item',
      async (args) => ({
        outcome: 'action',
        result: (await inventory.equip(
          readString(args, 'name')!,
          readString(args, 'destination', false),
        )) as JsonValue,
      }),
    ],
    [
      'consume_food',
      async (args) => ({
        outcome: 'action',
        result: (await inventory.consumeFood(readString(args, 'name', false))) as JsonValue,
      }),
    ],
    [
      'attack_nearest_hostile',
      async (args) => ({
        outcome: 'action',
        result: (await combat.attackNearestHostile(
          args.max_distance == null ? 16 : readNumber(args, 'max_distance'),
        )) as JsonValue,
      }),
    ],
    [
      'retreat_from_nearest_hostile',
      async (args) => ({
        outcome: 'action',
        result: (await safety.retreatFromNearestHostile(
          args.min_distance == null ? 12 : readNumber(args, 'min_distance'),
        )) as JsonValue,
      }),
    ],
    [
      'wait',
      (args) => {
        const durationMs = args.duration_ms == null ? 2_500 : readNumber(args, 'duration_ms');
        const reason = readString(args, 'reason', false) ?? 'executor_wait';

        events.push('executor:wait', {
          durationMs,
          reason,
        });

        return {
          nextDelayMs: Math.max(250, durationMs),
          outcome: 'wait',
          result: {
            durationMs,
            reason,
          },
        };
      },
    ],
    [
      'mark_goal_complete',
      (args) => {
        const previousGoal = memory.currentGoal();
        const reason = readString(args, 'reason', false) ?? 'goal_complete';

        memory.setGoal(null);
        events.push('executor:goal_complete', {
          goal: previousGoal,
          reason,
        });

        return {
          outcome: 'goal_complete',
          result: {
            clearedGoal: previousGoal,
            reason,
          },
        };
      },
    ],
    [
      'mark_goal_blocked',
      (args) => {
        const previousGoal = memory.currentGoal();
        const reason = readString(args, 'reason', false) ?? 'goal_blocked';

        memory.setGoal(null);
        events.push('executor:goal_blocked', {
          goal: previousGoal,
          reason,
        });

        return {
          outcome: 'goal_blocked',
          result: {
            clearedGoal: previousGoal,
            reason,
          },
        };
      },
    ],
  ]);

  return {
    definitions() {
      return definitions;
    },
    async invoke(decision: ExecutorDecision): Promise<ExecutorToolInvocation> {
      const handler = handlers.get(decision.tool);

      if (!handler) {
        throw new Error(`Executor tool not registered: ${decision.tool}`);
      }

      return handler(expectObject(decision.args));
    },
  };
}

export const executorToolInternals = {
  createDefinitions,
  expectObject,
  readNumber,
  readPosition,
  readString,
};
