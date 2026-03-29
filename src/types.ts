import type { Bot } from 'mineflayer';
import type { Pathfinder } from 'mineflayer-pathfinder';
import type { Vec3 } from 'vec3';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface BotConfig {
  auth: 'microsoft' | 'mojang' | 'offline';
  debugKnockback: boolean;
  debugKnockbackFile: string;
  host: string;
  password?: string;
  port: number;
  username: string;
  version: string | false;
}

export interface SerializedVec3 {
  x: number;
  y: number;
  z: number;
}

export interface SerializedItem {
  count?: number | null;
  displayName?: string | null;
  metadata?: number | null;
  name?: string | null;
  slot?: number | null;
  type?: number | null;
}

export interface SerializedBlock {
  biome: string | null;
  boundingBox: string | null;
  diggable: boolean;
  displayName?: string | null;
  metadata?: number | null;
  name: string;
  position: SerializedVec3 | null;
  type?: number | null;
}

export interface SerializedEntity {
  displayName: string | null;
  height: number | null;
  id: number | null;
  kind: string | null;
  name: string | null;
  position: SerializedVec3 | null;
  type: string | null;
  username: string | null;
  velocity: SerializedVec3 | null;
}

export interface NearbyEntitySummary extends SerializedEntity {
  distance: number;
}

export interface SerializedWindow {
  id: number | null;
  slotCount: number | null;
  title: unknown;
  type: string | null;
}

export interface ItemLike {
  count: number;
  displayName?: string;
  metadata?: number;
  name: string;
  slot?: number;
  type: number;
}

export interface BlockLike {
  biome?: {
    name?: string;
  } | null;
  boundingBox?: string | null;
  diggable?: boolean;
  displayName?: string;
  metadata?: number;
  name: string;
  position?: Vec3;
  type?: number;
}

export interface EntityLike {
  displayName?: string | null;
  distance?: number;
  height?: number | null;
  id?: number | null;
  isInWater?: boolean;
  kind?: string | null;
  metadata?: unknown[];
  name?: string | null;
  onGround?: boolean;
  position?: Vec3 | Vec3Like | null;
  type?: string | null;
  username?: string | null;
  velocity?: Vec3 | Vec3Like | null;
}

export interface WindowLike {
  close?: () => void;
  containerItems?: () => Array<ItemLike | null>;
  id?: number;
  slots?: unknown[];
  title?: unknown;
  type?: string;
}

export interface ChatHistoryEntry {
  channel: string;
  text: string;
  timestamp: string;
  username: string | null;
}

export interface StreamEvent {
  id: number;
  payload: unknown;
  timestamp: string;
  type: string;
}

export interface WorldQueryOptions {
  count?: number;
  limit?: number;
  matcher?: (entity: EntityLike | NearbyEntitySummary) => boolean;
  maxDistance?: number;
  name?: string;
  point?: Vec3Like;
  type?: string;
  username?: string;
}

export interface ChatModule {
  history(limit?: number): ChatHistoryEntry[];
  say(message: string): { text: string };
  whisper(username: string, message: string): { text: string; username: string };
}

export interface PathingStatus {
  building: boolean;
  follow?: {
    entityId?: number | null;
    range: number;
  } | null;
  goal: string | null;
  hasGoal: boolean;
  mining: boolean;
  movement?: {
    allow1by1towers?: boolean;
    allowParkour?: boolean;
    allowSprinting?: boolean;
    canDig?: boolean;
    maxDropDown?: number;
  };
  moving: boolean;
  pausedMs: number;
  physicsEnabled: boolean;
  physicsHoldMs: number;
  ready: boolean;
  searchRadius?: number;
  thinkTimeout?: number;
  tickTimeout?: number;
}

export interface PathingOptions {
  ignorePause?: boolean;
  LOS?: boolean;
  range?: number;
}

