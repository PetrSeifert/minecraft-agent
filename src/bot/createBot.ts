import * as readline from "node:readline";

import { createBot as createMineflayerBot } from "mineflayer";

import { createAgent } from "../agent";
import { startDashboardServer } from "../frontend/server";
import { createStateAdapter } from "../frontend/state";
import { installPhysicsCompat } from "./installPhysicsCompat";
import { installProtocolCompat } from "./installProtocolCompat";
import { createTerminal } from "./terminal";

import type { BotConfig, MinecraftBot } from "../types";

function formatError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray(error.errors) &&
    error.errors.length > 0
  ) {
    return error.errors
      .map((nestedError) =>
        nestedError instanceof Error ? nestedError.message : String(nestedError),
      )
      .join(" | ");
  }

  return error instanceof Error ? error.message : String(error);
}

export async function createBot(config: BotConfig): Promise<MinecraftBot> {
  const {
    dashboardPort,
    debugKnockback,
    debugKnockbackFile,
    goalExecutorIntervalMs: _goalExecutorIntervalMs,
    goalPlannerIntervalMs: _goalPlannerIntervalMs,
    openRouterApiKey: _openRouterApiKey,
    openRouterBaseUrl: _openRouterBaseUrl,
    openRouterModel: _openRouterModel,
    ...botOptions
  } = config;

  const bot = createMineflayerBot({
    ...botOptions,
    hideErrors: true,
    physicsEnabled: false,
  } as never) as MinecraftBot;

  function ensurePhysicsCompat(): void {
    installPhysicsCompat(bot);
  }

  ensurePhysicsCompat();
  bot.on("login", () => {
    setImmediate(ensurePhysicsCompat);
  });
  bot.on("spawn", () => {
    setImmediate(ensurePhysicsCompat);
  });

  installProtocolCompat(bot);
  const agent = await createAgent(bot, config);
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let hasLoggedIn = false;
  let lastErrorText: string | null = null;

  bot.once("login", () => {
    hasLoggedIn = true;
    console.log(`[bot] Logged in as ${bot.username}`);
  });

  bot.once("spawn", () => {
    const { x, y, z } = bot.entity.position;
    console.log(`[bot] Spawned at x=${x.toFixed(1)} y=${y.toFixed(1)} z=${z.toFixed(1)}`);
    if (debugKnockback) {
      console.log(`[debug] Knockback logging enabled: ${debugKnockbackFile}`);
    }
    console.log("[bot] Type chat into this terminal, or use /help for agent commands");
  });

  bot.on("chat", (username, message) => {
    if (username === bot.username) {
      return;
    }

    console.log(`[chat] <${username}> ${message}`);
  });

  bot.on("messagestr", (message) => {
    console.log(`[server] ${message}`);
  });

  bot.on("kicked", (reason) => {
    console.error("[bot] Kicked from server:", reason);
  });

  bot.on("error", (error) => {
    const errorText = formatError(error);

    if (errorText === lastErrorText) {
      return;
    }

    lastErrorText = errorText;
    console.error("[bot] Error:", errorText);
  });

  bot.on("end", () => {
    if (!hasLoggedIn) {
      process.exitCode = 1;
    }

    console.log("[bot] Connection closed");
    terminal.close();
  });

  createTerminal(bot, agent, terminal);

  const stateAdapter = createStateAdapter(bot, agent, config);
  startDashboardServer(bot, agent, stateAdapter.snapshot, dashboardPort);

  return bot;
}
