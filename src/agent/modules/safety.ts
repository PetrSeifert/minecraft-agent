import { goals } from "mineflayer-pathfinder";

import { isHostileEntity, serializeEntity, serializeVec3, toVec3 } from "../utils";
import { instrumentAsyncOperation } from "../operationEvents";

import type {
  CombatModule,
  EntityLike,
  EventStreamLike,
  MinecraftBot,
  PathingModule,
  SafetyModule,
  SafetyStatus,
  Vec3Like,
  WorldModule,
} from "../../types";

const { GoalBlock } = goals;
const FIRE_BLOCK_NAMES = new Set([
  "campfire",
  "fire",
  "lava",
  "magma_block",
  "soul_campfire",
  "soul_fire",
]);
const RANGED_HOSTILE_NAMES = new Set([
  "blaze",
  "bogged",
  "breeze",
  "drowned",
  "ghast",
  "guardian",
  "pillager",
  "skeleton",
  "stray",
  "witch",
]);
const HIGH_DANGER_HOSTILE_NAMES = new Set(["creeper", "piglin_brute", "ravager", "warden"]);
const DEFAULT_ESCAPE_ACTION_TIMEOUT_MS = 10_000;
const SAFE_POSITION_REACHABILITY_CHECK_LIMIT = 8;

interface SafetyContext {
  combat: CombatModule;
  events: EventStreamLike;
  pathing: PathingModule;
  world: WorldModule;
}

interface SafetyModuleOptions {
  clearTimeoutFn?: (timer: NodeJS.Timeout) => void;
  escapeActionTimeoutMs?: number;
  setTimeoutFn?: (handler: () => void, timeout: number) => NodeJS.Timeout;
}

