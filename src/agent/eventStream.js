const { EventEmitter } = require('node:events');

class EventStream extends EventEmitter {
  constructor(limit = 250) {
    super();
    this.limit = limit;
    this.sequence = 0;
    this.buffer = [];
  }

  push(type, payload = null) {
    const event = {
      id: ++this.sequence,
      timestamp: new Date().toISOString(),
      type,
      payload,
    };

    this.buffer.push(event);

    if (this.buffer.length > this.limit) {
      this.buffer.shift();
    }

    this.emit('event', event);
    this.emit(type, event);
    return event;
  }

  recent(limit = 20, type = null) {
    const items = type
      ? this.buffer.filter((event) => event.type === type)
      : this.buffer;

    return items.slice(-limit);
  }
}

module.exports = {
  EventStream,
};
