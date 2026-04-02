import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";

import { EventStream } from "../src/agent/eventStream";
import { createExecutorModule } from "../src/agent/modules/executor";

import type { ExecutorDecision, JsonValue, OrchestrationSnapshot, StreamEvent } from "../src/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createSnapshot(currentGoal: string | null): OrchestrationSnapshot {
  return {
    memory: {
      longTerm: [],
      shortTerm: {
        events: [],
        summaries: [],
      },
      working: [],
    },
    perception: {
      containers: [],
      hostiles: [],
      nearbyBlocks: ["oak_log"],
      nearbyEntities: [],
      recentChat: [],
      recentEvents: [],
      shelters: [],
      visibleArea: {
        focus: {
          blockAtCursor: null,
          entityAtCursor: null,
        },
        hazards: [],
        heading: {
          cardinal: "south",
          pitch: 0,
          yaw: 0,
        },
        highlights: [],
        visibleBlocks: [],
        visibleEntities: [],
      },
    },
    planning: {
      currentGoal,
      currentSkill: undefined,
      executor: null,
      planner: null,
      plan: [],
      recentFailures: [],
    },
    self: {
      biome: "plains",
      equipped: [],
      health: 20,
      hunger: 10,
      inventory: {},
      position: { x: 0, y: 64, z: 0 },
      risk: "low",
      timeOfDay: "day",
    },
  };
}

function executorEvents(events: EventStream, type: StreamEvent["type"]): StreamEvent[] {
  return events.recent(200).filter((event) => event.type === type);
}

function createExecutorHarness(
  options: {
    currentGoal?: string | null;
    eventDebounceMs?: number;
    initialSpawnDelayMs?: number;
    intervalMs?: number;
    invoke?: (decision: ExecutorDecision) => Promise<{
      nextDelayMs?: number;
      outcome: "action" | "goal_blocked" | "goal_complete" | "observe" | "wait";
      result: JsonValue;
    }>;
    chooseTool?: () => Promise<ExecutorDecision>;
    snapshotError?: () => Error | null;
    spawned?: boolean;
    startEnabled?: boolean;
    safetyEscapeInProgress?: boolean;
  } = {},
) {
  const events = new EventStream();
  let currentGoal: string | null = options.currentGoal ?? "find some food to eat";
  let spawned = options.spawned ?? true;
  const bot = Object.assign(new EventEmitter(), {
    entity: {
      position: spawned ? { x: 0, y: 64, z: 0 } : null,
    },
  });

  bot.on("spawn", () => {
    spawned = true;
    bot.entity.position = { x: 0, y: 64, z: 0 };
  });

  const memory = {
    currentGoal() {
      return currentGoal;
    },
    setGoal(text: string | null) {
      currentGoal = text?.trim() || null;
      events.push("goal:update", {
        goal: currentGoal,
      });

      return {
        goal: currentGoal,
      };
    },
  };

  const orchestration = {
    snapshot() {
      const snapshotError = options.snapshotError?.();

      if (snapshotError) {
        throw snapshotError;
      }

      if (!spawned) {
        throw new Error("Bot has not spawned yet");
      }

      return createSnapshot(currentGoal);
    },
  };

  let chooseToolCalls = 0;
  let invokeCalls = 0;
  const executor = createExecutorModule(
    bot as never,
    {
      client: {
        chooseTool: async () => {
          chooseToolCalls += 1;
          return options.chooseTool
            ? options.chooseTool()
            : {
                args: {},
                tool: "inspect_visible_area",
              };
        },
        model: "openrouter/test-model",
        provider: "openrouter",
      },
      events: events as never,
      goalExecutorIntervalMs: options.intervalMs ?? 1_000_000,
      memory: memory as never,
      orchestration: orchestration as never,
      safety: {
        status() {
          return {
            escapeInProgress: options.safetyEscapeInProgress ?? false,
          };
        },
      } as never,
      tools: {
        definitions() {
          return [
            {
              description: "Inspect visible area.",
              name: "inspect_visible_area",
              parameters: {
                type: "object",
                properties: {},
              },
            },
          ];
        },
        async invoke(decision: ExecutorDecision) {
          invokeCalls += 1;

          if (options.invoke) {
            return options.invoke(decision);
          }

          return {
            outcome: "observe" as const,
            result: {
              ok: true,
            },
          };
        },
      },
    },
    {
      eventDebounceMs: options.eventDebounceMs ?? 5,
      initialSpawnDelayMs: options.initialSpawnDelayMs ?? 0,
      startEnabled: options.startEnabled ?? true,
    },
  );

  return {
    bot,
    events,
    executor,
    invokeCalls() {
      return invokeCalls;
    },
    memory,
    setSafetyEscapeInProgress(value: boolean) {
      options.safetyEscapeInProgress = value;
    },
    chooseToolCalls() {
      return chooseToolCalls;
    },
  };
}

