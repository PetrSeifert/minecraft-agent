import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

import type { Agent, MinecraftBot, StreamEvent } from "../types";
import type { FrontendState } from "./state";

interface CommandRequest {
  args?: string[];
  command: string;
}

interface CommandResult {
  error?: string;
  ok: boolean;
  result?: unknown;
}

function getAllowedOrigins(port: number): Set<string> {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  return !origin || allowedOrigins.has(origin);
}

function parseNumber(raw: string, label: string): number {
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Expected ${label} to be a number, got "${raw}"`);
  }
  return value;
}

async function executeCommand(
  bot: MinecraftBot,
  agent: Agent,
  req: CommandRequest,
): Promise<CommandResult> {
  const { command, args = [] } = req;

  try {
    switch (command) {
      case "chat": {
        if (!args[0]) throw new Error("Message required");
        return { ok: true, result: agent.chat.say(args[0]) };
      }
      case "goal": {
        return { ok: true, result: { goal: agent.memory.currentGoal() } };
      }
      case "goal:set": {
        if (!args[0]) throw new Error("Goal text required");
        return { ok: true, result: agent.memory.setGoal(args[0]) };
      }
      case "goal:clear": {
        return { ok: true, result: agent.memory.setGoal(null) };
      }
      case "goto": {
        if (args.length < 3) throw new Error("x, y, z required");
        const range = args[3] ? parseNumber(args[3], "range") : 0;
        return {
          ok: true,
          result: await agent.pathing.goto(
            {
              x: parseNumber(args[0], "x"),
              y: parseNumber(args[1], "y"),
              z: parseNumber(args[2], "z"),
            },
            range,
          ),
        };
      }
      case "follow": {
        if (!args[0]) throw new Error("Player name required");
        const target = agent.world.entityByUsername(args[0]);
        if (!target) throw new Error(`Player not found: ${args[0]}`);
        const range = args[1] ? parseNumber(args[1], "range") : 2;
        return { ok: true, result: agent.pathing.followEntity(target, range) };
      }
      case "stop": {
        agent.pathing.stop();
        return { ok: true, result: "Pathing stopped" };
      }
      case "mine": {
        if (args.length < 3) throw new Error("x, y, z required");
        return {
          ok: true,
          result: await agent.actions.mineBlockAt({
            x: parseNumber(args[0], "x"),
            y: parseNumber(args[1], "y"),
            z: parseNumber(args[2], "z"),
          }),
        };
      }
      case "craft": {
        if (!args[0]) throw new Error("Item name required");
        const count = args[1] ? parseNumber(args[1], "count") : 1;
        return { ok: true, result: await agent.actions.craftItem(args[0], count) };
      }
      case "place": {
        if (args.length < 4) throw new Error("item, x, y, z required");
        return {
          ok: true,
          result: await agent.actions.placeBlockAt(args[0], {
            x: parseNumber(args[1], "x"),
            y: parseNumber(args[2], "y"),
            z: parseNumber(args[3], "z"),
          }),
        };
      }
      case "open": {
        if (args.length < 3) throw new Error("x, y, z required");
        const result = await agent.actions.openContainerAt({
          x: parseNumber(args[0], "x"),
          y: parseNumber(args[1], "y"),
          z: parseNumber(args[2], "z"),
        });
        result.container.close();
        return {
          ok: true,
          result: { block: result.block, items: result.items, window: result.window },
        };
      }
      case "attack": {
        const maxDist = args[0] ? parseNumber(args[0], "distance") : 16;
        return { ok: true, result: await agent.combat.attackNearestHostile(maxDist) };
      }
      case "safety:on": {
        return { ok: true, result: agent.safety.enable() };
      }
      case "safety:off": {
        return { ok: true, result: agent.safety.disable() };
      }
      case "safety:now": {
        return { ok: true, result: await agent.safety.escapeDanger("dashboard") };
      }
      case "retreat": {
        const minDist = args[0] ? parseNumber(args[0], "distance") : 12;
        return { ok: true, result: await agent.safety.retreatFromNearestHostile(minDist) };
      }
      case "planner:on": {
        return { ok: true, result: agent.planner.enable() };
      }
      case "planner:off": {
        return { ok: true, result: agent.planner.disable() };
      }
      case "planner:now": {
        return { ok: true, result: await agent.planner.replanNow("dashboard") };
      }
      case "executor:on": {
        return { ok: true, result: agent.executor.enable() };
      }
      case "executor:off": {
        return { ok: true, result: agent.executor.disable() };
      }
      case "executor:now": {
        return { ok: true, result: await agent.executor.stepNow("dashboard") };
      }
      case "findblock": {
        if (!args[0]) throw new Error("Block name required");
        const maxDist = args[1] ? parseNumber(args[1], "distance") : 32;
        return { ok: true, result: agent.world.findBlockByName(args[0], { maxDistance: maxDist }) };
      }
      case "block": {
        if (args.length < 3) throw new Error("x, y, z required");
        return {
          ok: true,
          result: agent.world.getBlockDetailsAt({
            x: parseNumber(args[0], "x"),
            y: parseNumber(args[1], "y"),
            z: parseNumber(args[2], "z"),
          }),
        };
      }
      case "inspect": {
        const maxDist = args[0] ? parseNumber(args[0], "distance") : undefined;
        return { ok: true, result: agent.world.inspectVisibleArea({ maxDistance: maxDist }) };
      }
      case "entities": {
        const maxDist = args[0] ? parseNumber(args[0], "distance") : 16;
        return { ok: true, result: agent.world.nearbyEntities({ maxDistance: maxDist }) };
      }
      case "quit": {
        bot.quit("Dashboard requested shutdown");
        return { ok: true, result: "Shutting down" };
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message, ok: false };
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json",
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export function startDashboardServer(
  bot: MinecraftBot,
  agent: Agent,
  getState: () => FrontendState,
  port: number,
): http.Server {
  const dashboardPath = path.join(__dirname, "dashboard.html");
  const allowedOrigins = getAllowedOrigins(port);

  const sseClients = new Set<http.ServerResponse>();
  let isClosed = false;

  // Forward events to SSE clients
  agent.events.on("event", (event: unknown) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(data);
    }
  });

  // Periodic state push (every 2s)
  const stateInterval = setInterval(() => {
    if (sseClients.size === 0) return;
    try {
      const data = `event: state\ndata: ${JSON.stringify(getState())}\n\n`;
      for (const client of sseClients) {
        client.write(data);
      }
    } catch {
      // Ignore snapshot errors during state transitions
    }
  }, 2000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const origin = req.headers.origin;

    if (!isAllowedOrigin(origin, allowedOrigins)) {
      sendJson(res, 403, { error: "Cross-origin dashboard access is not allowed" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(405, {
        "Content-Length": "0",
      });
      res.end();
      return;
    }

    // Dashboard HTML
    if (url.pathname === "/" && req.method === "GET") {
      try {
        const html = fs.readFileSync(dashboardPath, "utf-8");
        res.writeHead(200, {
          "Content-Length": Buffer.byteLength(html),
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(html);
      } catch {
        sendJson(res, 500, { error: "Dashboard file not found" });
      }
      return;
    }

    // State snapshot
    if (url.pathname === "/api/state" && req.method === "GET") {
      try {
        sendJson(res, 200, getState());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { error: message });
      }
      return;
    }

    // SSE event stream
    if (url.pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });
      res.write("\n");
      sseClients.add(res);

      // Send initial state
      try {
        res.write(`event: state\ndata: ${JSON.stringify(getState())}\n\n`);
      } catch {
        // Ignore
      }

      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    // Command API
    if (url.pathname === "/api/command" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as CommandRequest;
        const result = await executeCommand(bot, agent, parsed);
        sendJson(res, result.ok ? 200 : 400, result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, { error: message, ok: false });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    const detail = error.code ? `${error.code}: ${error.message}` : error.message;
    console.error(`[dashboard] Failed to bind http://127.0.0.1:${port}: ${detail}`);
  });

  function closeServer(): void {
    if (isClosed) {
      return;
    }

    isClosed = true;
    clearInterval(stateInterval);
    for (const client of sseClients) {
      client.end();
    }
    sseClients.clear();

    if (server.listening) {
      server.close();
    }
  }

  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : port;
    console.log(`[dashboard] http://127.0.0.1:${actualPort}`);
  });

  server.on("close", closeServer);
  bot.on("end", closeServer);

  return server;
}
