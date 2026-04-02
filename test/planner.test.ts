import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { EventStream } from "../src/agent/eventStream";
import { createPlannerModule } from "../src/agent/modules/planner";

import type { MemoryState, OrchestrationSnapshot, StreamEvent } from "../src/types";

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
      hunger: 20,
      inventory: {},
      position: { x: 0, y: 64, z: 0 },
      risk: "low",
      timeOfDay: "day",
    },
  };
}

function emptyMemoryState(): MemoryState {
  return {
    longTerm: [],
    shortTerm: {
      events: [],
      summaries: [],
    },
    working: [],
  };
}

function createPlannerHarness(
  options: {
    chooseGoal?: () => Promise<string>;
    currentGoal?: string | null;
    eventDebounceMs?: number;
    initialSpawnDelayMs?: number;
    intervalMs?: number;
    snapshotError?: () => Error | null;
    spawned?: boolean;
    startEnabled?: boolean;
  } = {},
) {
  const events = new EventStream();
  let currentGoal = options.currentGoal ?? null;
  let setGoalCalls = 0;
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
      setGoalCalls += 1;
      currentGoal = text?.trim() || null;
      events.push("goal:update", {
        goal: currentGoal,
      });
      return {
        goal: currentGoal,
      };
    },
    state() {
      return emptyMemoryState();
    },
    summarizeNow() {
      return null;
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

  const planner = createPlannerModule(
    bot as never,
    {
      client: {
        chooseGoal: options.chooseGoal ?? (async () => "Gather nearby wood"),
        model: "openrouter/test-model",
        provider: "openrouter",
      },
      events: events as never,
      goalPlannerIntervalMs: options.intervalMs ?? 1_000_000,
      memory: memory as never,
      orchestration: orchestration as never,
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
    memory,
    planner,
    resetSetGoalCalls() {
      setGoalCalls = 0;
    },
    setGoalCalls() {
      return setGoalCalls;
    },
  };
}

function plannerEvents(events: EventStream, type: StreamEvent["type"]): StreamEvent[] {
  return events.recent(100).filter((event) => event.type === type);
}

test("planner sets a new goal on success and records planner status", async () => {
  const harness = createPlannerHarness();

  const status = await harness.planner.replanNow("manual_test");

  assert.equal(harness.memory.currentGoal(), "Gather nearby wood");
  assert.equal(status.currentGoal, "Gather nearby wood");
  assert.equal(status.lastError, null);
  assert.equal(status.lastTrigger, "manual_test");
  assert.ok(status.lastPlannedAt);
  assert.equal(plannerEvents(harness.events, "planner:success").length, 1);

  harness.planner.disable();
});

test("planner leaves the goal unchanged on failure and on materially identical goals", async () => {
  const sameGoalHarness = createPlannerHarness({
    currentGoal: "Gather nearby wood",
    chooseGoal: async () => "  gather nearby wood  ",
  });

  sameGoalHarness.resetSetGoalCalls();

  const unchangedStatus = await sameGoalHarness.planner.replanNow("same_goal");

  assert.equal(sameGoalHarness.memory.currentGoal(), "Gather nearby wood");
  assert.equal(sameGoalHarness.setGoalCalls(), 0);
  assert.equal(
    (plannerEvents(sameGoalHarness.events, "planner:success")[0]?.payload as { changed?: boolean })
      ?.changed,
    false,
  );
  assert.equal(unchangedStatus.lastError, null);

  sameGoalHarness.planner.disable();

  const failingHarness = createPlannerHarness({
    chooseGoal: async () => {
      throw new Error("OpenRouter unavailable");
    },
    currentGoal: "Gather nearby wood",
  });

  const failedStatus = await failingHarness.planner.replanNow("failure_case");

  assert.equal(failingHarness.memory.currentGoal(), "Gather nearby wood");
  assert.equal(failedStatus.lastError, "OpenRouter unavailable");
  assert.equal(plannerEvents(failingHarness.events, "planner:failure").length, 1);

  failingHarness.planner.disable();
});

test("planner skips overlapping replans while one request is in flight", async () => {
  const deferred: {
    resolve?: (goal: string) => void;
  } = {};
  const harness = createPlannerHarness({
    chooseGoal: () =>
      new Promise<string>((resolve) => {
        deferred.resolve = resolve;
      }),
  });

  const firstReplan = harness.planner.replanNow("first_manual");
  await sleep(0);
  const skippedStatus = await harness.planner.replanNow("second_manual");

  assert.equal(skippedStatus.inFlight, true);
  assert.equal(
    (plannerEvents(harness.events, "planner:skip")[0]?.payload as { reason?: string })?.reason,
    "in_flight",
  );

  if (typeof deferred.resolve === "function") {
    deferred.resolve("Gather wood");
  }
  await firstReplan;

  assert.equal(harness.memory.currentGoal(), "Gather wood");
  harness.planner.disable();
});

test("planner triggers on spawn, manual requests, goal clear, death, and interval", async () => {
  let counter = 0;
  const harness = createPlannerHarness({
    chooseGoal: async () => `Goal ${++counter}`,
    eventDebounceMs: 5,
    initialSpawnDelayMs: 0,
    intervalMs: 25,
    spawned: false,
    startEnabled: true,
  });

  harness.bot.emit("spawn");
  await sleep(15);

  await harness.planner.replanNow("manual_test");

  harness.memory.setGoal(null);
  await sleep(15);

  harness.bot.emit("death");
  await sleep(15);

  await sleep(35);

  const triggers = plannerEvents(harness.events, "planner:request").map(
    (event) => (event.payload as { trigger?: string })?.trigger,
  );

  assert.ok(triggers.includes("spawn"));
  assert.ok(triggers.includes("manual_test"));
  assert.ok(triggers.includes("goal_cleared"));
  assert.ok(triggers.includes("death"));
  assert.ok(triggers.includes("interval"));

  harness.planner.disable();
});
