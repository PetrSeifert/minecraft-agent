const mineflayer = require('mineflayer');
const readline = require('node:readline');
const { createAgent } = require('../agent');
const { installPhysicsCompat } = require('./installPhysicsCompat');
const { installProtocolCompat } = require('./installProtocolCompat');
const { createTerminal } = require('./terminal');

function formatError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors
      .map((nestedError) => nestedError.message || String(nestedError))
      .join(' | ');
  }

  return error.message || String(error);
}

function createBot(config) {
  const bot = mineflayer.createBot({
    ...config,
    hideErrors: true,
    physicsEnabled: false,
  });

  function ensurePhysicsCompat() {
    installPhysicsCompat(bot);
  }

  ensurePhysicsCompat();
  bot.on('login', () => {
    setImmediate(ensurePhysicsCompat);
  });
  bot.on('spawn', () => {
    setImmediate(ensurePhysicsCompat);
  });

  installProtocolCompat(bot);
  const agent = createAgent(bot, config);
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let hasLoggedIn = false;
  let lastErrorText = null;

  bot.once('login', () => {
    hasLoggedIn = true;
    console.log(`[bot] Logged in as ${bot.username}`);
  });

  bot.once('spawn', () => {
    const { x, y, z } = bot.entity.position;
    console.log(
      `[bot] Spawned at x=${x.toFixed(1)} y=${y.toFixed(1)} z=${z.toFixed(1)}`,
    );
    if (config.debugKnockback) {
      console.log(`[debug] Knockback logging enabled: ${config.debugKnockbackFile}`);
    }
    console.log('[bot] Type chat into this terminal, or use /help for agent commands');
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) {
      return;
    }

    console.log(`[chat] <${username}> ${message}`);
  });

  bot.on('messagestr', (message) => {
    console.log(`[server] ${message}`);
  });

  bot.on('kicked', (reason) => {
    console.error('[bot] Kicked from server:', reason);
  });

  bot.on('error', (error) => {
    const errorText = formatError(error);

    if (errorText === lastErrorText) {
      return;
    }

    lastErrorText = errorText;
    console.error('[bot] Error:', errorText);
  });

  bot.on('end', () => {
    if (!hasLoggedIn) {
      process.exitCode = 1;
    }

    console.log('[bot] Connection closed');
    terminal.close();
  });

  createTerminal(bot, agent, terminal);

  return bot;
}

module.exports = {
  createBot,
};
