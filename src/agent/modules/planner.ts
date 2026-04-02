import type {
  EventStreamLike,
  MemoryModule,
  MinecraftBot,
  OrchestrationModule,
  PlannerModule,
  PlannerStatus,
  StreamEvent,
} from "../../types";

const DEFAULT_EVENT_REPLAN_DEBOUNCE_MS = 1_500;
const DEFAULT_INITIAL_SPAWN_REPLAN_DELAY_MS = 1_000;

type EventSource = EventStreamLike & {
  on(event: "event", listener: (event: StreamEvent) => void): void;
};

type GoalClient = {
  readonly model: string;
  readonly provider: "openrouter";
  chooseGoal(snapshot: ReturnType<OrchestrationModule["snapshot"]>): Promise<string>;
};

interface PlannerModuleOptions {
  eventDebounceMs?: number;
  initialSpawnDelayMs?: number;
  now?: () => number;
  startEnabled?: boolean;
  clearIntervalFn?: (timer: NodeJS.Timeout) => void;
  clearTimeoutFn?: (timer: NodeJS.Timeout) => void;
  setIntervalFn?: (handler: () => void, timeout: number) => NodeJS.Timeout;
  setTimeoutFn?: (handler: () => void, timeout: number) => NodeJS.Timeout;
}

interface PlannerContext {
  client: GoalClient;
  events: EventSource;
  goalPlannerIntervalMs: number;
  memory: MemoryModule;
  orchestration: OrchestrationModule;
}

function normalizeGoal(value: string | null): string | null {
  const text = value?.trim().replace(/\s+/g, " ");
  return text ? text.toLowerCase() : null;
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toTimestamp(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function isGoalChanged(nextGoal: string, currentGoal: string | null): boolean {
  return normalizeGoal(nextGoal) !== normalizeGoal(currentGoal);
}

export function createPlannerModule(
  bot: MinecraftBot,
  context: PlannerContext,
  options: PlannerModuleOptions = {},
): PlannerModule {
  const now = options.now ?? Date.now;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const eventDebounceMs = options.eventDebounceMs ?? DEFAULT_EVENT_REPLAN_DEBOUNCE_MS;
  const initialSpawnDelayMs = options.initialSpawnDelayMs ?? DEFAULT_INITIAL_SPAWN_REPLAN_DELAY_MS;
  const { client, events, memory, orchestration } = context;
  let enabled = options.startEnabled ?? true;
  let inFlight = false;
  let lastError: string | null = null;
  let lastPlannedAt: string | null = null;
  let lastTrigger: string | null = null;
  let intervalTimer: NodeJS.Timeout | null = null;
  let pendingReplanTimer: NodeJS.Timeout | null = null;
  let pendingTrigger: string | null = null;
  let hasSpawned = Boolean(bot.entity?.position);

  function status(): PlannerStatus {
    return {
      currentGoal: memory.currentGoal(),
      enabled,
      inFlight,
      lastError,
      lastPlannedAt,
      lastTrigger,
      model: client.model,
      provider: client.provider,
    };
  }

  function pushPlannerEvent(
    type: "request" | "success" | "failure" | "skip" | "state",
    payload: Record<string, unknown>,
  ): void {
    events.push(`planner:${type}`, {
      currentGoal: memory.currentGoal(),
      model: client.model,
      provider: client.provider,
      ...payload,
    });
  }

  function clearPendingReplan(): void {
    if (!pendingReplanTimer) {
      return;
    }

    clearTimeoutFn(pendingReplanTimer);
    pendingReplanTimer = null;
    pendingTrigger = null;
  }

  function stopInterval(): void {
    if (!intervalTimer) {
      return;
    }

    clearIntervalFn(intervalTimer);
    intervalTimer = null;
  }

  async function runPlanningCycle(trigger: string, force = false): Promise<PlannerStatus> {
    lastTrigger = trigger;

    if (!enabled && !force) {
      pushPlannerEvent("skip", {
        reason: "disabled",
        trigger,
      });
      return status();
    }

    if (inFlight) {
      pushPlannerEvent("skip", {
        reason: "in_flight",
        trigger,
      });
      return status();
    }

    inFlight = true;
    pushPlannerEvent("request", { trigger });

    try {
      const snapshot = orchestration.snapshot();
      const chosenGoal = await client.chooseGoal(snapshot);
      const currentGoal = memory.currentGoal();
      const changed = isGoalChanged(chosenGoal, currentGoal);

      if (changed) {
        memory.setGoal(chosenGoal);
      }

      lastError = null;
      lastPlannedAt = toTimestamp(now());
      pushPlannerEvent("success", {
        changed,
        goal: chosenGoal,
        trigger,
      });
      return status();
    } catch (error: unknown) {
      const message = serializeError(error);

      if (message.includes("Bot has not spawned yet")) {
        pushPlannerEvent("skip", {
          reason: "not_spawned",
          trigger,
        });
        return status();
      }

      lastError = message;
      pushPlannerEvent("failure", {
        error: message,
        trigger,
      });
      return status();
    } finally {
      inFlight = false;
    }
  }

  function scheduleReplan(trigger: string, delayMs = eventDebounceMs): void {
    if (!enabled) {
      return;
    }

    pendingTrigger = trigger;

    if (pendingReplanTimer) {
      clearTimeoutFn(pendingReplanTimer);
    }

    pendingReplanTimer = setTimeoutFn(() => {
      const scheduledTrigger = pendingTrigger ?? trigger;
      pendingReplanTimer = null;
      pendingTrigger = null;
      void runPlanningCycle(scheduledTrigger);
    }, delayMs);
  }

  function startInterval(): void {
    if (intervalTimer || context.goalPlannerIntervalMs <= 0) {
      return;
    }

    intervalTimer = setIntervalFn(() => {
      void runPlanningCycle("interval");
    }, context.goalPlannerIntervalMs);
  }

  function enable(): PlannerStatus {
    if (enabled) {
      return status();
    }

    enabled = true;
    pushPlannerEvent("state", {
      enabled,
      trigger: "enable",
    });
    startInterval();

    if (hasSpawned) {
      scheduleReplan("enable", 0);
    }

    return status();
  }

  function disable(): PlannerStatus {
    enabled = false;
    stopInterval();
    clearPendingReplan();
    pushPlannerEvent("state", {
      enabled,
      trigger: "disable",
    });
    return status();
  }

  bot.on("spawn", () => {
    hasSpawned = true;
    scheduleReplan("spawn", initialSpawnDelayMs);
  });

  bot.on("death", () => {
    scheduleReplan("death");
  });

  bot.on("end", () => {
    stopInterval();
    clearPendingReplan();
  });

  events.on("event", (event) => {
    if (event.type !== "goal:update") {
      return;
    }

    const payload = event.payload as { goal?: unknown } | null;

    if (payload?.goal == null) {
      scheduleReplan("goal_cleared");
    }
  });

  if (enabled) {
    startInterval();
  }

  return {
    disable,
    enable,
    replanNow(reason = "manual") {
      return runPlanningCycle(reason, true);
    },
    status,
  };
}

export const plannerInternals = {
  isGoalChanged,
  normalizeGoal,
  toTimestamp,
};