export interface PathingModule {
  readonly movements: unknown;
  configure(options?: Record<string, unknown>): Record<string, unknown>;
  followEntity(entity: EntityLike, range?: number): { entity: SerializedEntity | null; range: number };
  goto(position: Vec3Like | Vec3, range?: number, options?: PathingOptions): Promise<{ position: SerializedVec3 | null; range: number }>;
  gotoBlock(block: BlockLike, range?: number, options?: PathingOptions): Promise<{ block: string; position: SerializedVec3 | null; range: number }>;
  gotoLookAt(position: Vec3Like | Vec3, reach?: number, options?: PathingOptions): Promise<{ position: SerializedVec3 | null; reach: number }>;
  gotoPlace(position: Vec3Like | Vec3, options?: PathingOptions): Promise<{ position: SerializedVec3 | null; range: number }>;
  moveAwayFrom(position: Vec3Like | Vec3, minDistance?: number, options?: PathingOptions): Promise<{ minDistance: number; threat: SerializedVec3 | null }>;
  pause(durationMs?: number, reason?: string): { durationMs: number; reason: string; until: string };
  stabilize(durationMs?: number, reason?: string): { durationMs: number; holdUntil: string; reason: string };
  status(): PathingStatus;
  stop(): void;
}

export interface InventorySummary {
  heldItem: SerializedItem | null;
  hotbarSlot: number;
  items: Array<SerializedItem | null>;
  slotsUsed: number;
}

export interface InventoryModule {
  count(name: string): number;
  equip(name: string, destination?: string): Promise<SerializedItem | null>;
  findItemByName(name: string): ItemLike | null;
  heldItem(): SerializedItem | null;
  hotbarSlot(): number;
  items(): Array<SerializedItem | null>;
  summary(): InventorySummary;
  toss(name: string, countValue?: number): Promise<{ count: number; name: string }>;
}

export interface WorldModule {
  blockAtCursor(maxDistance?: number): SerializedBlock | null;
  entityAtCursor(maxDistance?: number): SerializedEntity | null;
  entityByUsername(username: string): EntityLike | null;
  findBlockByName(name: string, options?: WorldQueryOptions): SerializedBlock | null;
  findBlocksByName(name: string, options?: WorldQueryOptions): Array<SerializedBlock | null>;
  getBlockAt(position: Vec3Like | Vec3): BlockLike | null;
  getBlockDetailsAt(position: Vec3Like | Vec3): SerializedBlock | null;
  nearbyEntities(options?: WorldQueryOptions): NearbyEntitySummary[];
  nearestEntity(options?: WorldQueryOptions): EntityLike | null;
  nearestEntityDetails(options?: WorldQueryOptions): SerializedEntity | null;
  nearestHostile(maxDistance?: number): EntityLike | null;
  position(): SerializedVec3 | null;
}

export interface ActionsModule {
  craftItem(name: string, count?: number, craftingTablePosition?: Vec3Like | Vec3 | null): Promise<{ count: number; craftingTable: SerializedBlock | null; item: string }>;
  mineBlockAt(position: Vec3Like | Vec3, options?: { forceLook?: boolean; reach?: number }): Promise<SerializedBlock | null>;
  openContainerAt(position: Vec3Like | Vec3): Promise<{ block: SerializedBlock | null; container: WindowLike & { close(): void }; items: Array<SerializedItem | null>; window: SerializedWindow | null }>;
  placeBlockAt(itemName: string, position: Vec3Like | Vec3): Promise<SerializedBlock | null>;
}

export interface CombatModule {
  attackEntity(entity: EntityLike, options?: { approachRange?: number; swing?: boolean }): Promise<SerializedEntity | null>;
  attackNearestHostile(maxDistance?: number, options?: { approachRange?: number; swing?: boolean }): Promise<SerializedEntity | null>;
  hostiles(maxDistance?: number): NearbyEntitySummary[];
}

export interface SafetyEscapeResult {
  action?: string;
  busy?: boolean;
  lastEscape?: SafetyEscapeResult | null;
  reason?: string;
  target?: SerializedVec3 | null;
  threat?: SerializedEntity | null;
  timestamp?: string;
}

