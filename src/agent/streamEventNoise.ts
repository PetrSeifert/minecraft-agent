/**
 * Stream events are still pushed to `EventStream` (full buffer / `/events`), but omitted
 * from agent-facing surfaces where they add noise (perception recent-events, memory pass).
 */

const PERCEPTION_NOISE_EXACT = new Set([
  "world:block_update",
  "executor:request",
  "executor:success",
  "executor:skip",
  "executor:state",
  "pathing:goal_updated",
  "pathing:movements_ready",
  "pathing:plugin_loaded",
  "pathing:goal_reached",
]);

const PERCEPTION_NOISE_PREFIXES = ["pathing:path_", "planner:"];

export function shouldOmitStreamEventFromPerception(type: string): boolean {
  if (PERCEPTION_NOISE_EXACT.has(type)) {
    return true;
  }

  return PERCEPTION_NOISE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * Short-circuit before {@link normalizeStreamEvent}: same as perception noise except
 * `executor:success`, which may become an observation when the outcome is `observe`.
 */
export function shouldSkipStreamEventMemoryNormalize(type: string): boolean {
  if (type === "executor:success") {
    return false;
  }

  return shouldOmitStreamEventFromPerception(type);
}
