import { shouldSkipStreamEventMemoryNormalize } from "../streamEventNoise";
import { isHostileEntity, summarizePayload } from "../utils";

import type {
  EventStreamLike,
  MemoryModule,
  MemoryState,
  MinecraftBot,
  SafetyModule,
  SafetyStatus,
  ShortTermEvent,
  ShortTermSummary,
  StreamEvent,
  WorkingMemoryItem,
} from "../../types";

const DEFAULT_SUMMARIZATION_INTERVAL_MS = 30_000;
const SHORT_TERM_EVENT_LIMIT = 100;
const SHORT_TERM_SUMMARY_LIMIT = 8;
const WORKING_MEMORY_LIMIT = 12;
const RECENT_DIALOGUE_LIMIT = 3;
const RECENT_FAILURE_LIMIT = 3;
const RECENT_SUCCESS_LIMIT = 2;
const RECENT_SUMMARY_LIMIT = 2;
const ACTION_RESULT_EXPIRY_MS = 90_000;
const THREAT_EXPIRY_MS = 15_000;
const REMINDER_EXPIRY_MS = 5 * 60_000;

type EventSource = EventStreamLike & {
  on(event: "event", listener: (event: StreamEvent) => void): void;
};

interface NormalizedEventInput {
  payload?: unknown;
  priority?: number;
  sourceEventId?: number | null;
  sourceType?: string | null;
  tags: string[];
  text: string;
  timestamp: string;
  type: string;
}

interface MemoryModuleOptions {
  autoSummarize?: boolean;
  now?: () => number;
  summarizationIntervalMs?: number;
}

