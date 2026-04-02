import { summarizePayload, requireSpawned, serializeVec3 } from "../utils";

import type {
  ChatHistoryEntry,
  ChatModule,
  ExecutorStatus,
  EventStreamLike,
  MemoryModule,
  MinecraftBot,
  OrchestrationModule,
  OrchestrationSnapshot,
  PlannerStatus,
  SafetyModule,
  SafetyStatus,
  VisibleBlockSummary,
  WorldModule,
} from "../../types";

const MAX_NEARBY_BLOCKS = 20;
const MAX_PERCEPTION_ITEMS = 10;
const EQUIPMENT_DESTINATIONS = ["hand", "head", "torso", "legs", "feet", "off-hand"] as const;
const CONTAINER_BLOCK_NAMES = new Set([
  "barrel",
  "blast_furnace",
  "chest",
  "dispenser",
  "dropper",
  "furnace",
  "hopper",
  "smoker",
  "trapped_chest",
]);

interface OrchestrationContext {
  chat: ChatModule;
  events: EventStreamLike;
  getExecutorStatus?: () => ExecutorStatus | null;
  getPlannerStatus?: () => PlannerStatus | null;
  inventory: {
    items(): Array<{ count?: number | null; name?: string | null } | null>;
  };
  memory: MemoryModule;
  safety: SafetyModule;
  world: WorldModule;
}

function formatDistance(distance: number): number {
  return Number(distance.toFixed(1));
}

function aggregateInventoryCounts(
  items: Array<{ count?: number | null; name?: string | null } | null>,
): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const count = item?.count;

    if (!item?.name || typeof count !== "number" || !Number.isFinite(count)) {
      return counts;
    }

    counts[item.name] = (counts[item.name] ?? 0) + count;
    return counts;
  }, {});
}

function collectEquippedItemNames(bot: MinecraftBot): string[] {
  const equipped: string[] = [];
  const seen = new Set<string>();

  function pushItem(item: { name?: string | null } | null | undefined): void {
    if (!item?.name || seen.has(item.name)) {
      return;
    }

    seen.add(item.name);
    equipped.push(item.name);
  }

  pushItem(bot.heldItem);

  if (typeof bot.getEquipmentDestSlot !== "function") {
    return equipped;
  }

  for (const destination of EQUIPMENT_DESTINATIONS) {
    const slot = bot.getEquipmentDestSlot(destination);

    if (!Number.isInteger(slot) || slot < 0) {
      continue;
    }

    pushItem(bot.inventory?.slots?.[slot] as { name?: string | null } | null);
  }

  return equipped;
}

function classifyRiskLevel(
  safetyStatus: Partial<SafetyStatus>,
  health: number | null = null,
): "high" | "low" | "medium" {
  const currentHealth = Number.isFinite(health)
    ? Number(health)
    : Number(safetyStatus.health ?? Number.NaN);
  const hostileCount = safetyStatus.hostiles?.length ?? 0;

  if (
    safetyStatus.inLava ||
    safetyStatus.onFire ||
    safetyStatus.drowning ||
    safetyStatus.mobAggro ||
    (Number.isFinite(currentHealth) && currentHealth <= 8)
  ) {
    return "high";
  }

  if (hostileCount > 0 || (Number.isFinite(currentHealth) && currentHealth <= 14)) {
    return "medium";
  }

  return "low";
}

function formatEntitySummary(
  entity: {
    distance?: number | null;
    displayName?: string | null;
    name?: string | null;
    type?: string | null;
    username?: string | null;
  } | null,
): string | null {
  if (!entity) {
    return null;
  }

  const label = entity.username ?? entity.name ?? entity.displayName ?? entity.type ?? "unknown";

  const distanceValue = Number(entity.distance);
  return Number.isFinite(distanceValue) ? `${label} (${formatDistance(distanceValue)})` : label;
}

function formatChatHistoryEntry(entry: ChatHistoryEntry | null): string | null {
  if (!entry) {
    return null;
  }

  if (entry.channel === "public" && entry.username && entry.text) {
    return `<${entry.username}> ${entry.text}`;
  }

  if (entry.channel === "server" && entry.text) {
    return entry.text;
  }

  if (entry.username && entry.text) {
    return `[${entry.channel ?? "chat"}] <${entry.username}> ${entry.text}`;
  }

  if (entry.text) {
    return `[${entry.channel ?? "chat"}] ${entry.text}`;
  }

  return null;
}

function formatEventSummary(
  event: { payload?: unknown; type?: string | null } | null,
): string | null {
  if (!event?.type) {
    return null;
  }

  const summary = summarizePayload(event.payload);
  return summary ? `${event.type}: ${summary}` : event.type;
}

function isSolidBlock(block: { boundingBox?: string | null } | null): boolean {
  return block?.boundingBox === "block";
}

function isEmptyBlock(block: { boundingBox?: string | null } | null): boolean {
  return !block || block.boundingBox === "empty";
}

function isShelterCueBlockName(name: string | null | undefined): boolean {
  if (!name) {
    return false;
  }

  return name.endsWith("_bed") || name.endsWith("_door") || name.endsWith("_trapdoor");
}

function isContainerBlockName(name: string | null | undefined): boolean {
  if (!name) {
    return false;
  }

  return CONTAINER_BLOCK_NAMES.has(name) || name.endsWith("_shulker_box");
}

