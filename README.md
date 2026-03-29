# minecraft-agent

Minimal Mineflayer starter for a modular Minecraft agent.

The project now uses TypeScript for source, tests, and typechecking while still running directly in Node via `tsx`.

## Setup

1. Copy `.env.example` to `.env`.
2. Update the connection values for your server.
3. Start the bot:

```bash
npm start
```

To run the compiler checks:

```bash
npm run typecheck
```

## Environment

- `MC_HOST`: Minecraft server host.
- `MC_PORT`: Minecraft server port.
- `MC_USERNAME`: Bot username or Microsoft account email.
- `MC_PASSWORD`: Optional. Required for `MC_AUTH=microsoft`.
- `MC_AUTH`: `offline` for local/cracked servers, `microsoft` for Microsoft account login.
- `MC_VERSION`: Optional. Leave empty to auto-detect the server version.

## Current behavior

- Connects to the configured server.
- Logs key lifecycle events.
- Exposes modular agent primitives on `bot.agent.*`.
- Exposes an orchestration snapshot for LLM consumption via `bot.agent.orchestration.snapshot()`.
- Lets you send chat messages from the terminal.
- Supports movement, inventory, world queries, block/container actions, combat/safety checks, chat, and an internal event stream.

This gives us a working base to split into movement, perception, inventory, and task modules next.

## Agent modules

- `bot.agent.pathing`: movement goals and pathfinder status.
- `bot.agent.inventory`: inspect inventory, count/equip/toss items.
- `bot.agent.world`: block and entity queries.
- `bot.agent.actions`: crafting, mining, placing, and opening containers.
- `bot.agent.combat`: basic hostile targeting and attacks.
- `bot.agent.safety`: health/threat status plus automatic emergency escape for aggro, drowning, and fire/lava.
- `bot.agent.chat`: send chat and read recent chat history.
- `bot.agent.events`: buffered event stream for Minecraft state changes.
- `bot.agent.orchestration`: builds a compact `AgentState` snapshot for higher-level planners/LLMs.

## Orchestration snapshot

Use `bot.agent.orchestration.snapshot()` to build the current LLM-facing state contract on demand. The first version fills `self` and `perception` from live bot state and keeps `memory` / `planning` present as empty placeholders so the shape stays stable as orchestration grows.

## Terminal commands

Type normal text to send chat. Use slash commands for primitives:

- `/help`
- `/pos`
- `/inventory`
- `/entities [distance]`
- `/findblock <block_name> [distance]`
- `/block <x> <y> <z>`
- `/goto <x> <y> <z> [range]`
- `/follow <playerName> [range]`
- `/stop`
- `/mine <x> <y> <z>`
- `/craft <item_name> [count]`
- `/place <item_name> <x> <y> <z>`
- `/open <x> <y> <z>`
- `/attack nearest-hostile [distance]`
- `/health`
- `/safety [status|on|off|now]`
- `/retreat [distance]`
- `/events [count]`
- `/quit`

## Testing on mc.peterrock.dev

The local `.env` is configured to target `mc.peterrock.dev:25565`.

The server now accepts offline usernames, so the local `.env` is set to:

- `MC_AUTH=offline`
- `MC_USERNAME=MineflayerBot`

If the server keeps rejecting the bot, whitelist `MineflayerBot` or change `MC_USERNAME` to a username that is already allowed.

Then run:

```bash
npm start
```
