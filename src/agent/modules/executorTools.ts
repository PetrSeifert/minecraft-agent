import { normalizeMinecraftName } from "../utils";

import type {
  ActionsModule,
  ChatModule,
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
} from "../../types";

interface ExecutorToolDefinition {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
}

type ExecutorToolOutcome = "action" | "goal_blocked" | "goal_complete" | "observe" | "wait";

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
  chat: ChatModule;
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Executor tool arguments must be a JSON object");
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

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected ${key} to be a non-empty string`);
  }

  return value.trim();
}

function readNumber(args: Record<string, unknown>, key: string, fallback?: number): number {
  const value = args[key];

  if (value == null) {
    if (fallback == null) {
      throw new Error(`Missing required numeric argument: ${key}`);
    }

    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${key} to be a finite number`);
  }

  return value;
}

function readItemTransfers(
  args: Record<string, unknown>,
  key = "items",
): Array<{ count: number; name: string }> {
  const raw = args[key];

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${key} must be a non-empty array`);
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${key}[${index}] must be an object`);
    }

    const object = entry as Record<string, unknown>;
    const name = readString(object, "name");
    const count = object.count == null ? 1 : readNumber(object, "count");

    if (count < 1) {
      throw new Error(`${key}[${index}].count must be at least 1`);
    }

    return {
      count,
      name: name!,
    };
  });
}

function readEntityId(args: Record<string, unknown>): number {
  const value = args.entity_id;

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("entity_id must be an integer");
  }

  return value;
}