test("executor triggers on spawn, manual step, goal update, and interval", async () => {
  const harness = createExecutorHarness({
    eventDebounceMs: 5,
    initialSpawnDelayMs: 0,
    intervalMs: 25,
    spawned: false,
    startEnabled: true,
  });

  harness.bot.emit("spawn");
  await sleep(15);

  await harness.executor.stepNow("manual_test");

  harness.memory.setGoal("find nearby wood");
  await sleep(15);
  await sleep(35);

  const triggers = executorEvents(harness.events, "executor:request").map(
    (event) => (event.payload as { trigger?: string })?.trigger,
  );

  assert.ok(triggers.includes("spawn"));
  assert.ok(triggers.includes("manual_test"));
  assert.ok(triggers.includes("goal_update"));
  assert.ok(triggers.includes("interval"));

  harness.executor.disable();
  harness.bot.emit("end");
});

test("executor performs exactly one tool decision and invocation per cycle", async () => {
  const harness = createExecutorHarness();

  const status = await harness.executor.stepNow("single_cycle");

  assert.equal(status.lastDecision?.tool, "inspect_visible_area");
  assert.equal(harness.chooseToolCalls(), 1);
  assert.equal(harness.invokeCalls(), 1);

  harness.executor.disable();
  harness.bot.emit("end");
});

test("executor skips when safety is escaping and when bot has not spawned", async () => {
  const safetyHarness = createExecutorHarness({
    safetyEscapeInProgress: true,
  });

  const safetyStatus = await safetyHarness.executor.stepNow("safety_skip");
  assert.equal(safetyStatus.lastError, null);
  assert.equal(
    (executorEvents(safetyHarness.events, "executor:skip")[0]?.payload as { reason?: string })
      ?.reason,
    "safety_escape",
  );

  const spawnHarness = createExecutorHarness({
    spawned: false,
  });

  const spawnStatus = await spawnHarness.executor.stepNow("spawn_skip");
  assert.equal(spawnStatus.lastError, null);
  assert.equal(
    (executorEvents(spawnHarness.events, "executor:skip")[0]?.payload as { reason?: string })
      ?.reason,
    "not_spawned",
  );

  safetyHarness.executor.disable();
  safetyHarness.bot.emit("end");
  spawnHarness.executor.disable();
  spawnHarness.bot.emit("end");
});

test("executor handles goal completion, goal blocked, and wait outcomes", async () => {
  let invocationIndex = 0;
  const harness = createExecutorHarness({
    intervalMs: 25,
    invoke: async () => {
      invocationIndex += 1;

      if (invocationIndex === 1) {
        return {
          outcome: "goal_complete" as const,
          result: { done: true } as JsonValue,
        };
      }

      if (invocationIndex === 2) {
        return {
          outcome: "goal_blocked" as const,
          result: { blocked: true } as JsonValue,
        };
      }

      return {
        nextDelayMs: 500,
        outcome: "wait" as const,
        result: { waiting: true } as JsonValue,
      };
    },
  });

  harness.memory.setGoal("eat food");
  await harness.executor.stepNow("goal_complete");
  harness.memory.setGoal(null);
  assert.equal(harness.executor.status().currentGoal, null);

  harness.memory.setGoal("mine stone");
  await harness.executor.stepNow("goal_blocked");
  harness.memory.setGoal(null);
  assert.equal(harness.executor.status().currentGoal, null);

  harness.memory.setGoal("observe");
  await harness.executor.stepNow("wait_result");
  await sleep(40);

  const skipReasons = executorEvents(harness.events, "executor:skip").map(
    (event) => (event.payload as { reason?: string })?.reason,
  );
  assert.ok(skipReasons.includes("cooldown"));

  harness.executor.disable();
  harness.bot.emit("end");
});

test("executor records failures and failure events", async () => {
  const harness = createExecutorHarness({
    chooseTool: async () => {
      throw new Error("tool selection failed");
    },
  });

  const status = await harness.executor.stepNow("failure_case");

  assert.equal(status.lastError, "tool selection failed");
  assert.equal(executorEvents(harness.events, "executor:failure").length, 1);

  harness.executor.disable();
  harness.bot.emit("end");
});