function toTimestamp(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function trimText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function eventPayloadObject(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

function eventPayloadText(payload: unknown): string | null {
  const record = eventPayloadObject(payload);

  if (!record) {
    return trimText(typeof payload === "string" ? payload : null);
  }

  return (
    trimText(typeof record.text === "string" ? record.text : null) ??
    trimText(typeof record.message === "string" ? record.message : null) ??
    trimText(typeof record.reason === "string" ? record.reason : null)
  );
}

function labelFromEntity(payload: unknown): string | null {
  const record = eventPayloadObject(payload);

  if (!record) {
    return null;
  }

  return (
    trimText(typeof record.username === "string" ? record.username : null) ??
    trimText(typeof record.name === "string" ? record.name : null) ??
    trimText(typeof record.displayName === "string" ? record.displayName : null) ??
    trimText(typeof record.type === "string" ? record.type : null)
  );
}

function rawEventTags(payload: unknown): string[] {
  const record = eventPayloadObject(payload);

  if (!record || !Array.isArray(record.tags)) {
    return [];
  }

  return record.tags.filter((tag): tag is string => typeof tag === "string");
}

function rawEventPriority(payload: unknown): number | undefined {
  const record = eventPayloadObject(payload);

  return typeof record?.priority === "number" ? record.priority : undefined;
}

function actionNameFromEvent(event: ShortTermEvent): string | null {
  const record = eventPayloadObject(event.payload);
  return trimText(typeof record?.action === "string" ? record.action : null);
}

function eventHasTag(event: { tags: string[] }, tag: string): boolean {
  return event.tags.includes(tag);
}

function normalizeStreamEvent(bot: MinecraftBot, event: StreamEvent): NormalizedEventInput[] {
  switch (event.type) {
    case "chat:public": {
      const payload = eventPayloadObject(event.payload);
      const username = trimText(typeof payload?.username === "string" ? payload.username : null);
      const text = eventPayloadText(event.payload);

      if (!text) {
        return [];
      }

      return [
        {
          payload: event.payload,
          priority: 4,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["dialogue", "received", "chat"],
          text: username ? `<${username}> ${text}` : text,
          timestamp: event.timestamp,
          type: "dialogue_received",
        },
      ];
    }
    case "chat:server": {
      const text = eventPayloadText(event.payload);

      if (!text) {
        return [];
      }

      return [
        {
          payload: event.payload,
          priority: 3,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["dialogue", "received", "server"],
          text,
          timestamp: event.timestamp,
          type: "dialogue_received",
        },
      ];
    }
    case "chat:send":
    case "chat:whisper": {
      const payload = eventPayloadObject(event.payload);
      const username = trimText(typeof payload?.username === "string" ? payload.username : null);
      const text = eventPayloadText(event.payload);

      if (!text) {
        return [];
      }

      return [
        {
          payload: event.payload,
          priority: 3,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["dialogue", "sent", event.type === "chat:whisper" ? "whisper" : "chat"],
          text: username ? `To ${username}: ${text}` : text,
          timestamp: event.timestamp,
          type: "dialogue_sent",
        },
      ];
    }
    case "goal:update": {
      const payload = eventPayloadObject(event.payload);
      const goal = trimText(typeof payload?.goal === "string" ? payload.goal : null);

      return [
        {
          payload: event.payload,
          priority: 9,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["goal"],
          text: goal ? `Goal updated: ${goal}` : "Goal cleared",
          timestamp: event.timestamp,
          type: "goal_update",
        },
      ];
    }
    case "action:start":
    case "action:success":
    case "action:failure": {
      const action = actionNameFromRawPayload(event.payload);
      const type = event.type.replace(":", "_");
      const statusTag =
        event.type === "action:failure"
          ? "failure"
          : event.type === "action:success"
            ? "success"
            : "start";
      const text = eventPayloadText(event.payload) ?? `${action ?? "action"} ${statusTag}`;

      return [
        {
          payload: event.payload,
          priority:
            rawEventPriority(event.payload) ??
            (event.type === "action:failure" ? 9 : event.type === "action:success" ? 6 : 4),
          sourceEventId: event.id,
          sourceType: event.type,
          tags: unique([
            "action",
            statusTag,
            ...(action ? [`action:${action}`] : []),
            ...rawEventTags(event.payload),
          ]),
          text,
          timestamp: event.timestamp,
          type,
        },
      ];
    }
    case "entity:spawn": {
      const entityLabel = labelFromEntity(event.payload);

      if (
        !entityLabel ||
        !isHostileEntity(event.payload as Parameters<typeof isHostileEntity>[0])
      ) {
        return [];
      }

      return [
        {
          payload: event.payload,
          priority: 8,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["observation", "threat", "hostile"],
          text: `Nearby threat spotted: ${entityLabel}`,
          timestamp: event.timestamp,
          type: "observation",
        },
      ];
    }
    case "bot:health": {
      const payload = eventPayloadObject(event.payload);
      const health = typeof payload?.health === "number" ? payload.health : null;
      const oxygenLevel = typeof payload?.oxygenLevel === "number" ? payload.oxygenLevel : null;
      const events: NormalizedEventInput[] = [];

      if (health !== null && health <= 8) {
        events.push({
          payload: event.payload,
          priority: 9,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["observation", "hazard", "health"],
          text: `Low health: ${health}`,
          timestamp: event.timestamp,
          type: "observation",
        });
      }

      if (oxygenLevel !== null && oxygenLevel < 240) {
        events.push({
          payload: event.payload,
          priority: 9,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["observation", "hazard", "oxygen"],
          text: `Low oxygen: ${oxygenLevel}`,
          timestamp: event.timestamp,
          type: "observation",
        });
      }

      return events;
    }
    case "bot:death":
      return [
        {
          payload: event.payload,
          priority: 10,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["observation", "failure", "death"],
          text: "Bot died",
          timestamp: event.timestamp,
          type: "observation",
        },
      ];
    case "safety:self_hurt_stabilize":
      return [
        {
          payload: event.payload,
          priority: 8,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["observation", "hazard", "damage"],
          text: "Took damage and stabilized movement",
          timestamp: event.timestamp,
          type: "observation",
        },
      ];
    case "executor:success": {
      const payload = eventPayloadObject(event.payload);
      const outcome = trimText(typeof payload?.outcome === "string" ? payload.outcome : null);
      const tool = trimText(typeof payload?.tool === "string" ? payload.tool : null);
      const text = formatExecutorObservationText(event.payload);

      if (outcome !== "observe" || !tool || !text) {
        return [];
      }

      return [
        {
          payload: event.payload,
          priority: 6,
          sourceEventId: event.id,
          sourceType: event.type,
          tags: ["observation", "executor", "result", "success", `tool:${tool}`],
          text,
          timestamp: event.timestamp,
          type: "observation",
        },
      ];
    }
    default:
      return [];
  }
}

function actionNameFromRawPayload(payload: unknown): string | null {
  const record = eventPayloadObject(payload);
  return trimText(typeof record?.action === "string" ? record.action : null);
}

function formatExecutorObservationText(payload: unknown): string | null {
  const record = eventPayloadObject(payload);

  if (!record) {
    return null;
  }

  const tool = trimText(typeof record?.tool === "string" ? record.tool : null);

  if (!tool) {
    return null;
  }

  const args = eventPayloadObject(record.args);
  const argsText = args
    ? Object.entries(args)
        .map(([key, value]) => {
          if (value == null) {
            return null;
          }

          const formattedValue =
            typeof value === "string" || typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : summarizePayload(value);

          return formattedValue == null ? null : `${key}=${formattedValue}`;
        })
        .filter((value): value is string => Boolean(value))
        .join(", ")
    : "";

  const resultSummary = summarizePayload(record.result);
  const resultText =
    resultSummary != null ? String(resultSummary) : record.result === null ? "not found" : null;

  if (!resultText) {
    return null;
  }

  return `${tool}${argsText ? `(${argsText})` : ""} -> ${resultText}`;
}

function buildSummaryText(events: ShortTermEvent[], currentGoal: string | null): string {
  const sections: string[] = [];
  const goalEvent = [...events].reverse().find((event) => event.type === "goal_update");

  if (goalEvent) {
    sections.push(goalEvent.text);
  } else if (currentGoal) {
    sections.push(`Goal: ${currentGoal}`);
  }

  const failures = events
    .filter((event) => event.type === "action_failure" || eventHasTag(event, "failure"))
    .slice(-2)
    .map((event) => event.text);

  if (failures.length > 0) {
    sections.push(`Failures: ${failures.join("; ")}`);
  }

  const successes = events
    .filter((event) => event.type === "action_success")
    .slice(-2)
    .map((event) => event.text);

  if (successes.length > 0) {
    sections.push(`Successes: ${successes.join("; ")}`);
  }

  const results = events
    .filter((event) => event.type !== "action_success" && eventHasTag(event, "result"))
    .slice(-2)
    .map((event) => event.text);

  if (results.length > 0) {
    sections.push(`Results: ${results.join("; ")}`);
  }

  const observations = events
    .filter(
      (event) =>
        event.type === "observation" &&
        (eventHasTag(event, "threat") || eventHasTag(event, "hazard")),
    )
    .slice(-2)
    .map((event) => event.text);

  if (observations.length > 0) {
    sections.push(`Observations: ${observations.join("; ")}`);
  }

  const dialogue = events
    .filter((event) => event.type === "dialogue_received")
    .slice(-2)
    .map((event) => event.text);

  if (dialogue.length > 0) {
    sections.push(`Dialogue: ${dialogue.join("; ")}`);
  }

  if (sections.length > 0) {
    return sections.join(" | ");
  }

  return events
    .slice(-3)
    .map((event) => event.text)
    .join(" | ");
}

function buildThreatMemoryItem(
  nowMs: number,
  safetyStatus: SafetyStatus,
): WorkingMemoryItem | null {
  if (safetyStatus.inLava) {
    return {
      expiresAt: toTimestamp(nowMs + THREAT_EXPIRY_MS),
      priority: 10,
      tags: ["hazard", "lava"],
      text: "Hazard nearby: in lava",
      timestamp: toTimestamp(nowMs),
    };
  }

  if (safetyStatus.onFire) {
    return {
      expiresAt: toTimestamp(nowMs + THREAT_EXPIRY_MS),
      priority: 10,
      tags: ["hazard", "fire"],
      text: "Hazard nearby: on fire",
      timestamp: toTimestamp(nowMs),
    };
  }

  if (safetyStatus.drowning) {
    return {
      expiresAt: toTimestamp(nowMs + THREAT_EXPIRY_MS),
      priority: 10,
      tags: ["hazard", "drowning"],
      text: "Hazard nearby: drowning",
      timestamp: toTimestamp(nowMs),
    };
  }

  const threat = safetyStatus.nearestThreat;
  const threatLabel = threat?.username ?? threat?.name ?? threat?.displayName ?? threat?.type;

  if (!threatLabel) {
    return null;
  }

  return {
    expiresAt: toTimestamp(nowMs + THREAT_EXPIRY_MS),
    priority: 9,
    tags: ["threat"],
    text: `Nearby threat: ${threatLabel}`,
    timestamp: toTimestamp(nowMs),
  };
}

function buildWorkingMemory(
  nowMs: number,
  currentGoal: string | null,
  events: ShortTermEvent[],
  summaries: ShortTermSummary[],
  safetyStatus: SafetyStatus,
): WorkingMemoryItem[] {
  const candidates: WorkingMemoryItem[] = [];

  if (currentGoal) {
    candidates.push({
      priority: 10,
      tags: ["goal"],
      text: currentGoal,
      timestamp: toTimestamp(nowMs),
    });
  }

  const latestOutcomes = new Map<string, ShortTermEvent>();

  for (const event of events) {
    const action = actionNameFromEvent(event);

    if (action && (event.type === "action_success" || event.type === "action_failure")) {
      latestOutcomes.set(action, event);
    }
  }

  const recentFailures = Array.from(latestOutcomes.values())
    .filter((event) => event.type === "action_failure")
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, RECENT_FAILURE_LIMIT);

  for (const event of recentFailures) {
    candidates.push({
      priority: event.priority ?? 9,
      tags: unique(["failure", ...event.tags]),
      text: event.text,
      timestamp: event.timestamp,
    });
  }

  const recentSuccesses = events
    .filter((event) => event.type === "action_success")
    .slice(-RECENT_SUCCESS_LIMIT)
    .reverse();

  for (const event of recentSuccesses) {
    const eventTimestampMs = Date.parse(event.timestamp);

    candidates.push({
      expiresAt: toTimestamp(eventTimestampMs + ACTION_RESULT_EXPIRY_MS),
      priority: event.priority ?? 6,
      tags: unique(["result", ...event.tags]),
      text: event.text,
      timestamp: event.timestamp,
    });
  }

  const recentResults = events
    .filter((event) => event.type !== "action_success" && eventHasTag(event, "result"))
    .slice(-RECENT_SUCCESS_LIMIT)
    .reverse();

  for (const event of recentResults) {
    const eventTimestampMs = Date.parse(event.timestamp);

    candidates.push({
      expiresAt: toTimestamp(eventTimestampMs + ACTION_RESULT_EXPIRY_MS),
      priority: event.priority ?? 6,
      tags: unique(["result", ...event.tags]),
      text: event.text,
      timestamp: event.timestamp,
    });
  }

  const recentDialogue = events
    .filter((event) => event.type === "dialogue_received" || event.type === "dialogue_sent")
    .slice(-RECENT_DIALOGUE_LIMIT)
    .reverse();

  for (const event of recentDialogue) {
    candidates.push({
      priority: event.priority ?? 4,
      tags: unique(["dialogue", ...event.tags]),
      text: event.text,
      timestamp: event.timestamp,
    });
  }

  const threatItem = buildThreatMemoryItem(nowMs, safetyStatus);

  if (threatItem) {
    candidates.push(threatItem);
  }

  for (const summary of summaries.slice(-RECENT_SUMMARY_LIMIT).reverse()) {
    const summaryTimestampMs = Date.parse(summary.timestamp);

    candidates.push({
      expiresAt: toTimestamp(summaryTimestampMs + REMINDER_EXPIRY_MS),
      priority: 5,
      tags: unique(["reminder", "summary", ...summary.tags]),
      text: `Reminder: ${summary.text}`,
      timestamp: summary.timestamp,
    });
  }

  const deduped = new Map<string, WorkingMemoryItem>();

  for (const candidate of candidates) {
    if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= nowMs) {
      continue;
    }

    const key = `${candidate.text.toLowerCase()}|${candidate.tags.slice().sort().join(",")}`;
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }

    const existingScore = existing.priority * 1000 + Date.parse(existing.timestamp);
    const candidateScore = candidate.priority * 1000 + Date.parse(candidate.timestamp);

    if (candidateScore >= existingScore) {
      deduped.set(key, candidate);
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }

      return right.timestamp.localeCompare(left.timestamp);
    })
    .slice(0, WORKING_MEMORY_LIMIT);
}