function readPosition(
  args: Record<string, unknown>,
  key = "position",
  required = true,
): Vec3Like | undefined {
  const value = args[key];

  if (value == null) {
    if (required) {
      throw new Error(`Missing required position argument: ${key}`);
    }

    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${key} to be an object with x, y, z`);
  }

  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.x !== "number" ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== "number" ||
    !Number.isFinite(candidate.y) ||
    typeof candidate.z !== "number" ||
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
    type: "object",
    description,
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      z: { type: "number" },
    },
    required: ["x", "y", "z"],
    additionalProperties: false,
  };
}

function createDefinitions(): ExecutorToolDefinition[] {
  return [
    {
      name: "inspect_visible_area",
      description:
        "Inspect the nearby visible area to understand blocks, entities, hazards, and focus targets.",
      parameters: {
        type: "object",
        properties: {
          max_distance: { type: "number", minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "find_block_by_name",
      description: "Find the nearest visible or nearby block by Minecraft block name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          max_distance: { type: "number", minimum: 1 },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "inventory_summary",
      description: "Inspect current inventory contents and held item.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "count_item",
      description: "Count how many of a given item are currently in inventory.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "goto_position",
      description: "Move to a specific world position.",
      parameters: {
        type: "object",
        properties: {
          position: schemaForPosition("Target world position"),
          range: { type: "number", minimum: 0 },
        },
        required: ["position"],
        additionalProperties: false,
      },
    },
    {
      name: "goto_named_block",
      description: "Find a nearby block by name and move into range of it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          max_distance: { type: "number", minimum: 1 },
          range: { type: "number", minimum: 0 },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "mine_block_at",
      description: "Mine the block at a specific position.",
      parameters: {
        type: "object",
        properties: {
          position: schemaForPosition("Target block position"),
        },
        required: ["position"],
        additionalProperties: false,
      },
    },
    {
      name: "craft_item",
      description: "Craft an item, optionally using a known crafting table position.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number", minimum: 1 },
          crafting_table_position: schemaForPosition("Optional crafting table position"),
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "place_block_at",
      description: "Place an inventory block item at a target position.",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string" },
          position: schemaForPosition("Placement position"),
        },
        required: ["item_name", "position"],
        additionalProperties: false,
      },
    },
    {
      name: "open_container_at",
      description: "Open a container block and inspect its contents.",
      parameters: {
        type: "object",
        properties: {
          position: schemaForPosition("Container block position"),
        },
        required: ["position"],
        additionalProperties: false,
      },
    },
    {
      name: "interact_block",
      description: "Right-click (use) a block at a position — doors, beds, buttons, levers, etc.",
      parameters: {
        type: "object",
        properties: {
          position: schemaForPosition("Block position"),
          reach: { type: "number", minimum: 1 },
        },
        required: ["position"],
        additionalProperties: false,
      },
    },
    {
      name: "deposit_items",
      description:
        "Open a container at a position and move item stacks from the bot inventory into the container.",
      parameters: {
        type: "object",
        properties: {
          position: schemaForPosition("Container block position"),
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                count: { type: "number", minimum: 1 },
              },
              required: ["name", "count"],
              additionalProperties: false,
            },
          },
        },
        required: ["position", "items"],
        additionalProperties: false,
      },
    },
    {
      name: "withdraw_items",
      description:
        "Open a container at a position and move item stacks from the container into the bot inventory.",
      parameters: {
        type: "object",
        properties: {
          position: schemaForPosition("Container block position"),
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                count: { type: "number", minimum: 1 },
              },
              required: ["name", "count"],
              additionalProperties: false,
            },
          },
        },
        required: ["position", "items"],
        additionalProperties: false,
      },
    },
    {
      name: "smelt_at",
      description:
        "Use a furnace, blast furnace, or smoker: add input and fuel, wait, then try to take smelted output.",
      parameters: {
        type: "object",
        properties: {
          position: schemaForPosition("Furnace block position"),
          input_name: { type: "string" },
          input_count: { type: "number", minimum: 1 },
          fuel_name: { type: "string" },
          fuel_count: { type: "number", minimum: 1 },
          wait_ms: { type: "number", minimum: 0 },
          take_output: { type: "boolean" },
        },
        required: ["position", "input_name", "fuel_name"],
        additionalProperties: false,
      },
    },
    {
      name: "equip_item",
      description:
        "Equip an item from inventory to a destination such as hand, head, torso, legs, feet, or off-hand.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          destination: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "consume_food",
      description: "Consume an edible food item from inventory or hand.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "use_held_item",
      description: "Start using the held item (e.g. bow, bucket) or release/stop using it.",
      parameters: {
        type: "object",
        properties: {
          off_hand: { type: "boolean" },
          release: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "drop_item",
      description: "Drop items from inventory onto the ground.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number", minimum: 1 },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "attack_nearest_hostile",
      description: "Attack the nearest hostile mob within range.",
      parameters: {
        type: "object",
        properties: {
          max_distance: { type: "number", minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "retreat_from_nearest_hostile",
      description: "Retreat away from the nearest hostile mob until a minimum distance is reached.",
      parameters: {
        type: "object",
        properties: {
          min_distance: { type: "number", minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "attack_entity",
      description:
        "Attack a specific entity by its numeric entity id (from perception or inspect_visible_area).",
      parameters: {
        type: "object",
        properties: {
          entity_id: { type: "integer" },
        },
        required: ["entity_id"],
        additionalProperties: false,
      },
    },
    {
      name: "follow_player",
      description:
        "Follow another player by Minecraft username until pathing is stopped or the target is lost.",
      parameters: {
        type: "object",
        properties: {
          username: { type: "string" },
          range: { type: "number", minimum: 0.5 },
        },
        required: ["username"],
        additionalProperties: false,
      },
    },
    {
      name: "send_chat",
      description: "Send a public chat message as the bot.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
    {
      name: "wait",
      description: "Do nothing for a short period and try again later.",
      parameters: {
        type: "object",
        properties: {
          duration_ms: { type: "number", minimum: 250 },
          reason: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "mark_goal_complete",
      description: "Mark the current goal as satisfied and clear it so a new goal can be planned.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "mark_goal_blocked",
      description:
        "Mark the current goal as blocked for now, include a short reason, and clear it so a new goal can be planned.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  ];
}

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export function createExecutorToolRegistry(context: ExecutorToolContext): ExecutorToolRegistry {
  const { actions, chat, combat, events, inventory, memory, pathing, safety, world } = context;
  const definitions = createDefinitions();

  const handlers = new Map<string, ToolHandler>([
    [
      "inspect_visible_area",
      (args) => ({
        outcome: "observe",
        result: toJsonValue(
          world.inspectVisibleArea({
            maxDistance: args.max_distance == null ? undefined : readNumber(args, "max_distance"),
          }),
        ),
      }),
    ],
    [
      "find_block_by_name",
      (args) => ({
        outcome: "observe",
        result: (world.findBlockByName(readString(args, "name")!, {
          maxDistance: args.max_distance == null ? undefined : readNumber(args, "max_distance"),
        }) ?? null) as JsonValue,
      }),
    ],
    [
      "inventory_summary",
      () => ({
        outcome: "observe",
        result: toJsonValue(inventory.summary()),
      }),
    ],
    [
      "count_item",
      (args) => {
        const name = readString(args, "name")!;
        return {
          outcome: "observe",
          result: {
            count: inventory.count(name),
            name: normalizeMinecraftName(name),
          },
        };
      },
    ],
    [
      "goto_position",
      async (args) => ({
        outcome: "action",
        result: (await pathing.goto(
          readPosition(args)!,
          args.range == null ? 0 : readNumber(args, "range"),
        )) as JsonValue,
      }),
    ],
    [
      "goto_named_block",
      async (args) => {
        const name = readString(args, "name")!;
        const block = world.findBlockByName(name, {
          maxDistance: args.max_distance == null ? undefined : readNumber(args, "max_distance"),
        });

        if (!block?.position) {
          throw new Error(`No nearby block found for ${name}`);
        }

        const liveBlock = world.getBlockAt(block.position);

        if (!liveBlock?.position) {
          throw new Error(`Could not resolve live block state for ${name}`);
        }

        return {
          outcome: "action",
          result: toJsonValue({
            block,
            movement: await pathing.gotoBlock(
              liveBlock,
              args.range == null ? 1 : readNumber(args, "range"),
            ),
          }),
        };
      },
    ],
    [
      "mine_block_at",
      async (args) => ({
        outcome: "action",
        result: (await actions.mineBlockAt(readPosition(args)!)) as JsonValue,
      }),
    ],
    [
      "craft_item",
      async (args) => ({
        outcome: "action",
        result: (await actions.craftItem(
          readString(args, "name")!,
          args.count == null ? 1 : readNumber(args, "count"),
          readPosition(args, "crafting_table_position", false),
        )) as JsonValue,
      }),
    ],
    [
      "place_block_at",
      async (args) => ({
        outcome: "action",
        result: (await actions.placeBlockAt(
          readString(args, "item_name")!,
          readPosition(args)!,
        )) as JsonValue,
      }),
    ],
    [
      "open_container_at",
      async (args) => {
        const result = await actions.openContainerAt(readPosition(args)!);
        result.container.close();

        return {
          outcome: "action",
          result: {
            block: result.block,
            items: result.items,
            window: result.window,
          } as JsonValue,
        };
      },
    ],
    [
      "interact_block",
      async (args) => ({
        outcome: "action",
        result: (await actions.interactBlockAt(readPosition(args)!, {
          reach: args.reach == null ? undefined : readNumber(args, "reach"),
        })) as JsonValue,
      }),
    ],
    [
      "deposit_items",
      async (args) => ({
        outcome: "action",
        result: (await actions.depositItemsAt(
          readPosition(args)!,
          readItemTransfers(args, "items"),
        )) as JsonValue,
      }),
    ],
    [
      "withdraw_items",
      async (args) => ({
        outcome: "action",
        result: (await actions.withdrawItemsAt(
          readPosition(args)!,
          readItemTransfers(args, "items"),
        )) as JsonValue,
      }),
    ],
    [
      "smelt_at",
      async (args) => ({
        outcome: "action",
        result: (await actions.smeltAt(
          readPosition(args)!,
          {
            count: args.input_count == null ? 1 : readNumber(args, "input_count"),
            name: readString(args, "input_name")!,
          },
          {
            count: args.fuel_count == null ? 1 : readNumber(args, "fuel_count"),
            name: readString(args, "fuel_name")!,
          },
          {
            takeOutput: args.take_output == null ? undefined : Boolean(args.take_output),
            waitMs: args.wait_ms == null ? undefined : readNumber(args, "wait_ms"),
          },
        )) as JsonValue,
      }),
    ],
    [
      "equip_item",
      async (args) => ({
        outcome: "action",
        result: (await inventory.equip(
          readString(args, "name")!,
          readString(args, "destination", false),
        )) as JsonValue,
      }),
    ],
    [
      "consume_food",
      async (args) => ({
        outcome: "action",
        result: (await inventory.consumeFood(readString(args, "name", false))) as JsonValue,
      }),
    ],
    [
      "use_held_item",
      async (args) => ({
        outcome: "action",
        result: (await inventory.useHeldItem({
          offHand: args.off_hand === true,
          release: args.release === true,
        })) as JsonValue,
      }),
    ],
    [
      "drop_item",
      async (args) => ({
        outcome: "action",
        result: (await inventory.toss(
          readString(args, "name")!,
          args.count == null ? 1 : readNumber(args, "count"),
        )) as JsonValue,
      }),
    ],
    [
      "attack_nearest_hostile",
      async (args) => ({
        outcome: "action",
        result: (await combat.attackNearestHostile(
          args.max_distance == null ? 16 : readNumber(args, "max_distance"),
        )) as JsonValue,
      }),
    ],
    [
      "retreat_from_nearest_hostile",
      async (args) => ({
        outcome: "action",
        result: (await safety.retreatFromNearestHostile(
          args.min_distance == null ? 12 : readNumber(args, "min_distance"),
        )) as JsonValue,
      }),
    ],
    [
      "attack_entity",
      async (args) => {
        const entityId = readEntityId(args);
        const entity = world.entityById(entityId);

        if (!entity?.position) {
          throw new Error(`No entity found for id ${entityId}`);
        }

        return {
          outcome: "action",
          result: (await combat.attackEntity(entity)) as JsonValue,
        };
      },
    ],
    [
      "follow_player",
      (args) => {
        const username = readString(args, "username")!;
        const entity = world.entityByUsername(username);

        if (!entity?.position) {
          throw new Error(`No online player entity for username "${username}"`);
        }

        return {
          outcome: "action",
          result: toJsonValue(
            pathing.followEntity(entity, args.range == null ? 2 : readNumber(args, "range")),
          ),
        };
      },
    ],
    [
      "send_chat",
      (args) => ({
        outcome: "action",
        result: toJsonValue(chat.say(readString(args, "message")!)),
      }),
    ],
    [
      "wait",
      (args) => {
        const durationMs = args.duration_ms == null ? 2_500 : readNumber(args, "duration_ms");
        const reason = readString(args, "reason", false) ?? "executor_wait";

        events.push("executor:wait", {
          durationMs,
          reason,
        });

        return {
          nextDelayMs: Math.max(250, durationMs),
          outcome: "wait",
          result: {
            durationMs,
            reason,
          },
        };
      },
    ],
    [
      "mark_goal_complete",
      (args) => {
        const previousGoal = memory.currentGoal();
        const reason = readString(args, "reason", false) ?? "goal_complete";

        memory.setGoal(null);
        events.push("executor:goal_complete", {
          goal: previousGoal,
          reason,
        });

        return {
          outcome: "goal_complete",
          result: {
            clearedGoal: previousGoal,
            reason,
          },
        };
      },
    ],
    [
      "mark_goal_blocked",
      (args) => {
        const previousGoal = memory.currentGoal();
        const reason = readString(args, "reason", false) ?? "goal_blocked";

        memory.setGoal(null);
        events.push("executor:goal_blocked", {
          goal: previousGoal,
          reason,
        });

        return {
          outcome: "goal_blocked",
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
