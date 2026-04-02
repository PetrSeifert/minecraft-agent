import { EventEmitter } from "node:events";

import type { StreamEvent } from "../types";

export class EventStream extends EventEmitter {
  private buffer: StreamEvent[] = [];
  private readonly limit: number;
  private sequence = 0;

  constructor(limit = 250) {
    super();
    this.limit = limit;
  }

  push(type: string, payload: unknown = null): StreamEvent {
    const event: StreamEvent = {
      id: ++this.sequence,
      timestamp: new Date().toISOString(),
      type,
      payload,
    };

    this.buffer.push(event);

    if (this.buffer.length > this.limit) {
      this.buffer.shift();
    }

    this.emit("event", event);
    this.emit(type, event);
    return event;
  }

  recent(limit = 20, type: string | null = null): StreamEvent[] {
    const items = type ? this.buffer.filter((event) => event.type === type) : this.buffer;

    return items.slice(-limit);
  }
}