function isCurrentPositionEnclosed(bot: MinecraftBot): boolean {
  requireSpawned(bot);

  const origin = bot.entity.position.floored();
  const feet = bot.blockAt(origin);
  const head = bot.blockAt(origin.offset(0, 1, 0));
  const ground = bot.blockAt(origin.offset(0, -1, 0));
  const roof = bot.blockAt(origin.offset(0, 2, 0));

  return isSolidBlock(ground) && isEmptyBlock(feet) && isEmptyBlock(head) && isSolidBlock(roof);
}

function extractShelterCues(blockEntries: VisibleBlockSummary[], shelteredNow: boolean): string[] {
  const cues = shelteredNow ? ["current_position_enclosed"] : [];

  for (const block of blockEntries) {
    if (!isShelterCueBlockName(block.name)) {
      continue;
    }

    cues.push(`${block.name} (${formatDistance(block.distance)})`);

    if (cues.length >= MAX_PERCEPTION_ITEMS) {
      break;
    }
  }

  return cues;
}

function extractContainerCues(blockEntries: VisibleBlockSummary[]): string[] {
  return blockEntries
    .filter((block) => isContainerBlockName(block.name))
    .slice(0, MAX_PERCEPTION_ITEMS)
    .map((block) => `${block.name} (${formatDistance(block.distance)})`);
}

function findBiome(bot: MinecraftBot): string {
  requireSpawned(bot);

  const origin = bot.entity.position.floored();
  const feetBlock = bot.blockAt(origin);
  const groundBlock = bot.blockAt(origin.offset(0, -1, 0));

  return feetBlock?.biome?.name ?? groundBlock?.biome?.name ?? "unknown";
}

function buildPerception(context: {
  bot: MinecraftBot;
  chat: ChatModule;
  events: EventStreamLike;
  safetyStatus: SafetyStatus;
  world: WorldModule;
}) {
  const { bot, chat, events, safetyStatus, world } = context;
  const visibleArea = world.inspectVisibleArea({
    blockLimit: MAX_NEARBY_BLOCKS,
    entityLimit: MAX_PERCEPTION_ITEMS,
    maxDistance: 8,
  });
  const hostileIds = new Set((safetyStatus.hostiles ?? []).map((entity) => entity.id));
  const hostileEntities = visibleArea.visibleEntities.filter((entity) => {
    if (hostileIds.size > 0 && entity.id != null) {
      return hostileIds.has(entity.id);
    }

    return (safetyStatus.hostiles ?? []).some((hostile) =>
      hostile.id != null && entity.id != null
        ? hostile.id === entity.id
        : hostile.name === entity.name && hostile.username === entity.username,
    );
  });
  const scannedBlocks = visibleArea.visibleBlocks;

  return {
    nearbyBlocks: scannedBlocks.slice(0, MAX_NEARBY_BLOCKS).map((block) => block.name),
    nearbyEntities: visibleArea.visibleEntities
      .map(formatEntitySummary)
      .filter((value): value is string => Boolean(value)),
    hostiles: hostileEntities
      .map(formatEntitySummary)
      .filter((value): value is string => Boolean(value)),
    shelters: extractShelterCues(scannedBlocks, isCurrentPositionEnclosed(bot)),
    containers: extractContainerCues(scannedBlocks),
    recentChat: chat
      .history(10)
      .map(formatChatHistoryEntry)
      .filter((value): value is string => Boolean(value)),
    recentEvents: events
      .recent(50)
      .filter((event) => typeof event?.type === "string" && !event.type.startsWith("chat:"))
      .slice(-10)
      .map(formatEventSummary)
      .filter((value): value is string => Boolean(value)),
    visibleArea,
  };
}

export function createOrchestrationModule(
  bot: MinecraftBot,
  context: OrchestrationContext,
): OrchestrationModule {
  const { chat, events, inventory, safety, world } = context;

  function snapshot(): OrchestrationSnapshot {
    requireSpawned(bot);

    const safetyStatus = safety.status(16);
    const memoryState = context.memory.state();
    const recentFailures = memoryState.working.filter((item) => item.tags.includes("failure"));

    return {
      self: {
        health: bot.health ?? 0,
        hunger: bot.food ?? 0,
        position: serializeVec3(bot.entity.position),
        biome: findBiome(bot),
        timeOfDay: bot.time?.isDay === false ? "night" : "day",
        inventory: aggregateInventoryCounts(inventory.items()),
        equipped: collectEquippedItemNames(bot),
        risk: classifyRiskLevel(safetyStatus, bot.health ?? null),
      },
      perception: buildPerception({
        bot,
        chat,
        events,
        safetyStatus,
        world,
      }),
      memory: memoryState,
      planning: {
        currentGoal: context.memory.currentGoal(),
        currentSkill: undefined,
        executor: context.getExecutorStatus?.() ?? null,
        planner: context.getPlannerStatus?.() ?? null,
        plan: [],
        recentFailures,
      },
    };
  }

  return {
    snapshot,
  };
}

export const orchestrationInternals = {
  aggregateInventoryCounts,
  classifyRiskLevel,
  collectEquippedItemNames,
  extractContainerCues,
  extractShelterCues,
  formatChatHistoryEntry,
  formatEntitySummary,
  formatEventSummary,
  isContainerBlockName,
  isCurrentPositionEnclosed,
  isShelterCueBlockName,
};