export function createMemoryModule(
  bot: MinecraftBot,
  context: {
    events: EventSource;
    safety: SafetyModule;
  },
  options: MemoryModuleOptions = {},
): MemoryModule {
  const now = options.now ?? Date.now;
  const autoSummarize = options.autoSummarize ?? true;
  const summarizationIntervalMs =
    options.summarizationIntervalMs ?? DEFAULT_SUMMARIZATION_INTERVAL_MS;
  const { events, safety } = context;
  let currentGoal: string | null = null;
  let shortTermEvents: ShortTermEvent[] = [];
  let shortTermSummaries: ShortTermSummary[] = [];
  let workingMemory: WorkingMemoryItem[] = [];
  let sequence = 0;
  let lastSummarizedEventId = 0;
  let summaryTimer: NodeJS.Timeout | null = null;

  function refreshWorkingMemory(): void {
    workingMemory = buildWorkingMemory(
      now(),
      currentGoal,
      shortTermEvents,
      shortTermSummaries,
      safety.status(16),
    );
  }

  function recordEvent(input: NormalizedEventInput): ShortTermEvent {
    const event: ShortTermEvent = {
      id: ++sequence,
      payload: input.payload,
      priority: input.priority,
      sourceEventId: input.sourceEventId ?? null,
      sourceType: input.sourceType ?? null,
      tags: input.tags,
      text: input.text,
      timestamp: input.timestamp,
      type: input.type,
    };

    shortTermEvents.push(event);

    if (shortTermEvents.length > SHORT_TERM_EVENT_LIMIT) {
      shortTermEvents = shortTermEvents.slice(-SHORT_TERM_EVENT_LIMIT);
    }

    refreshWorkingMemory();
    return event;
  }

  function summarizeNow(): ShortTermSummary | null {
    const pending = shortTermEvents.filter((event) => event.id > lastSummarizedEventId);

    if (pending.length === 0) {
      return null;
    }

    const summary: ShortTermSummary = {
      endEventId: pending[pending.length - 1]?.id ?? null,
      startEventId: pending[0]?.id ?? null,
      tags: unique(pending.flatMap((event) => event.tags)).slice(0, 12),
      text: buildSummaryText(pending, currentGoal),
      timestamp: toTimestamp(now()),
    };

    shortTermSummaries.push(summary);

    if (shortTermSummaries.length > SHORT_TERM_SUMMARY_LIMIT) {
      shortTermSummaries = shortTermSummaries.slice(-SHORT_TERM_SUMMARY_LIMIT);
    }

    lastSummarizedEventId = summary.endEventId ?? lastSummarizedEventId;
    refreshWorkingMemory();
    return { ...summary, tags: [...summary.tags] };
  }

  function state(): MemoryState {
    refreshWorkingMemory();

    return {
      longTerm: [],
      shortTerm: {
        events: shortTermEvents.map((event) => ({
          ...event,
          tags: [...event.tags],
        })),
        summaries: shortTermSummaries.map((summary) => ({
          ...summary,
          tags: [...summary.tags],
        })),
      },
      working: workingMemory.map((item) => ({
        ...item,
        tags: [...item.tags],
      })),
    };
  }

  function setGoal(text: string | null): { goal: string | null } {
    const nextGoal = trimText(text);

    if (nextGoal === currentGoal) {
      return { goal: currentGoal };
    }

    currentGoal = nextGoal;
    events.push("goal:update", { goal: currentGoal });
    refreshWorkingMemory();

    return { goal: currentGoal };
  }

  events.on("event", (event) => {
    if (shouldSkipStreamEventMemoryNormalize(event.type)) {
      return;
    }

    for (const normalizedEvent of normalizeStreamEvent(bot, event)) {
      recordEvent(normalizedEvent);
    }
  });

  if (autoSummarize && summarizationIntervalMs > 0) {
    summaryTimer = setInterval(() => {
      summarizeNow();
    }, summarizationIntervalMs);
  }

  bot.on("end", () => {
    if (summaryTimer) {
      clearInterval(summaryTimer);
      summaryTimer = null;
    }
  });

  return {
    currentGoal() {
      return currentGoal;
    },
    setGoal,
    state,
    summarizeNow,
  };
}

export const memoryInternals = {
  buildSummaryText,
  buildWorkingMemory,
  normalizeStreamEvent,
};
