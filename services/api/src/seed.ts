import { createHash } from "node:crypto";
import type { Agent, Conversation } from "@noudle-agents/protocol";
import type { RelayConfig } from "./config.js";
import type { RelayRepository } from "./database/repository.js";

export async function seedLocalWorkspace(repository: RelayRepository, config: RelayConfig): Promise<void> {
  if (await repository.getWorkspace(config.workspaceId)) return;
  const now = new Date().toISOString();
  const keepReadableLocalIds = config.workspaceId === "workspace-local" || config.workspaceId === "workspace-test";
  const suffix = keepReadableLocalIds ? "" : `-${createHash("sha256").update(config.workspaceId).digest("hex").slice(0, 10)}`;
  await repository.putWorkspace({
    id: config.workspaceId,
    name: "My noudleAgents Workspace",
    ownerId: config.ownerId,
    profile: {},
    createdAt: now,
    updatedAt: now,
  });

  const agents: Agent[] = [
    {
      id: `agent-builder${suffix}`,
      workspaceId: config.workspaceId,
      name: "Builder",
      role: "Software engineer",
      description: "Builds, tests, and reviews production software.",
      instructions: "Own implementation quality. Work in small verifiable increments and report evidence.",
      avatar: "BU",
      color: "#D7FF64",
      capabilities: ["code", "terminal", "tests", "review"],
      status: "idle",
      currentTaskId: null,
      codexThreadId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `agent-researcher${suffix}`,
      workspaceId: config.workspaceId,
      name: "Researcher",
      role: "Research analyst",
      description: "Finds reliable sources and turns them into concise decisions.",
      instructions: "Separate verified facts from inference and attach source provenance.",
      avatar: "RE",
      color: "#75B8FF",
      capabilities: ["research", "web", "analysis", "summaries"],
      status: "idle",
      currentTaskId: null,
      codexThreadId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `agent-operator${suffix}`,
      workspaceId: config.workspaceId,
      name: "Operator",
      role: "Operations specialist",
      description: "Runs repeatable workflows, checks systems, and handles approvals.",
      instructions: "Prefer reversible actions. Stop for approval before material external changes.",
      avatar: "OP",
      color: "#C29BFF",
      capabilities: ["browser", "files", "workflows", "monitoring"],
      status: "idle",
      currentTaskId: null,
      codexThreadId: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (const agent of agents) await repository.put("agents", agent);

  const conversations: Conversation[] = agents.map((agent) => ({
    id: `conversation-${agent.id.slice("agent-".length)}`,
    workspaceId: config.workspaceId,
    kind: "direct",
    title: agent.name,
    memberAgentIds: [agent.id],
    taskId: null,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  conversations.push({
    id: `conversation-team${suffix}`,
    workspaceId: config.workspaceId,
    kind: "group",
    title: "Agent team",
    memberAgentIds: agents.map((agent) => agent.id),
    taskId: null,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  });
  for (const conversation of conversations) await repository.put("conversations", conversation);
}
