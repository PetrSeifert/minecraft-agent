function createChatModule(bot, events) {
  const history = [];
  const maxHistory = 100;

  function pushHistory(channel, username, text) {
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

  bot.on('chat', (username, message) => {
    pushHistory('public', username, message);
    events.push('chat:public', { username, text: message });
  });

  bot.on('messagestr', (message) => {
    pushHistory('server', null, message);
    events.push('chat:server', { message });
  });

  return {
    say(message) {
      bot.chat(message);
      events.push('chat:send', { text: message });
      return { text: message };
    },

    whisper(username, message) {
      bot.whisper(username, message);
      events.push('chat:whisper', { username, text: message });
      return { username, text: message };
    },

    history(limit = 20) {
      return history.slice(-limit);
    },
  };
}

module.exports = {
  createChatModule,
};
