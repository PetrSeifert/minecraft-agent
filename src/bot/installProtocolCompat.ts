import { Vec3 } from "vec3";

import type { MinecraftBot } from "../types";

function hasNumericVelocity(packet: unknown): packet is {
  entityId: number;
  velocity: {
    x: number;
    y: number;
    z: number;
  };
} {
  if (!packet || typeof packet !== "object") {
    return false;
  }

  const candidate = packet as {
    velocity?: { x?: number; y?: number; z?: number };
  };

  return (
    Boolean(candidate.velocity) &&
    Number.isFinite(candidate.velocity?.x) &&
    Number.isFinite(candidate.velocity?.y) &&
    Number.isFinite(candidate.velocity?.z)
  );
}

export function installProtocolCompat(bot: MinecraftBot): void {
  bot._client.on("entity_velocity", (packet) => {
    if ((bot as any).supportFeature("entityVelocityIsLpVec3")) {
      return;
    }

    if (!hasNumericVelocity(packet)) {
      return;
    }

    const entity = bot.entities?.[packet.entityId];

    if (!entity?.velocity?.update) {
      return;
    }

    entity.velocity.update(new Vec3(packet.velocity.x, packet.velocity.y, packet.velocity.z));
  });
}
