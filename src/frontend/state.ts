import type {
  Agent,
  BotConfig,
  ChatHistoryEntry,
  InventorySummary,
  MemoryState,
  MinecraftBot,
  OrchestrationSnapshot,
  PathingStatus,
  PlannerStatus,
  SafetyStatus,
  StreamEvent,
} from '../types';

const EMPTY_VISIBLE_AREA = {
  focus: {
    blockAtCursor: null,
    entityAtCursor: null,
  },
  hazards: [],
  heading: {
    cardinal: 'unknown',
    pitch: 0,
    yaw: 0,
  },
  highlights: [],
  visibleBlocks: [],
  visibleEntities: [],
} as const;

export interface FrontendSession {
  auth: string;
  host: string;
  lastError: string | null;
  port: number;
  status: 'connecting' | 'ended' | 'kicked' | 'logged_in' | 'spawned';
  username: string;
}

export interface FrontendState {
  chatHistory: ChatHistoryEntry[];
  inventory: InventorySummary;
  orchestration: OrchestrationSnapshot;
  pathing: PathingStatus;
  planner: PlannerStatus | null;
  recentEvents: StreamEvent[];
  safety: SafetyStatus;
  session: FrontendSession;
  timestamp: string;
}

function formatChatEntry(entry: ChatHistoryEntry): string {
  if (entry.channel === 'public' && entry.username) {
    return `<${entry.username}> ${entry.text}`;
  }

  if (entry.channel === 'server') {
    return entry.text;
  }

  if (entry.username) {
    return `[${entry.channel}] <${entry.username}> ${entry.text}`;
  }

  return `[${entry.channel}] ${entry.text}`;
}

function createPendingOrchestrationSnapshot(agent: Agent): OrchestrationSnapshot {
  const memory = agent.memory.state();
  const planner = agent.planner.status();

  return {
    memory,
    perception: {
      containers: [],
      hostiles: [],
      nearbyBlocks: [],
      nearbyEntities: [],
      recentChat: agent.chat.history(10).map(formatChatEntry),
      recentEvents: agent.events.recent(10).map((event) => event.type),
      shelters: [],
      visibleArea: {
        ...EMPTY_VISIBLE_AREA,
        hazards: [...EMPTY_VISIBLE_AREA.hazards],
        highlights: [...EMPTY_VISIBLE_AREA.highlights],
        visibleBlocks: [...EMPTY_VISIBLE_AREA.visibleBlocks],
        visibleEntities: [...EMPTY_VISIBLE_AREA.visibleEntities],
      },
    },
    planning: {
      currentGoal: agent.memory.currentGoal(),
      currentSkill: undefined,
      planner,
      plan: [],
      recentFailures: memory.working.filter((item) => item.tags.includes('failure')),
    },
    self: {
      biome: 'unknown',
      equipped: [],
      health: 0,
      hunger: 0,
      inventory: {},
      position: null,
      risk: 'low',
      timeOfDay: 'day',
    },
  };
}

export function createStateAdapter(
  bot: MinecraftBot,
  agent: Agent,
  config: Partial<BotConfig>,
): {
  snapshot: () => FrontendState;
  updateSession: (patch: Partial<FrontendSession>) => void;
} {
  const session: FrontendSession = {
    auth: config.auth ?? 'offline',
    host: config.host ?? 'localhost',
    lastError: null,
    port: config.port ?? 25565,
    status: 'connecting',
    username: config.username ?? 'Bot',
  };

  bot.once('login', () => {
    session.status = 'logged_in';
    session.username = bot.username ?? session.username;
  });

  bot.once('spawn', () => {
    session.status = 'spawned';
  });

  bot.on('kicked', (reason) => {
    session.status = 'kicked';
    session.lastError = typeof reason === 'string' ? reason : String(reason);
  });

  bot.on('error', (error) => {
    session.lastError = error instanceof Error ? error.message : String(error);
  });

  bot.on('end', () => {
    session.status = 'ended';
  });

  function snapshot(): FrontendState {
    const orchestration = bot.entity?.position
      ? agent.orchestration.snapshot()
      : createPendingOrchestrationSnapshot(agent);

    return {
      chatHistory: agent.chat.history(50),
      inventory: agent.inventory.summary(),
      orchestration,
      pathing: agent.pathing.status(),
      planner: agent.planner.status(),
      recentEvents: agent.events.recent(100),
      safety: agent.safety.status(),
      session: { ...session },
      timestamp: new Date().toISOString(),
    };
  }

  function updateSession(patch: Partial<FrontendSession>): void {
    Object.assign(session, patch);
  }

  return { snapshot, updateSession };
}
