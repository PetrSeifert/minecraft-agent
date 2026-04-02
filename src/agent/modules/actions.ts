import { Vec3 } from "vec3";

import { instrumentAsyncOperation } from "../operationEvents";
import {
  CARDINAL_FACES,
  requireSpawned,
  resolveItem,
  serializeBlock,
  serializeItem,
  serializeWindow,
  toVec3,
} from "../utils";

import type {
  ActionsModule,
  BlockLike,
  EventStreamLike,
  InventoryModule,
  ItemLike,
  MinecraftBot,
  PathingModule,
  SerializedBlock,
  SerializedItem,
  Vec3Like,
  WindowLike,
  WorldModule,
} from "../../types";

const FURNACE_BLOCK_NAMES = new Set(["blast_furnace", "furnace", "smoker"]);

type TransferWindow = WindowLike & {
  close(): void;
  deposit(itemType: number, metadata: null, count: number, nbt?: unknown): Promise<void>;
  withdraw(itemType: number, metadata: null, count: number, nbt?: unknown): Promise<void>;
};

type FurnaceWindow = {
  close(): void;
  outputItem(): ItemLike | null;
  putFuel(itemType: number, metadata: null, count: number): Promise<void>;
  putInput(itemType: number, metadata: null, count: number): Promise<void>;
  takeOutput(): Promise<ItemLike | null>;
};

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

