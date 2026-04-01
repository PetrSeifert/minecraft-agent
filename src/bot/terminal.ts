import type { Interface } from 'node:readline';

import { summarizePayload } from '../agent/utils';

import type { Agent, MinecraftBot } from '../types';

function parseNumber(rawValue: string, label: string): number {
  const value = Number(rawValue);

  if (Number.isNaN(value)) {
    throw new Error(`Expected ${label} to be a number, got "${rawValue}"`);
  }

  return value;
}

function formatResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function helpText(): string {
  return [
    'Available commands:',
    '/help',
    '/goal',
    '/state',
    '/pos',
    '/inventory',
    '/entities [distance]',
    '/inspect [distance]',
    '/findblock <block_name> [distance]',
    '/block <x> <y> <z>',
    '/goto <x> <y> <z> [range]',
    '/follow <playerName> [range]',
    '/stop',
    '/mine <x> <y> <z>',
    '/craft <item_name> [count]',
    '/place <item_name> <x> <y> <z>',
    '/open <x> <y> <z>',
    '/attack nearest-hostile [distance]',
    '/health',
    '/safety [status|on|off|now]',
    '/retreat [distance]',
    '/events [count]',
    '/replan',
    '/planner [status|on|off|now]',
    '/quit',
  ].join('\n');
}

