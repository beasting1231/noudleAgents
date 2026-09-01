import type { Agent, Approval, Conversation, Message, Task } from "@noudle-agents/protocol";

const now = new Date();
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

export const demoAgents: Agent[] = [
  {
    id: "agent-orbit", workspaceId: "workspace_local", name: "Orbit", role: "Coordinator", description: "Plans work and keeps every specialist aligned.", instructions: "", avatar: "OR", color: "#D7FF64", capabilities: ["Planning", "Delegation", "Review"], status: "working", currentTaskId: "task-mvp", codexThreadId: "thread-orbit", createdAt: iso(20_000), updatedAt: iso(1),
  },
  {
    id: "agent-flint", workspaceId: "workspace_local", name: "Flint", role: "Backend engineer", description: "Builds durable services and execution infrastructure.", instructions: "", avatar: "FL", color: "#74B9FF", capabilities: ["TypeScript", "Postgres", "Docker"], status: "waiting_agent", currentTaskId: "task-api", codexThreadId: "thread-flint", createdAt: iso(19_000), updatedAt: iso(5),
  },
  {
    id: "agent-vale", workspaceId: "workspace_local", name: "Vale", role: "Product designer", description: "Turns complex agent state into calm interfaces.", instructions: "", avatar: "VA", color: "#DAB7FF", capabilities: ["UX", "React Native", "Accessibility"], status: "idle", currentTaskId: null, codexThreadId: "thread-vale", createdAt: iso(18_000), updatedAt: iso(13),
  },
];

export const demoConversations: Conversation[] = [
  { id: "conversation-orbit", workspaceId: "workspace_local", kind: "direct", title: "Orbit", memberAgentIds: ["agent-orbit"], taskId: "task-mvp", lastMessageAt: iso(1), createdAt: iso(300), updatedAt: iso(1) },
  { id: "conversation-flint", workspaceId: "workspace_local", kind: "direct", title: "Flint", memberAgentIds: ["agent-flint"], taskId: "task-api", lastMessageAt: iso(5), createdAt: iso(260), updatedAt: iso(5) },
  { id: "conversation-team", workspaceId: "workspace_local", kind: "group", title: "MVP room", memberAgentIds: ["agent-orbit", "agent-flint", "agent-vale"], taskId: "task-mvp", lastMessageAt: iso(22), createdAt: iso(220), updatedAt: iso(22) },
];

export const demoMessages: Message[] = [
  { id: "message-1", workspaceId: "workspace_local", conversationId: "conversation-orbit", role: "user", authorId: null, content: "Get the shared mobile client ready for a real-device test.", replyToMessageId: null, clientOperationId: null, createdAt: iso(8) },
  { id: "message-2", workspaceId: "workspace_local", conversationId: "conversation-orbit", role: "agent", authorId: "agent-orbit", content: "I split the work into sync, native navigation, and computer-control tracks. Flint owns the API contract; I’m checking the end-to-end recovery path now.", replyToMessageId: null, clientOperationId: null, createdAt: iso(5) },
  { id: "message-3", workspaceId: "workspace_local", conversationId: "conversation-orbit", role: "system", authorId: null, content: "Orbit delegated “Snapshot and event sync” to Flint.", replyToMessageId: null, clientOperationId: null, createdAt: iso(4) },
  { id: "message-4", workspaceId: "workspace_local", conversationId: "conversation-orbit", role: "agent", authorId: "agent-orbit", content: "The navigation and offline recovery are verified. One network approval needs your decision before the device can take over the browser session.", replyToMessageId: null, clientOperationId: null, createdAt: iso(1) },
  { id: "message-5", workspaceId: "workspace_local", conversationId: "conversation-flint", role: "agent", authorId: "agent-flint", content: "Snapshot endpoint is stable. I’m waiting for Orbit to merge the event cursor changes.", replyToMessageId: null, clientOperationId: null, createdAt: iso(5) },
  { id: "message-6", workspaceId: "workspace_local", conversationId: "conversation-team", role: "agent", authorId: "agent-vale", content: "The phone surface now uses the same information hierarchy as desktop, adapted to thumb reach.", replyToMessageId: null, clientOperationId: null, createdAt: iso(22) },
];

export const demoTasks: Task[] = [
  {
    id: "task-mvp", workspaceId: "workspace_local", parentTaskId: null, conversationId: "conversation-orbit", title: "Ship local noudleAgents MVP", objective: "Run collaborating Codex agents locally with shared desktop and mobile state.", acceptanceCriteria: ["Persistent workspace", "Cross-device sync", "Safe approvals"], ownerAgentId: "agent-orbit", createdByType: "user", createdById: "user_local_owner", status: "running", priority: "high", depth: 0, budget: { maxTokens: 400_000, maxWallSeconds: 18_000, maxChildTasks: 6 }, blocker: null, resultSummary: null, createdAt: iso(520), updatedAt: iso(1),
  },
  {
    id: "task-api", workspaceId: "workspace_local", parentTaskId: "task-mvp", conversationId: "conversation-flint", title: "Snapshot and event sync", objective: "Keep all clients consistent across disconnects and reconnects.", acceptanceCriteria: ["Ordered cursor", "Idempotent replay"], ownerAgentId: "agent-flint", createdByType: "agent", createdById: "agent-orbit", status: "waiting_agent", priority: "high", depth: 1, budget: { maxTokens: 100_000, maxWallSeconds: 3600, maxChildTasks: 2 }, blocker: "Waiting for coordinator review", resultSummary: null, createdAt: iso(190), updatedAt: iso(5),
  },
  {
    id: "task-mobile", workspaceId: "workspace_local", parentTaskId: "task-mvp", conversationId: null, title: "Native mobile shell", objective: "Deliver the iPhone companion surface with offline recovery.", acceptanceCriteria: ["Four primary tabs", "Accessible touch targets"], ownerAgentId: "agent-vale", createdByType: "agent", createdById: "agent-orbit", status: "completed", priority: "normal", depth: 1, budget: { maxTokens: 80_000, maxWallSeconds: 3600, maxChildTasks: 2 }, blocker: null, resultSummary: "Native shell and state recovery complete.", createdAt: iso(170), updatedAt: iso(32),
  },
  {
    id: "task-stream", workspaceId: "workspace_local", parentTaskId: "task-api", conversationId: null, title: "Browser frame transport", objective: "Stream the agent browser and pass pointer input safely.", acceptanceCriteria: ["Watch mode", "Explicit takeover"], ownerAgentId: null, createdByType: "agent", createdById: "agent-flint", status: "queued", priority: "normal", depth: 2, budget: { maxTokens: 50_000, maxWallSeconds: 2400, maxChildTasks: 1 }, blocker: null, resultSummary: null, createdAt: iso(90), updatedAt: iso(22),
  },
];

export const demoApprovals: Approval[] = [
  {
    id: "approval-network", workspaceId: "workspace_local", runId: "run-orbit", taskId: "task-mvp", agentId: "agent-orbit", tool: "browser.navigate", risk: "external_communication", title: "Open the local device tunnel", description: "Orbit wants to expose the browser stream to your signed-in iPhone over the encrypted development tunnel.", normalizedArguments: { target: "relay.local", duration: "30 minutes" }, signature: "demo-signature-0001", status: "pending", expiresAt: new Date(now.getTime() + 20 * 60_000).toISOString(), decidedAt: null, createdAt: iso(2),
  },
];

export const demoSnapshot = {
  agents: demoAgents,
  conversations: demoConversations,
  messages: demoMessages,
  tasks: demoTasks,
  approvals: demoApprovals,
  cursor: 42,
};
