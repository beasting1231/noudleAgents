import type { AgentRuntime, RuntimeContext, RuntimeEvent, RuntimeResult } from "./runtime.js";

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("Interrupted"));
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Interrupted"));
      },
      { once: true },
    );
  });
}

export class MockAgentRuntime implements AgentRuntime {
  readonly name = "mock";

  constructor(private readonly delayMs = 8) {}

  async execute(context: RuntimeContext, signal: AbortSignal, emit: (event: RuntimeEvent) => Promise<void>): Promise<RuntimeResult> {
    const wantsDelegation = /delegate|research|ask another agent/i.test(context.trigger.content);
    const prefix = wantsDelegation
      ? `I reviewed the request and prepared a bounded research handoff. `
      : `I’m ${context.agent.name}. I reviewed the request and prepared the next concrete step. `;
    const content = `${prefix}This is a mock-runtime response; the Codex adapter can replace it without changing the API or queue.`;

    const toolPart = { type: "tool" as const, id: "mock-workspace-inspect", toolType: "mcpToolCall", status: "running" as const, data: { server: "workspace", tool: "inspect", arguments: { taskId: context.task?.id ?? null } } };
    await emit({ type: "tool.started", payload: { tool: "workspace.inspect", arguments: { taskId: context.task?.id ?? null }, part: toolPart } });
    await wait(this.delayMs, signal);
    await emit({ type: "tool.output", payload: { tool: "workspace.inspect", output: "Workspace context loaded." } });
    await emit({ type: "tool.completed", payload: { tool: "workspace.inspect", ok: true, part: { ...toolPart, status: "completed" } } });

    for (const chunk of content.match(/.{1,24}/g) ?? []) {
      await wait(this.delayMs, signal);
      await emit({ type: "message.delta", payload: { runId: context.run.id, delta: chunk } });
    }
    const result: RuntimeResult = {
      content,
      summary: wantsDelegation ? "Prepared and delegated a bounded research task." : "Prepared a concrete next step.",
      responseParts: [
        { type: "tool", id: "mock-workspace-inspect", toolType: "mcpToolCall", status: "completed", data: { server: "workspace", tool: "inspect", arguments: { taskId: context.task?.id ?? null } } },
        { type: "text", text: content },
      ],
    };
    if (wantsDelegation) {
      result.suggestedDelegation = { role: "research", title: "Research delegated request", objective: context.trigger.content };
    }
    return result;
  }
}
