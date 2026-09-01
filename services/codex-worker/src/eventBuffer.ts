export interface WorkerEvent {
  cursor: number;
  type: string;
  threadId: string | null;
  turnId: string | null;
  payload: unknown;
  createdAt: string;
}

export class EventBuffer {
  private cursor = 0;
  private readonly events: WorkerEvent[] = [];
  private readonly listeners = new Set<(event: WorkerEvent) => void>();

  append(type: string, payload: unknown): WorkerEvent {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const event: WorkerEvent = {
      cursor: ++this.cursor,
      type,
      threadId: typeof record.threadId === "string" ? record.threadId : null,
      turnId: typeof record.turnId === "string"
        ? record.turnId
        : record.turn && typeof record.turn === "object" && typeof (record.turn as Record<string, unknown>).id === "string"
          ? String((record.turn as Record<string, unknown>).id)
          : null,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    if (this.events.length > 10_000) this.events.splice(0, this.events.length - 10_000);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  after(cursor: number): WorkerEvent[] {
    return this.events.filter((event) => event.cursor > cursor);
  }

  subscribe(listener: (event: WorkerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
