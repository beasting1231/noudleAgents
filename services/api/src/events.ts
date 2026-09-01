import type { RelayEvent } from "@noudle-agents/protocol";

type Listener = (event: RelayEvent) => void;

export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(event: RelayEvent): void {
    for (const listener of this.listeners.get(event.workspaceId) ?? []) listener(event);
  }

  subscribe(workspaceId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(workspaceId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(workspaceId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(workspaceId);
    };
  }
}