export interface SafetyStatus {
  blocks: {
    feet: string | null;
    ground: string | null;
    head: string | null;
  };
  drowning: boolean;
  escapeInProgress?: boolean;
  health: number | null;
  hostiles: NearbyEntitySummary[];
  inLava: boolean;
  inWater: boolean;
  lastEscape?: SafetyEscapeResult | null;
  mobAggro: boolean;
  monitorEnabled: boolean;
  nearestThreat?: SerializedEntity | null;
  nearestThreatScore?: number;
  onFire: boolean;
  oxygenLevel: number | null;
  pathing: PathingStatus;
  position: SerializedVec3 | null;
  recentSelfHurt: boolean;
}

export interface SafetyModule {
  disable(): SafetyStatus;
  enable(): SafetyStatus;
  escapeDanger(reason?: string): Promise<SafetyEscapeResult>;
  retreatFromNearestHostile(minDistance?: number): Promise<{ hostile: SerializedEntity | null; minDistance: number }>;
  status(maxDistance?: number): SafetyStatus;
}

export interface OrchestrationSnapshot {
  memory: {
    longTerm: unknown[];
    shortTerm: unknown[];
    working: unknown[];
  };
  perception: {
    containers: string[];
    hostiles: string[];
    nearbyBlocks: string[];
    nearbyEntities: string[];
    recentChat: string[];
    recentEvents: string[];
    shelters: string[];
  };
  planning: {
    currentGoal: unknown;
    currentSkill: unknown;
    plan: unknown[];
    recentFailures: unknown[];
  };
  self: {
    biome: string;
    equipped: string[];
    health: number;
    hunger: number;
    inventory: Record<string, number>;
    position: SerializedVec3 | null;
    risk: 'high' | 'low' | 'medium';
    timeOfDay: 'day' | 'night';
  };
}

export interface OrchestrationModule {
  snapshot(): OrchestrationSnapshot;
}

export interface KnockbackDebugger {
  enabled: boolean;
  filePath?: string;
  sampleTicks?(reason: string, count?: number): void;
  write?(event: string, payload?: unknown): void;
}

export interface Agent {
  actions: ActionsModule;
  chat: ChatModule;
  combat: CombatModule;
  debug: {
    knockback: KnockbackDebugger;
  };
  events: EventStreamLike;
  inventory: InventoryModule;
  orchestration: OrchestrationModule;
  pathing: PathingModule;
  safety: SafetyModule;
  world: WorldModule;
}

export interface EventStreamLike {
  push(type: string, payload?: unknown): StreamEvent;
  recent(limit?: number, type?: string | null): StreamEvent[];
}

export interface PhysicsStateLike {
  attributes?: Record<string, { modifiers?: unknown[]; value: number }>;
  control?: Record<string, boolean>;
  depthStrider?: number;
  dolphinsGrace?: number;
  elytraEquipped?: boolean;
  elytraFlying?: boolean;
  fireworkRocketDuration?: number;
  isCollidedHorizontally?: boolean;
  isCollidedVertically?: boolean;
  isInLava?: boolean;
  isInWater?: boolean;
  isInWeb?: boolean;
  jumpBoost?: number;
  jumpQueued?: boolean;
  jumpTicks?: number;
  levitation?: number;
  onGround?: boolean;
  pitch?: number;
  pos?: Vec3;
  slowFalling?: number;
  slowness?: number;
  speed?: number;
  vel?: Vec3;
  yaw?: number;
}

export type MinecraftBot = Bot & {
  _client: {
    on(event: string, listener: (packet: any) => void): void;
  };
  agent?: Agent;
  controlState?: Record<string, boolean>;
  jumpQueued?: boolean;
  pathfinder?: Pathfinder;
  physics?: {
    __compatWrappedSimulatePlayer?: boolean;
    simulatePlayer?: (state: PhysicsStateLike, world: unknown) => PhysicsStateLike;
  };
};
