import type {
  EventStreamLike,
  ExecutorDecision,
  ExecutorModule,
  ExecutorStatus,
  MinecraftBot,
  OrchestrationModule,
  SafetyModule,
  StreamEvent,
} from '../../types';
import type { ExecutorToolInvocation, ExecutorToolRegistry } from './executorTools';

const DEFAULT_EVENT_DEBOUNCE_MS = 750;
const DEFAULT_INITIAL_SPAWN_DELAY_MS = 500;

type EventSource = EventStreamLike & {
  on(event: 'event', listener: (event: StreamEvent) => void): void;
};

type ExecutorClient = {
  chooseTool(
    snapshot: ReturnType<OrchestrationModule['snapshot']>,
    tools: ReturnType<ExecutorToolRegistry['definitions']>,
  ): Promise<ExecutorDecision>;
  readonly model: string;
  readonly provider: 'openrouter';
};

interface ExecutorModuleOptions {
  clearIntervalFn?: (timer: NodeJS.Timeout) => void;
  clearTimeoutFn?: (timer: NodeJS.Timeout) => void;
  eventDebounceMs?: number;
  initialSpawnDelayMs?: number;
  now?: () => number;
  setIntervalFn?: (handler: () => void, timeout: number) => NodeJS.Timeout;
  setTimeoutFn?: (handler: () => void, timeout: number) => NodeJS.Timeout;
  startEnabled?: boolean;
}

