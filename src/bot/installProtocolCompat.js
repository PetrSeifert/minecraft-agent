const { Vec3 } = require('vec3');

function hasNumericVelocity(packet) {
  return (
    packet?.velocity &&
    Number.isFinite(packet.velocity.x) &&
    Number.isFinite(packet.velocity.y) &&
    Number.isFinite(packet.velocity.z)
  );
}

function installProtocolCompat(bot) {
  bot._client.on('entity_velocity', (packet) => {
    if (bot.supportFeature('entityVelocityIsLpVec3')) {
      return;
    }

    if (!hasNumericVelocity(packet)) {
      return;
    }

    const entity = bot.entities?.[packet.entityId];

    if (!entity?.velocity?.update) {
      return;
    }

    entity.velocity.update(
      new Vec3(packet.velocity.x, packet.velocity.y, packet.velocity.z),
    );
  });
}

module.exports = {
  installProtocolCompat,
};
