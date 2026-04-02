import assert from "node:assert/strict";
import { test } from "vitest";

import { terminalInternals } from "../src/bot/terminal";

test("help text includes inspect command", () => {
  assert.match(terminalInternals.helpText(), /\/inspect \[distance\]/);
  assert.match(terminalInternals.helpText(), /\/goal/);
  assert.match(terminalInternals.helpText(), /\/state/);
  assert.match(terminalInternals.helpText(), /\/planner \[status\|on\|off\|now\]/);
  assert.match(terminalInternals.helpText(), /\/executor \[status\|on\|off\|now\]/);
});

test("inspect command returns serialized visible-area output and forwards optional distance", async () => {
  const calls: Array<number | undefined> = [];
  const payload = {
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
    highlights: ["block: barrel (1.0)"],
    visibleBlocks: [
      {
        biome: "plains",
        boundingBox: "block",
        diggable: true,
        distance: 1,
        name: "barrel",
        position: { x: 1, y: 64, z: 0 },
      },
    ],
    visibleEntities: [],
  };
  const agent = {
    world: {
      inspectVisibleArea(options?: { maxDistance?: number }) {
        calls.push(options?.maxDistance);
        return payload;
      },
    },
  };
  const bot = {
    quit() {},
  };

  const defaultOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    "/inspect",
  );
  const overrideOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    "/inspect 12",
  );

  assert.deepEqual(calls, [undefined, 12]);
  assert.deepEqual(JSON.parse(defaultOutput ?? "null"), payload);
  assert.deepEqual(JSON.parse(overrideOutput ?? "null"), payload);
});

test("goal and planner commands expose planner state and manual replanning", async () => {
  const plannerStatus = {
    currentGoal: "Gather nearby wood",
    enabled: true,
    inFlight: false,
    lastError: null,
    lastPlannedAt: "2026-01-01T00:00:00.000Z",
    lastTrigger: "spawn",
    model: "openrouter/test-model",
    provider: "openrouter",
  };
  const executorStatus = {
    currentGoal: "Gather nearby wood",
    enabled: true,
    inFlight: false,
    lastDecision: {
      args: {},
      tool: "inspect_visible_area",
    },
    lastError: null,
    lastStepAt: "2026-01-01T00:00:05.000Z",
    lastTrigger: "goal_update",
    model: "openrouter/test-model",
    provider: "openrouter",
  };
  const calls: string[] = [];
  const agent = {
    executor: {
      disable() {
        calls.push("executor:disable");
        return {
          ...executorStatus,
          enabled: false,
        };
      },
      enable() {
        calls.push("executor:enable");
        return executorStatus;
      },
      async stepNow(reason?: string) {
        calls.push(`executor:step:${reason ?? ""}`);
        return {
          ...executorStatus,
          lastTrigger: reason ?? "manual",
        };
      },
      status() {
        calls.push("executor:status");
        return executorStatus;
      },
    },
    memory: {
      currentGoal() {
        return "Gather nearby wood";
      },
    },
    planner: {
      disable() {
        calls.push("disable");
        return {
          ...plannerStatus,
          enabled: false,
        };
      },
      enable() {
        calls.push("enable");
        return plannerStatus;
      },
      async replanNow(reason?: string) {
        calls.push(`replan:${reason ?? ""}`);
        return {
          ...plannerStatus,
          lastTrigger: reason ?? "manual",
        };
      },
      status() {
        calls.push("status");
        return plannerStatus;
      },
    },
  };
  const bot = {
    quit() {},
  };

  const goalOutput = await terminalInternals.runCommand(bot as never, agent as never, "/goal");
  const replanOutput = await terminalInternals.runCommand(bot as never, agent as never, "/replan");
  const plannerNowOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    "/planner now",
  );
  const plannerStatusOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    "/planner",
  );
  const plannerOffOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    "/planner off",
  );
  const executorNowOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    "/executor now",
  );
  const executorStatusOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    "/executor",
  );
  const executorOffOutput = await terminalInternals.runCommand(
    bot as never,
    agent as never,
    "/executor off",
  );

  assert.deepEqual(JSON.parse(goalOutput ?? "null"), {
    goal: "Gather nearby wood",
  });
  assert.equal(JSON.parse(replanOutput ?? "null").lastTrigger, "manual_terminal");
  assert.equal(JSON.parse(plannerNowOutput ?? "null").lastTrigger, "planner_now_terminal");
  assert.equal(JSON.parse(plannerStatusOutput ?? "null").model, "openrouter/test-model");
  assert.equal(JSON.parse(plannerOffOutput ?? "null").enabled, false);
  assert.equal(JSON.parse(executorNowOutput ?? "null").lastTrigger, "executor_now_terminal");
  assert.equal(
    JSON.parse(executorStatusOutput ?? "null").lastDecision.tool,
    "inspect_visible_area",
  );
  assert.equal(JSON.parse(executorOffOutput ?? "null").enabled, false);
  assert.deepEqual(calls, [
    "replan:manual_terminal",
    "replan:planner_now_terminal",
    "status",
    "disable",
    "executor:step:executor_now_terminal",
    "executor:status",
    "executor:disable",
  ]);
});

test("state command returns the orchestration snapshot", async () => {
  const snapshot = {
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
      currentGoal: "Gather nearby wood",
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
  const agent = {
    orchestration: {
      snapshot() {
        return snapshot;
      },
    },
  };
  const bot = {
    quit() {},
  };

  const output = await terminalInternals.runCommand(bot as never, agent as never, "/state");

  assert.deepEqual(JSON.parse(output ?? "null"), JSON.parse(JSON.stringify(snapshot)));
});