interface ExecutorContext {
  client: ExecutorClient;
  events: EventSource;
  goalExecutorIntervalMs: number;
  memory: {
    currentGoal(): string | null;
  };
  orchestration: OrchestrationModule;
  safety: SafetyModule;
  tools: ExecutorToolRegistry;
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toTimestamp(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

export function createExecutorModule(
  bot: MinecraftBot,
  context: ExecutorContext,
  options: ExecutorModuleOptions = {},
): ExecutorModule {
  const now = options.now ?? Date.now;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const eventDebounceMs = options.eventDebounceMs ?? DEFAULT_EVENT_DEBOUNCE_MS;
  const initialSpawnDelayMs =
    options.initialSpawnDelayMs ?? DEFAULT_INITIAL_SPAWN_DELAY_MS;
  const { client, events, orchestration, safety, tools } = context;
  let enabled = options.startEnabled ?? true;
  let inFlight = false;
  let lastDecision: ExecutorDecision | null = null;
  let lastError: string | null = null;
  let lastStepAt: string | null = null;
  let lastTrigger: string | null = null;
  let intervalTimer: NodeJS.Timeout | null = null;
  let pendingStepTimer: NodeJS.Timeout | null = null;
  let pendingTrigger: string | null = null;
  let cooldownUntil = 0;
  let hasSpawned = Boolean(bot.entity?.position);

  function status(): ExecutorStatus {
    return {
      currentGoal: context.memory.currentGoal(),
      enabled,
      inFlight,
      lastDecision,
      lastError,
      lastStepAt,
      lastTrigger,
      model: client.model,
      provider: client.provider,
    };
  }

  function pushExecutorEvent(
    type: 'request' | 'success' | 'failure' | 'skip' | 'state',
    payload: Record<string, unknown>,
  ): void {
    events.push(`executor:${type}`, {
      currentGoal: context.memory.currentGoal(),
      model: client.model,
      provider: client.provider,
      ...payload,
    });
  }

  function stopInterval(): void {
    if (!intervalTimer) {
      return;
    }

    clearIntervalFn(intervalTimer);
    intervalTimer = null;
  }

  function clearPendingStep(): void {
    if (!pendingStepTimer) {
      return;
    }

    clearTimeoutFn(pendingStepTimer);
    pendingStepTimer = null;
    pendingTrigger = null;
  }

  function scheduleStep(trigger: string, delayMs = eventDebounceMs): void {
    if (!enabled) {
      return;
    }

    pendingTrigger = trigger;

    if (pendingStepTimer) {
      clearTimeoutFn(pendingStepTimer);
    }

    pendingStepTimer = setTimeoutFn(() => {
      const scheduledTrigger = pendingTrigger ?? trigger;
      pendingStepTimer = null;
      pendingTrigger = null;
      void runExecutionCycle(scheduledTrigger);
    }, delayMs);
  }

  function startInterval(): void {
    if (intervalTimer || context.goalExecutorIntervalMs <= 0) {
      return;
    }

    intervalTimer = setIntervalFn(() => {
      void runExecutionCycle('interval');
    }, context.goalExecutorIntervalMs);
  }

  function applyInvocationOutcome(invocation: ExecutorToolInvocation): void {
    if (invocation.outcome === 'wait' && invocation.nextDelayMs) {
      cooldownUntil = Math.max(cooldownUntil, now() + invocation.nextDelayMs);
    }
  }

  async function runExecutionCycle(
    trigger: string,
    force = false,
  ): Promise<ExecutorStatus> {
    lastTrigger = trigger;

    if (!enabled && !force) {
      pushExecutorEvent('skip', { reason: 'disabled', trigger });
      return status();
    }

    if (inFlight) {
      pushExecutorEvent('skip', { reason: 'in_flight', trigger });
      return status();
    }

    const currentGoal = context.memory.currentGoal();

    if (!currentGoal) {
      pushExecutorEvent('skip', { reason: 'no_goal', trigger });
      return status();
    }

    if (!force && cooldownUntil > now()) {
      pushExecutorEvent('skip', {
        reason: 'cooldown',
        trigger,
        until: toTimestamp(cooldownUntil),
      });
      return status();
    }

    if (safety.status().escapeInProgress) {
      pushExecutorEvent('skip', { reason: 'safety_escape', trigger });
      return status();
    }

    inFlight = true;
    pushExecutorEvent('request', { trigger });

    try {
      const snapshot = orchestration.snapshot();
      const decision = await client.chooseTool(snapshot, tools.definitions());
      const invocation = await tools.invoke(decision);

      lastDecision = decision;
      lastError = null;
      lastStepAt = toTimestamp(now());
      applyInvocationOutcome(invocation);
      pushExecutorEvent('success', {
        args: decision.args,
        outcome: invocation.outcome,
        result: invocation.result,
        tool: decision.tool,
        trigger,
      });

      return status();
    } catch (error: unknown) {
      const message = serializeError(error);

      if (message.includes('Bot has not spawned yet')) {
        pushExecutorEvent('skip', { reason: 'not_spawned', trigger });
        return status();
      }

      lastError = message;
      pushExecutorEvent('failure', {
        decision: lastDecision,
        error: message,
        trigger,
      });
      return status();
    } finally {
      inFlight = false;
    }
  }

  function enable(): ExecutorStatus {
    if (enabled) {
      return status();
    }

    enabled = true;
    pushExecutorEvent('state', {
      enabled,
      trigger: 'enable',
    });
    startInterval();

    if (hasSpawned && context.memory.currentGoal()) {
      scheduleStep('enable', 0);
    }

    return status();
  }

  function disable(): ExecutorStatus {
    enabled = false;
    stopInterval();
    clearPendingStep();
    pushExecutorEvent('state', {
      enabled,
      trigger: 'disable',
    });
    return status();
  }

  bot.on('spawn', () => {
    hasSpawned = true;

    if (context.memory.currentGoal()) {
      scheduleStep('spawn', initialSpawnDelayMs);
    }
  });

  bot.on('end', () => {
    stopInterval();
    clearPendingStep();
  });

  events.on('event', (event) => {
    if (event.type !== 'goal:update') {
      return;
    }

    const payload = event.payload as { goal?: unknown } | null;

    if (typeof payload?.goal === 'string' && payload.goal.trim()) {
      cooldownUntil = 0;
      scheduleStep('goal_update', 0);
    }
  });

  if (enabled) {
    startInterval();
  }

  return {
    disable,
    enable,
    status,
    stepNow(reason = 'manual') {
      return runExecutionCycle(reason, true);
    },
  };
}

export const executorInternals = {
  toTimestamp,
};