async function runCommand(
  bot: MinecraftBot,
  agent: Agent,
  input: string,
): Promise<string | null> {
  const [command, ...args] = input.slice(1).trim().split(/\s+/);

  switch (command) {
    case 'help':
      return helpText();
    case 'goal':
      return formatResult({
        goal: agent.memory.currentGoal(),
      });
    case 'state':
      return formatResult(agent.orchestration.snapshot());
    case 'pos':
      return formatResult(agent.world.position());
    case 'inventory':
      return formatResult(agent.inventory.summary());
    case 'entities': {
      const maxDistance = args[0] ? parseNumber(args[0], 'distance') : 16;
      return formatResult(agent.world.nearbyEntities({ maxDistance }));
    }
    case 'inspect': {
      const maxDistance = args[0] ? parseNumber(args[0], 'distance') : undefined;
      return formatResult(agent.world.inspectVisibleArea({
        maxDistance,
      }));
    }
    case 'findblock': {
      if (!args[0]) {
        throw new Error('Usage: /findblock <block_name> [distance]');
      }

      const maxDistance = args[1] ? parseNumber(args[1], 'distance') : 32;
      return formatResult(
        agent.world.findBlockByName(args[0], { maxDistance }),
      );
    }
    case 'block': {
      if (args.length < 3) {
        throw new Error('Usage: /block <x> <y> <z>');
      }

      return formatResult(
        agent.world.getBlockDetailsAt({
          x: parseNumber(args[0], 'x'),
          y: parseNumber(args[1], 'y'),
          z: parseNumber(args[2], 'z'),
        }),
      );
    }
    case 'goto': {
      if (args.length < 3) {
        throw new Error('Usage: /goto <x> <y> <z> [range]');
      }

      return formatResult(
        await agent.pathing.goto(
          {
            x: parseNumber(args[0], 'x'),
            y: parseNumber(args[1], 'y'),
            z: parseNumber(args[2], 'z'),
          },
          args[3] ? parseNumber(args[3], 'range') : 0,
        ),
      );
    }
    case 'follow': {
      if (!args[0]) {
        throw new Error('Usage: /follow <playerName> [range]');
      }

      const target = agent.world.entityByUsername(args[0]);

      if (!target) {
        throw new Error(`Player not found or not visible: ${args[0]}`);
      }

      return formatResult(
        agent.pathing.followEntity(
          target,
          args[1] ? parseNumber(args[1], 'range') : 2,
        ),
      );
    }
    case 'stop':
      agent.pathing.stop();
      return 'Pathing stopped';
    case 'mine': {
      if (args.length < 3) {
        throw new Error('Usage: /mine <x> <y> <z>');
      }

      return formatResult(
        await agent.actions.mineBlockAt({
          x: parseNumber(args[0], 'x'),
          y: parseNumber(args[1], 'y'),
          z: parseNumber(args[2], 'z'),
        }),
      );
    }
    case 'craft': {
      if (!args[0]) {
        throw new Error('Usage: /craft <item_name> [count]');
      }

      return formatResult(
        await agent.actions.craftItem(
          args[0],
          args[1] ? parseNumber(args[1], 'count') : 1,
        ),
      );
    }
    case 'place': {
      if (args.length < 4) {
        throw new Error('Usage: /place <item_name> <x> <y> <z>');
      }

      return formatResult(
        await agent.actions.placeBlockAt(args[0], {
          x: parseNumber(args[1], 'x'),
          y: parseNumber(args[2], 'y'),
          z: parseNumber(args[3], 'z'),
        }),
      );
    }
    case 'open': {
      if (args.length < 3) {
        throw new Error('Usage: /open <x> <y> <z>');
      }

      const result = await agent.actions.openContainerAt({
        x: parseNumber(args[0], 'x'),
        y: parseNumber(args[1], 'y'),
        z: parseNumber(args[2], 'z'),
      });

      result.container.close();

      return formatResult({
        block: result.block,
        items: result.items,
        window: result.window,
      });
    }
    case 'attack': {
      const targetName = args[0] ?? 'nearest-hostile';
      const maxDistance = args[1] ? parseNumber(args[1], 'distance') : 16;

      if (targetName !== 'nearest-hostile') {
        throw new Error('Only /attack nearest-hostile [distance] is supported right now');
      }

      return formatResult(await agent.combat.attackNearestHostile(maxDistance));
    }
    case 'health':
      return formatResult(agent.safety.status());
    case 'safety': {
      const mode = args[0] ?? 'status';

      if (mode === 'on') {
        return formatResult(agent.safety.enable());
      }

      if (mode === 'off') {
        return formatResult(agent.safety.disable());
      }

      if (mode === 'now') {
        return formatResult(await agent.safety.escapeDanger('manual_command'));
      }

      if (mode === 'status') {
        return formatResult(agent.safety.status());
      }

      throw new Error('Usage: /safety [status|on|off|now]');
    }
    case 'retreat': {
      const minDistance = args[0] ? parseNumber(args[0], 'distance') : 12;
      return formatResult(
        await agent.safety.retreatFromNearestHostile(minDistance),
      );
    }
    case 'events': {
      const count = args[0] ? parseNumber(args[0], 'count') : 10;
      const lines = agent.events.recent(count).map((event) => {
        const summary = summarizePayload(event.payload);
        return summary
          ? `[${event.id}] ${event.type}: ${summary}`
          : `[${event.id}] ${event.type}`;
      });

      return lines.join('\n');
    }
    case 'replan':
      return formatResult(await agent.planner.replanNow('manual_terminal'));
    case 'planner': {
      const mode = args[0] ?? 'status';

      if (mode === 'on') {
        return formatResult(agent.planner.enable());
      }

      if (mode === 'off') {
        return formatResult(agent.planner.disable());
      }

      if (mode === 'now') {
        return formatResult(await agent.planner.replanNow('planner_now_terminal'));
      }

      if (mode === 'status') {
        return formatResult(agent.planner.status());
      }

      throw new Error('Usage: /planner [status|on|off|now]');
    }
    case 'quit':
      bot.quit('User requested shutdown');
      return null;
    default:
      throw new Error(`Unknown command: /${command}`);
  }
}

export function createTerminal(
  bot: MinecraftBot,
  agent: Agent,
  terminal: Interface,
): void {
  terminal.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      return;
    }

    try {
      if (input.startsWith('/')) {
        const output = await runCommand(bot, agent, input);

        if (output) {
          console.log(output);
        }

        return;
      }

      agent.chat.say(input);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[terminal] Error:', message);
    }
  });
}

export const terminalInternals = {
  formatResult,
  helpText,
  parseNumber,
  runCommand,
};
