import type { ChatHistoryEntry, ChatModule, EventStreamLike, MinecraftBot } from "../../types";

export function createChatModule(bot: MinecraftBot, events: EventStreamLike): ChatModule {
  const history: ChatHistoryEntry[] = [];
  const maxHistory = 100;

  function pushHistory(channel: string, username: string | null, text: string): void {
    history.push({
      timestamp: new Date().toISOString(),
      channel,
      username,
      text,
    });

    if (history.length > maxHistory) {
      history.shift();
    }
  }

  bot.on("chat", (username, message) => {
    pushHistory("public", username, message);
    events.push("chat:public", { username, text: message });
  });

  bot.on("messagestr", (message) => {
    pushHistory("server", null, message);
    events.push("chat:server", { message });
  });

  return {
    say(message: string) {
      bot.chat(message);
      events.push("chat:send", { text: message });
      return { text: message };
    },

    whisper(username: string, message: string) {
      bot.whisper(username, message);
      events.push("chat:whisper", { username, text: message });
      return { username, text: message };
    },

    history(limit = 20) {
      return history.slice(-limit);
    },
  };
}
