import type { Agent, ComposerSettings, Message, Run, Task } from "@noudle-agents/protocol";

export interface RuntimeContext {
  run: Run;
  agent: Agent;
  trigger: Message;
  task: Task | null;
  settings?: ComposerSettings | undefined;
}

export interface RuntimeEvent {
  type: "message.delta" | "tool.started" | "tool.output" | "tool.completed" | "approval.requested";
  payload: Record<string, unknown>;
}

export interface RuntimeResult {
  content: string;
  summary: string;
  suggestedDelegation?: {
    role: "research" | "operations";
    title: string;
    objective: string;
  };
}

export interface AgentRuntime {
  readonly name: string;
  execute(context: RuntimeContext, signal: AbortSignal, emit: (event: RuntimeEvent) => Promise<void>): Promise<RuntimeResult>;
}
