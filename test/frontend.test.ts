import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";

import { startDashboardServer } from "../src/frontend/server";
import { createStateAdapter } from "../src/frontend/state";

function createAgentStub() {
  const events = new EventEmitter() as EventEmitter & {
    recent(
      limit?: number,
    ): Array<{ id: number; payload: unknown; timestamp: string; type: string }>;
  };

  events.recent = () => [
    {
      id: 1,
      payload: { message: "hello" },
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "bot:error",
    },
  ];

  return {
    actions: {},
    chat: {
      history() {
        return [
          {
            channel: "server",
            text: "Connecting...",
            timestamp: "2026-01-01T00:00:00.000Z",
            username: null,
          },
        ];
      },
    },
    combat: {},
    debug: {
      knockback: {
        enabled: false,
      },
    },
    executor: {
      status() {
        return {
          currentGoal: "wait for spawn",
          enabled: false,
          inFlight: false,
          lastDecision: null,
          lastError: null,
          lastStepAt: null,
          lastTrigger: null,
          model: "",
          provider: "openrouter" as const,
        };
      },
    },
    events,
    inventory: {
      summary() {
        return {
          heldItem: null,
          hotbarSlot: 0,
          items: [],
          slotsUsed: 0,
        };
      },
    },
    memory: {
      currentGoal() {
        return "wait for spawn";
      },
      state() {
        return {
          longTerm: [],
          shortTerm: {
            events: [],
            summaries: [],
          },
          working: [],
        };
      },
    },
    orchestration: {
      snapshot() {
        throw new Error("orchestration snapshot should not be called before spawn");
      },
    },
    pathing: {
      status() {
        return {
          building: false,
          goal: null,
          hasGoal: false,
          mining: false,
          moving: false,
          pausedMs: 0,
          physicsEnabled: true,
          physicsHoldMs: 0,
          ready: false,
        };
      },
    },
    planner: {
      status() {
        return {
          currentGoal: "wait for spawn",
          enabled: false,
          inFlight: false,
          lastError: null,
          lastPlannedAt: null,
          lastTrigger: null,
          model: "",
          provider: "openrouter" as const,
        };
      },
    },
    safety: {
      status() {
        return {
          blocks: {
            feet: null,
            ground: null,
            head: null,
          },
          drowning: false,
          health: null,
          hostiles: [],
          inLava: false,
          inWater: false,
          mobAggro: false,
          monitorEnabled: false,
          onFire: false,
          oxygenLevel: null,
          pathing: {
            building: false,
            goal: null,
            hasGoal: false,
            mining: false,
            moving: false,
            pausedMs: 0,
            physicsEnabled: true,
            physicsHoldMs: 0,
            ready: false,
          },
          position: null,
          recentSelfHurt: false,
        };
      },
    },
    world: {},
  };
}

test("state adapter returns a fallback snapshot before spawn", () => {
  const bot = Object.assign(new EventEmitter(), {
    entity: {
      position: null,
    },
  });
  const agent = createAgentStub();
  const state = createStateAdapter(bot as never, agent as never, {
    auth: "offline",
    host: "localhost",
    port: 25565,
    username: "MineflayerBot",
  }).snapshot();

  assert.equal(state.session.status, "connecting");
  assert.equal(state.orchestration.planning.currentGoal, "wait for spawn");
  assert.equal(state.orchestration.planning.executor?.enabled, false);
  assert.deepEqual(state.orchestration.perception.recentChat, ["Connecting..."]);
  assert.deepEqual(state.orchestration.perception.recentEvents, ["bot:error"]);
  assert.equal(state.orchestration.self.position, null);
});

test("dashboard server rejects cross-origin requests and keeps same-origin responses local", async () => {
  const bot = Object.assign(new EventEmitter(), {
    quit() {},
  });
  const agent = createAgentStub();
  const server = startDashboardServer(
    bot as never,
    agent as never,
    () =>
      createStateAdapter(bot as never, agent as never, {
        auth: "offline",
        host: "localhost",
        port: 25565,
        username: "MineflayerBot",
      }).snapshot(),
    0,
  );

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const blocked = await fetch(`${baseUrl}/api/state`, {
      headers: {
        Origin: "https://evil.example",
      },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);

    const allowed = await fetch(`${baseUrl}/api/state`);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), null);
  } finally {
    bot.emit("end");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
});

test("dashboard server handles listen failures without throwing", async () => {
  const occupied = await new Promise<import("node:http").Server>((resolve) => {
    const http = require("node:http") as typeof import("node:http");
    const server = http.createServer((_req, res) => res.end("ok"));
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

  const address = occupied.address();
  assert.ok(address && typeof address === "object");

  const bot = Object.assign(new EventEmitter(), {
    quit() {},
  });
  const agent = createAgentStub();
  const errors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  try {
    const server = startDashboardServer(
      bot as never,
      agent as never,
      () =>
        createStateAdapter(bot as never, agent as never, {
          auth: "offline",
          host: "localhost",
          port: 25565,
          username: "MineflayerBot",
        }).snapshot(),
      address.port,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(server.listening, false);
    assert.ok(errors.some((line) => line.includes("Failed to bind")));
    bot.emit("end");
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    console.error = originalConsoleError;
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