export function createActionsModule(bot: MinecraftBot, context: ActionsContext): ActionsModule {
  const { events, inventory, pathing, world } = context;

  async function mineBlockAtOperation(
    position: Vec3Like,
    options: { forceLook?: boolean; reach?: number } = {},
  ) {
    requireSpawned(bot);

    const initialBlock = world.getBlockAt(position);

    if (!initialBlock?.position) {
      throw new Error("No block found at the requested position");
    }

    await pathing.gotoLookAt(initialBlock.position, options.reach ?? 4.5);

    // Re-resolve the block after moving so dig uses the live block state and a visible face.
    const block = world.getBlockAt(initialBlock.position);

    if (!block?.position) {
      throw new Error("Target block disappeared before digging started");
    }

    if (!bot.canDigBlock(block as never)) {
      throw new Error(`Block is not diggable from current position: ${block.name}`);
    }

    const bestTool = bot.pathfinder?.bestHarvestTool(block as never) ?? null;

    if (bestTool) {
      await bot.equip(bestTool as never, "hand");
    }

    await bot.dig(block as never, options.forceLook ?? true, "raycast" as never);

    events.push("action:mine", {
      block: serializeBlock(block),
      tool: serializeItem(bestTool as never),
    });

    return serializeBlock(block);
  }

  function findCraftingTable(position: Vec3Like | null = null): BlockLike | null {
    if (position) {
      const craftingTable = world.getBlockAt(position);

      if (!craftingTable || craftingTable.name !== "crafting_table") {
        throw new Error("No crafting table at the provided position");
      }

      return craftingTable;
    }

    const tableDetails = world.findBlockByName("crafting_table", { maxDistance: 16 });
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

    events.push("action:craft", {
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

      if (referenceBlock.boundingBox !== "block") {
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

    if (targetBlock && targetBlock.boundingBox !== "empty" && targetBlock.name !== "water") {
      throw new Error(`Target position is occupied by ${targetBlock.name}`);
    }

    const item = await inventory.equip(itemName, "hand");
    const placement = resolvePlacementReference(targetPosition);

    if (!placement) {
      throw new Error("Could not find a solid reference block next to the target position");
    }

    await pathing.gotoPlace(targetPosition);
    await bot.placeBlock(placement.referenceBlock as never, placement.face);

    const placedBlock = (bot.blockAt(targetPosition) as BlockLike | null) ?? targetBlock;

    events.push("action:place", {
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
      throw new Error("No block found at the requested position");
    }

    await pathing.gotoLookAt(block.position, 4.5);

    const container = (await bot.openContainer(
      block as never,
      new Vec3(0, 1, 0),
      new Vec3(0.5, 0.5, 0.5),
    )) as WindowLike & { close(): void };

    events.push("action:open_container", {
      block: serializeBlock(block),
      window: serializeWindow(container),
    });

    return {
      block: serializeBlock(block),
      container,
      items:
        typeof container.containerItems === "function"
          ? container.containerItems().map((item) => serializeItem(item))
          : [],
      window: serializeWindow(container),
    };
  }

  async function interactBlockAtOperation(
    position: Vec3Like,
    options: { reach?: number } = {},
  ): Promise<SerializedBlock | null> {
    requireSpawned(bot);

    const block = world.getBlockAt(position);

    if (!block?.position) {
      throw new Error("No block found at the requested position");
    }

    await pathing.gotoLookAt(block.position, options.reach ?? 4.5);

    if (typeof bot.activateBlock !== "function") {
      throw new Error("activateBlock is not available on this bot");
    }

    await bot.activateBlock(block as never, new Vec3(0, 1, 0), new Vec3(0.5, 0.5, 0.5));

    events.push("action:interact_block", {
      block: serializeBlock(block),
    });

    return serializeBlock(block);
  }

  async function depositItemsAtOperation(
    position: Vec3Like,
    itemsToDeposit: Array<{ count: number; name: string }>,
  ): Promise<{
    block: SerializedBlock | null;
    deposited: Array<{ count: number; name: string }>;
  }> {
    const { block, container } = await openContainerAtOperation(position);
    const window = container as TransferWindow;

    if (typeof window.deposit !== "function") {
      window.close();
      throw new Error("This container does not support deposit");
    }

    const deposited: Array<{ count: number; name: string }> = [];

    try {
      for (const entry of itemsToDeposit) {
        const definition = resolveItem(bot, entry.name);
        await window.deposit(definition.id, null, entry.count);
        deposited.push({
          count: entry.count,
          name: definition.name,
        });
      }

      return {
        block,
        deposited,
      };
    } finally {
      window.close();
    }
  }

  async function withdrawItemsAtOperation(
    position: Vec3Like,
    itemsToWithdraw: Array<{ count: number; name: string }>,
  ): Promise<{
    block: SerializedBlock | null;
    withdrawn: Array<{ count: number; name: string }>;
  }> {
    const { block, container } = await openContainerAtOperation(position);
    const window = container as TransferWindow;

    if (typeof window.withdraw !== "function") {
      window.close();
      throw new Error("This container does not support withdraw");
    }

    const withdrawn: Array<{ count: number; name: string }> = [];

    try {
      for (const entry of itemsToWithdraw) {
        const definition = resolveItem(bot, entry.name);
        await window.withdraw(definition.id, null, entry.count);
        withdrawn.push({
          count: entry.count,
          name: definition.name,
        });
      }

      return {
        block,
        withdrawn,
      };
    } finally {
      window.close();
    }
  }

  async function smeltAtOperation(
    position: Vec3Like,
    input: { count: number; name: string },
    fuel: { count: number; name: string },
    options: { takeOutput?: boolean; waitMs?: number } = {},
  ): Promise<{ block: SerializedBlock | null; outputTaken: Array<SerializedItem | null> }> {
    requireSpawned(bot);

    const block = world.getBlockAt(position);

    if (!block?.position) {
      throw new Error("No block found at the requested position");
    }

    if (!block.name || !FURNACE_BLOCK_NAMES.has(block.name)) {
      throw new Error(`Block is not a furnace or smoker (found ${block.name ?? "unknown"})`);
    }

    await pathing.gotoLookAt(block.position, 4.5);

    if (typeof bot.openFurnace !== "function") {
      throw new Error("openFurnace is not available on this bot");
    }

    const furnace = (await bot.openFurnace(block as never)) as FurnaceWindow;
    const outputTaken: Array<SerializedItem | null> = [];

    try {
      const inputDef = resolveItem(bot, input.name);
      const fuelDef = resolveItem(bot, fuel.name);
      await furnace.putInput(inputDef.id, null, input.count);
      await furnace.putFuel(fuelDef.id, null, fuel.count);

      const waitMs = options.waitMs ?? 4000;

      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      if (options.takeOutput !== false) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const output = furnace.outputItem();

          if (!output) {
            if (attempt > 0) {
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, 800));
            continue;
          }

          await furnace.takeOutput();
          outputTaken.push(serializeItem(output as ItemLike));

          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }

      return {
        block: serializeBlock(block),
        outputTaken,
      };
    } finally {
      furnace.close();
    }
  }

  const mineBlockAt = instrumentAsyncOperation(
    events,
    {
      action: "actions.mineBlockAt",
      failure: ([position], error) => ({
        priority: 8,
        tags: ["actions", "mine"],
        text: `Failed to mine block at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([position]) => ({
        priority: 4,
        tags: ["actions", "mine"],
        text: `Mining block at ${formatPosition(position)}`,
      }),
      success: (_args, block) => ({
        priority: 6,
        tags: ["actions", "mine"],
        text: `Mined ${block?.name ?? "block"}`,
      }),
    },
    mineBlockAtOperation,
  );

  const craftItem = instrumentAsyncOperation(
    events,
    {
      action: "actions.craftItem",
      failure: ([name, count = 1], error) => ({
        priority: 8,
        tags: ["actions", "craft"],
        text: `Failed to craft ${count} ${name}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([name, count = 1]) => ({
        priority: 4,
        tags: ["actions", "craft"],
        text: `Crafting ${count} ${name}`,
      }),
      success: (_args, result) => ({
        priority: 6,
        tags: ["actions", "craft"],
        text: `Crafted ${result.count} ${result.item}`,
      }),
    },
    craftItemOperation,
  );

  const placeBlockAt = instrumentAsyncOperation(
    events,
    {
      action: "actions.placeBlockAt",
      failure: ([itemName, position], error) => ({
        priority: 8,
        tags: ["actions", "place"],
        text: `Failed to place ${itemName} at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([itemName, position]) => ({
        priority: 4,
        tags: ["actions", "place"],
        text: `Placing ${itemName} at ${formatPosition(position)}`,
      }),
      success: (_args, block) => ({
        priority: 6,
        tags: ["actions", "place"],
        text: `Placed ${block?.name ?? "block"}`,
      }),
    },
    placeBlockAtOperation,
  );

  const openContainerAt = instrumentAsyncOperation(
    events,
    {
      action: "actions.openContainerAt",
      failure: ([position], error) => ({
        priority: 8,
        tags: ["actions", "container"],
        text: `Failed to open container at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([position]) => ({
        priority: 4,
        tags: ["actions", "container"],
        text: `Opening container at ${formatPosition(position)}`,
      }),
      success: (_args, result) => ({
        priority: 6,
        tags: ["actions", "container"],
        text: `Opened ${result.block?.name ?? "container"}`,
      }),
    },
    openContainerAtOperation,
  );

  const interactBlockAt = instrumentAsyncOperation(
    events,
    {
      action: "actions.interactBlockAt",
      failure: ([position], error) => ({
        priority: 8,
        tags: ["actions", "interact"],
        text: `Failed to interact with block at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([position]) => ({
        priority: 4,
        tags: ["actions", "interact"],
        text: `Interacting with block at ${formatPosition(position)}`,
      }),
      success: (_args, block) => ({
        priority: 6,
        tags: ["actions", "interact"],
        text: `Interacted with ${block?.name ?? "block"}`,
      }),
    },
    interactBlockAtOperation,
  );

  const depositItemsAt = instrumentAsyncOperation(
    events,
    {
      action: "actions.depositItemsAt",
      failure: ([position], error) => ({
        priority: 8,
        tags: ["actions", "deposit"],
        text: `Failed to deposit into container at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([position, items]) => ({
        priority: 4,
        tags: ["actions", "deposit"],
        text: `Depositing ${items.length} stack(s) at ${formatPosition(position)}`,
      }),
      success: (_args, result) => ({
        priority: 6,
        tags: ["actions", "deposit"],
        text: `Deposited ${result.deposited.length} stack(s) into ${result.block?.name ?? "container"}`,
      }),
    },
    depositItemsAtOperation,
  );

  const withdrawItemsAt = instrumentAsyncOperation(
    events,
    {
      action: "actions.withdrawItemsAt",
      failure: ([position], error) => ({
        priority: 8,
        tags: ["actions", "withdraw"],
        text: `Failed to withdraw from container at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([position, items]) => ({
        priority: 4,
        tags: ["actions", "withdraw"],
        text: `Withdrawing ${items.length} stack(s) from ${formatPosition(position)}`,
      }),
      success: (_args, result) => ({
        priority: 6,
        tags: ["actions", "withdraw"],
        text: `Withdrew ${result.withdrawn.length} stack(s) from ${result.block?.name ?? "container"}`,
      }),
    },
    withdrawItemsAtOperation,
  );

  const smeltAt = instrumentAsyncOperation(
    events,
    {
      action: "actions.smeltAt",
      failure: ([position], error) => ({
        priority: 8,
        tags: ["actions", "smelt"],
        text: `Failed to smelt at ${formatPosition(position)}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([position, input, fuel]) => ({
        priority: 4,
        tags: ["actions", "smelt"],
        text: `Smelting ${input.count} ${input.name} with ${fuel.count} ${fuel.name} at ${formatPosition(position)}`,
      }),
      success: (_args, result) => ({
        priority: 6,
        tags: ["actions", "smelt"],
        text: `Smelt step finished; collected ${result.outputTaken.length} output stack(s)`,
      }),
    },
    smeltAtOperation,
  );

  return {
    craftItem,
    depositItemsAt,
    interactBlockAt,
    mineBlockAt,
    openContainerAt,
    placeBlockAt,
    smeltAt,
    withdrawItemsAt,
  };
}
