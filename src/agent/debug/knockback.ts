import * as fs from "node:fs";
import * as path from "node:path";

import { serializeVec3 } from "../utils";

import type { BlockLike, KnockbackDebugger, MinecraftBot, PathingModule } from "../../types";

type LooseEmitter = {
  on(event: string, listener: (...args: any[]) => void): void;
};

function serializeControls(bot: MinecraftBot) {
  return {
    back: bot.controlState?.back ?? false,
    forward: bot.controlState?.forward ?? false,
    jump: bot.controlState?.jump ?? false,
    left: bot.controlState?.left ?? false,
    right: bot.controlState?.right ?? false,
    sneak: bot.controlState?.sneak ?? false,
    sprint: bot.controlState?.sprint ?? false,
  };
}

function blockSummary(block: BlockLike | null): {
  boundingBox: string | null;
  name: string | null;
  position: ReturnType<typeof serializeVec3>;
} | null {
  if (!block) {
    return null;
  }

  return {
    boundingBox: block.boundingBox ?? null,
    name: block.name ?? null,
    position: serializeVec3(block.position ?? null),
  };
}

export function createKnockbackDebugger(
  bot: MinecraftBot,
  pathing: PathingModule,
  options: { enabled?: boolean; filePath?: string } = {},
): KnockbackDebugger {
  const enabled = Boolean(options.enabled);

  if (!enabled) {
    return {
      enabled: false,
    };
  }

  const filePath = path.resolve(options.filePath || "knockback-debug.log");
  let sampleTicksRemaining = 0;
  let sequence = 0;

  fs.appendFileSync(filePath, `\n# knockback debug session ${new Date().toISOString()}\n`);

  function snapshot() {
    const feetPosition = bot.entity?.position?.floored?.() ?? null;
    const groundPosition = feetPosition?.offset?.(0, -1, 0) ?? null;

    return {
      blockFeet: blockSummary(
        feetPosition ? ((bot.blockAt(feetPosition) as BlockLike | null) ?? null) : null,
      ),
      blockGround: blockSummary(
        groundPosition ? ((bot.blockAt(groundPosition) as BlockLike | null) ?? null) : null,
      ),
      controlState: serializeControls(bot),
      food: bot.food ?? null,
      health: bot.health ?? null,
      jumpQueued: bot.jumpQueued ?? null,
      onGround: bot.entity?.onGround ?? null,
      oxygenLevel: bot.oxygenLevel ?? null,
      pathing: pathing.status(),
      physicsEnabled: bot.physicsEnabled,
      position: serializeVec3(bot.entity?.position ?? null),
      velocity: serializeVec3(bot.entity?.velocity ?? null),
    };
  }

  function write(event: string, payload: unknown = {}): void {
    const line = JSON.stringify({
      event,
      payload,
      sequence: ++sequence,
      state: snapshot(),
      timestamp: new Date().toISOString(),
    });

    fs.appendFileSync(filePath, `${line}\n`);
  }

  function sampleTicks(reason: string, count = 30): void {
    sampleTicksRemaining = Math.max(sampleTicksRemaining, count);
    write("sample_ticks_start", { count, reason });
  }

  const pluginBot = bot as MinecraftBot & LooseEmitter;

  bot.on("entityHurt", (entity) => {
    if (entity?.id !== bot.entity?.id) {
      return;
    }

    write("self_hurt");
    sampleTicks("self_hurt", 40);
  });

  bot._client.on("entity_velocity", (packet) => {
    if ((packet as { entityId?: number }).entityId !== bot.entity?.id) {
      return;
    }

    write("entity_velocity", { packet });
    sampleTicks("entity_velocity", 40);
  });

  bot._client.on("position", (packet) => {
    write("server_position", { packet });
    sampleTicks("server_position", 40);
  });

  bot._client.on("explosion", (packet) => {
    write("explosion", { packet });
    sampleTicks("explosion", 40);
  });

  bot.on("forcedMove", () => {
    write("forced_move");
    sampleTicks("forced_move", 20);
  });

  pluginBot.on("physicsTick", () => {
    if (sampleTicksRemaining <= 0) {
      return;
    }

    write("physics_tick", { remaining: sampleTicksRemaining });
    sampleTicksRemaining -= 1;
  });

  bot.on("move", () => {
    if (sampleTicksRemaining <= 0) {
      return;
    }

    write("move");
  });

  pluginBot.on("physicsAnomaly", (details) => {
    write("physics_anomaly", details);
    sampleTicks("physics_anomaly", 20);
  });

  bot.on("kicked", (reason) => {
    write("kicked", { reason });
  });

  bot.on("error", (error) => {
    write("error", { message: error?.message ?? String(error) });
  });

  bot.on("end", () => {
    write("end");
  });

  write("debug_enabled", { filePath });

  return {
    enabled: true,
    filePath,
    sampleTicks,
    write,
  };
}