export function createSafetyModule(
  bot: MinecraftBot,
  context: SafetyContext,
  options: SafetyModuleOptions = {},
): SafetyModule {
  const { events, pathing, world } = context;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const escapeActionTimeoutMs = options.escapeActionTimeoutMs ?? DEFAULT_ESCAPE_ACTION_TIMEOUT_MS;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;

  let monitorEnabled = false;
  let monitorInterval: NodeJS.Timeout | null = null;
  let escapeInProgress = false;
  let lastSelfHurtAt = 0;
  let lastEscape: ReturnType<SafetyModule["status"]>["lastEscape"] = null;

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeoutFn(resolve, ms));
  }

  async function awaitEscapeMovement<T>(movement: Promise<T>): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;
    let timedOut = false;
    const guardedMovement = movement.then(
      (result) => {
        if (timedOut) {
          return undefined as T;
        }

        return result;
      },
      (error: unknown) => {
        if (timedOut) {
          return undefined as T;
        }

        throw error;
      },
    );

    try {
      return await new Promise<T>((resolve, reject) => {
        timeoutId = setTimeoutFn(() => {
          timedOut = true;
          pathing.stop();
          events.push("safety:escape_timeout", {
            timeoutMs: escapeActionTimeoutMs,
          });
          reject(new Error(`Safety escape timed out after ${escapeActionTimeoutMs}ms`));
        }, escapeActionTimeoutMs);

        guardedMovement.then(resolve, reject);
      });
    } finally {
      if (timeoutId) {
        clearTimeoutFn(timeoutId);
      }
    }
  }

  function blockNameAt(position: Vec3Like): string | null {
    return bot.blockAt(position as never)?.name ?? null;
  }

  function isHazardousBlockName(name: string | null): boolean {
    return name ? FIRE_BLOCK_NAMES.has(name) : false;
  }

  function isWaterBlockName(name: string | null): boolean {
    return name === "water";
  }

  function entityFireFlag(): boolean {
    const flags = Number(bot.entity?.metadata?.[0] ?? 0);
    return (flags & 0x01) !== 0;
  }

  function currentBlocks() {
    if (!bot.entity?.position) {
      return {
        feet: null,
        ground: null,
        head: null,
      };
    }

    const feetPos = bot.entity.position.floored();

    return {
      feet: blockNameAt(feetPos),
      ground: blockNameAt(feetPos.offset(0, -1, 0)),
      head: blockNameAt(feetPos.offset(0, 1, 0)),
    };
  }

  function nearbyHostiles(maxDistance = 12) {
    if (!bot.entity?.position) {
      return [];
    }

    return world.nearbyEntities({
      maxDistance,
      matcher: isHostileEntity,
    });
  }

  function nearestAggroThreat(maxDistance = 16, recentSelfHurt = false) {
    const hostiles = nearbyHostiles(maxDistance);
    let bestThreat: (typeof hostiles)[number] | null = null;
    let bestScore = 0;

    for (const hostile of hostiles) {
      const distance = hostile.distance ?? Infinity;
      const name = hostile.name ?? "";
      let score = 0;

      if (distance <= 2.5) {
        score += 8;
      } else if (distance <= 4) {
        score += 6;
      } else if (distance <= 6) {
        score += 4;
      } else if (distance <= 8) {
        score += 3;
      } else if (distance <= 12) {
        score += 1;
      }

      if (RANGED_HOSTILE_NAMES.has(name) && distance <= 12) {
        score += 2;
      }

      if (HIGH_DANGER_HOSTILE_NAMES.has(name) && distance <= 8) {
        score += 2;
      }

      if (recentSelfHurt && distance <= 16) {
        score += 4;
      }

      if (score > bestScore) {
        bestScore = score;
        bestThreat = hostile;
      }
    }

    return {
      score: bestScore,
      threat: bestThreat,
    };
  }

  function assess(maxDistance = 12): SafetyStatus {
    if (!bot.entity?.position) {
      return {
        blocks: {
          feet: null,
          ground: null,
          head: null,
        },
        drowning: false,
        health: bot.health ?? null,
        hostiles: [],
        inLava: false,
        inWater: false,
        mobAggro: false,
        monitorEnabled,
        onFire: false,
        oxygenLevel: bot.oxygenLevel ?? null,
        pathing: pathing.status(),
        position: null,
        recentSelfHurt: false,
      };
    }

    const blocks = currentBlocks();
    const hostiles = nearbyHostiles(maxDistance);
    const now = Date.now();

    const inWater =
      (bot.entity as any)?.isInWater === true || blocks.feet === "water" || blocks.head === "water";
    const inLava = blocks.feet === "lava" || blocks.head === "lava";
    const onFire =
      entityFireFlag() ||
      isHazardousBlockName(blocks.feet) ||
      isHazardousBlockName(blocks.ground) ||
      isHazardousBlockName(blocks.head);
    const drowning = inWater && (bot.oxygenLevel ?? 400) < 240;
    const recentSelfHurt = now - lastSelfHurtAt < 2500;
    const aggro = nearestAggroThreat(Math.max(maxDistance, 16), recentSelfHurt);
    const mobAggro = aggro.score >= 3;

    return {
      blocks,
      drowning,
      health: bot.health ?? null,
      hostiles,
      inLava,
      inWater,
      mobAggro,
      monitorEnabled,
      nearestThreat: serializeEntity(aggro.threat),
      nearestThreatScore: aggro.score,
      onFire,
      oxygenLevel: bot.oxygenLevel ?? null,
      pathing: pathing.status(),
      position: bot.entity?.position ? serializeVec3(bot.entity.position) : null,
      recentSelfHurt,
    };
  }

  function isStandable(
    position: {
      distanceTo(other: unknown): number;
      offset(x: number, y: number, z: number): unknown;
    },
    avoidPosition: Vec3Like | null = null,
    avoidRadius = 6,
  ): boolean {
    const feet = bot.blockAt(position as never);
    const head = bot.blockAt(position.offset(0, 1, 0) as never);
    const ground = bot.blockAt(position.offset(0, -1, 0) as never);

    if (!feet || !head || !ground) {
      return false;
    }

    if (feet.boundingBox !== "empty" || head.boundingBox !== "empty") {
      return false;
    }

    if (ground.boundingBox !== "block") {
      return false;
    }

    if (
      isHazardousBlockName(feet.name) ||
      isHazardousBlockName(head.name) ||
      isHazardousBlockName(ground.name)
    ) {
      return false;
    }

    if (avoidPosition && position.distanceTo(toVec3(avoidPosition)) < avoidRadius) {
      return false;
    }

    return true;
  }

  function findNearestSafePosition(
    maxDistance = 12,
    avoidPosition: Vec3Like | null = null,
    options: { avoidRadius?: number } = {},
  ) {
    if (!bot.entity?.position) {
      return null;
    }

    const origin = bot.entity.position.floored();
    const avoidRadius = options.avoidRadius ?? 6;
    const candidates: Array<{ position: typeof origin; score: number }> = [];

    for (let y = -2; y <= 2; y += 1) {
      for (let x = -maxDistance; x <= maxDistance; x += 1) {
        for (let z = -maxDistance; z <= maxDistance; z += 1) {
          const candidate = origin.offset(x, y, z);

          if (!isStandable(candidate, avoidPosition, avoidRadius)) {
            continue;
          }

          const distance = candidate.distanceTo(origin);

          if (distance > maxDistance) {
            continue;
          }

          let score = distance;

          if (avoidPosition) {
            score -= Math.min(candidate.distanceTo(toVec3(avoidPosition)), 20) * 0.6;
          }

          candidates.push({
            position: candidate.clone(),
            score,
          });
        }
      }
    }

    candidates.sort((left, right) => left.score - right.score);

    for (const candidate of candidates.slice(0, SAFE_POSITION_REACHABILITY_CHECK_LIMIT)) {
      if (canReachPosition(candidate.position)) {
        return candidate.position;
      }
    }

    return candidates[0]?.position ?? null;
  }

  function canReachPosition(position: Vec3Like): boolean {
    if (!bot.entity?.position || !bot.pathfinder?.getPathTo) {
      return true;
    }

    try {
      const target = toVec3(position).floored();
      const result = bot.pathfinder.getPathTo(
        pathing.movements as never,
        new GoalBlock(target.x, target.y, target.z),
        250,
      );

      return result.status === "success";
    } catch {
      return true;
    }
  }

  function findWaterEscapeTarget(maxDistance = 12) {
    const waterBlocks = world.findBlocksByName("water", {
      count: 12,
      maxDistance,
    });

    for (const waterBlock of waterBlocks) {
      if (!waterBlock?.position) {
        continue;
      }

      const position = toVec3(waterBlock.position).floored();
      const feet = blockNameAt(position);
      const head = blockNameAt(position.offset(0, 1, 0));

      if (!isWaterBlockName(feet) && !isWaterBlockName(head)) {
        continue;
      }

      return serializeVec3(position);
    }

    return null;
  }

  async function escapeDrowning() {
    bot.setControlState("jump", true);
    await delay(400);
    bot.setControlState("jump", false);

    const safePosition = findNearestSafePosition(10);

    if (!safePosition) {
      return {
        action: "jump_only",
      };
    }

    await awaitEscapeMovement(pathing.goto(safePosition, 0));

    return {
      action: "surface_escape",
      target: serializeVec3(safePosition),
    };
  }

  async function escapeFire() {
    const waterTarget = findWaterEscapeTarget(12);

    if (waterTarget) {
      await awaitEscapeMovement(
        pathing.goto(waterTarget, 0, {
          ignorePause: true,
        }),
      );

      return {
        action: "water_escape",
        target: waterTarget,
      };
    }

    const safePosition = findNearestSafePosition(10);

    if (!safePosition) {
      return {
        action: "stop_drop_only",
      };
    }

    await awaitEscapeMovement(pathing.goto(safePosition, 0));

    return {
      action: "fire_escape",
      target: serializeVec3(safePosition),
    };
  }

  async function escapeMobAggro() {
    const threat = nearestAggroThreat(16, true).threat ?? world.nearestHostile(16);

    if (!threat?.position) {
      return {
        action: "no_threat_found",
      };
    }

    const safePosition = findNearestSafePosition(14, threat.position, {
      avoidRadius: 8,
    });

    if (safePosition) {
      await awaitEscapeMovement(
        pathing.goto(safePosition, 0, {
          ignorePause: true,
        }),
      );

      return {
        action: "retreat_to_safe_position",
        target: serializeVec3(safePosition),
        threat: serializeEntity(threat),
      };
    }

    await awaitEscapeMovement(
      pathing.moveAwayFrom(threat.position, 14, {
        ignorePause: true,
      }),
    );

    return {
      action: "retreat_away_from_threat",
      threat: serializeEntity(threat),
    };
  }

  async function escapeDangerOperation(reason = "manual") {
    if (escapeInProgress) {
      return {
        busy: true,
        lastEscape,
      };
    }

    escapeInProgress = true;
    const snapshot = assess();

    try {
      let result = null;

      if (snapshot.inLava || snapshot.onFire) {
        result = await escapeFire();
      } else if (snapshot.drowning) {
        result = await escapeDrowning();
      } else if (snapshot.mobAggro) {
        result = await escapeMobAggro();
      } else {
        const safePosition = findNearestSafePosition(10);

        if (safePosition) {
          await awaitEscapeMovement(pathing.goto(safePosition, 0));
          result = {
            action: "move_to_safe_position",
            target: serializeVec3(safePosition),
          };
        } else {
          result = {
            action: "no_escape_needed",
          };
        }
      }

      lastEscape = {
        ...result,
        reason,
        timestamp: new Date().toISOString(),
      };

      return lastEscape;
    } finally {
      escapeInProgress = false;
    }
  }

  async function autoProtect(): Promise<void> {
    if (escapeInProgress || !bot.entity?.position) {
      return;
    }

    const snapshot = assess();

    if (snapshot.inLava || snapshot.onFire || snapshot.drowning || snapshot.mobAggro) {
      try {
        await escapeDanger("auto");
      } catch (_error) {
        // Safety reactions should fail closed without crashing the bot loop.
      }
    }
  }

  function enable() {
    if (monitorEnabled) {
      return status();
    }

    monitorEnabled = true;
    monitorInterval = setInterval(() => {
      void autoProtect();
    }, 250);

    return status();
  }

  function disable() {
    monitorEnabled = false;

    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }

    return status();
  }

  function status(maxDistance = 12) {
    return {
      ...assess(maxDistance),
      escapeInProgress,
      lastEscape,
    };
  }

  async function retreatFromNearestHostileOperation(minDistance = 12) {
    const hostile = world.nearestHostile(minDistance * 2);

    if (!hostile?.position) {
      throw new Error(`No hostile entities found within ${minDistance * 2} blocks`);
    }

    await pathing.moveAwayFrom(hostile.position, minDistance);

    return {
      minDistance,
      hostile: serializeEntity(hostile),
    };
  }

  const escapeDanger = instrumentAsyncOperation(
    events,
    {
      action: "safety.escapeDanger",
      failure: ([reason = "manual"], error) => ({
        priority: 9,
        tags: ["safety", "escape"],
        text: `Failed safety escape (${reason}): ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([reason = "manual"]) => ({
        priority: 6,
        tags: ["safety", "escape"],
        text: `Running safety escape (${reason})`,
      }),
      success: (_args, result) => ({
        priority: 8,
        tags: ["safety", "escape"],
        text: `Safety escape result: ${result.action ?? "completed"}`,
      }),
    },
    escapeDangerOperation,
  );

  const retreatFromNearestHostile = instrumentAsyncOperation(
    events,
    {
      action: "safety.retreatFromNearestHostile",
      failure: ([minDistance = 12], error) => ({
        priority: 9,
        tags: ["safety", "retreat"],
        text: `Failed hostile retreat at distance ${minDistance}: ${error instanceof Error ? error.message : String(error)}`,
      }),
      start: ([minDistance = 12]) => ({
        priority: 6,
        tags: ["safety", "retreat"],
        text: `Retreating from nearest hostile to distance ${minDistance}`,
      }),
      success: (_args, result) => ({
        priority: 8,
        tags: ["safety", "retreat"],
        text: `Retreated from ${result.hostile?.name ?? result.hostile?.username ?? "hostile"} to distance ${result.minDistance}`,
      }),
    },
    retreatFromNearestHostileOperation,
  );

  bot.on("entityHurt", (entity) => {
    if (entity?.id === bot.entity?.id) {
      lastSelfHurtAt = Date.now();

      if (monitorEnabled && !escapeInProgress) {
        void escapeDanger("self_hurt").catch(() => {});
      }
    }
  });

  bot.on("death", () => {
    lastEscape = {
      action: "death",
      timestamp: new Date().toISOString(),
    };
  });

  bot.on("end", () => {
    disable();
  });

  return {
    disable,
    enable,
    escapeDanger,
    retreatFromNearestHostile,
    status,
  };
}

export const safetyInternals = {
  canReachPosition: (bot: MinecraftBot, pathing: PathingModule, position: Vec3Like) => {
    if (!bot.entity?.position || !bot.pathfinder?.getPathTo) {
      return true;
    }

    try {
      const target = toVec3(position).floored();
      const result = bot.pathfinder.getPathTo(
        pathing.movements as never,
        new GoalBlock(target.x, target.y, target.z),
        250,
      );

      return result.status === "success";
    } catch {
      return true;
    }
  },
};
