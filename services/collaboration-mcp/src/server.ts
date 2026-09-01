import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RelayCollaborationClient } from "./relayClient.js";

const apiUrl = process.env.RELAY_API_URL ?? "http://127.0.0.1:4310";
const token = process.env.RELAY_API_TOKEN;
const agentId = process.env.RELAY_AGENT_ID;

if (!token || !agentId) throw new Error("RELAY_API_TOKEN and RELAY_AGENT_ID are required");

const client = new RelayCollaborationClient(apiUrl, token, agentId);
const server = new McpServer({ name: "relay-collaboration", version: "0.1.0" });

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: { data } };
}

interface DesktopResponse {
  computer: { id: string; controlMode: string };
  result: { action: string; width: number; height: number; mimeType: "image/jpeg"; image: string };
}

function desktopResult(data: unknown) {
  const response = data as DesktopResponse;
  if (!response?.result?.image || response.result.mimeType !== "image/jpeg") throw new Error("noudleAgents returned an invalid desktop screenshot");
  const metadata = {
    computerId: response.computer.id,
    controlMode: response.computer.controlMode,
    action: response.result.action,
    width: response.result.width,
    height: response.result.height,
  };
  return {
    content: [
      { type: "image" as const, data: response.result.image, mimeType: response.result.mimeType },
      { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
    ],
    structuredContent: { data: metadata },
  };
}

async function desktopAction(input: Record<string, unknown>) {
  return desktopResult(await client.request("/v1/computers/desktop/action", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

server.registerTool(
  "get_user_profile",
  {
    title: "Get reusable user information",
    description: "Retrieve stable personal information the user previously supplied for form filling. Use it privately to continue the requested workflow; do not repeat the values in chat or logs.",
    inputSchema: {},
  },
  async () => result(await client.request("/v1/profile")),
);

server.registerTool(
  "remember_user_info",
  {
    title: "Remember reusable user information",
    description: "Save stable personal form information only when the user explicitly supplied it or asked noudleAgents to remember it. Never store passwords, PINs, OTP/2FA codes, CAPTCHA answers, recovery codes, tokens, security answers, private keys, or payment-card security data.",
    inputSchema: {
      values: z.record(z.string().min(1).max(120), z.string().min(1).max(2000)).default({}),
      remove: z.array(z.string().min(1).max(120)).max(100).default([]),
    },
  },
  async (input) => result(await client.request("/v1/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  })),
);

server.registerTool(
  "connect_connector",
  {
    title: "Connect a service",
    description: "Verify and securely save a GitHub, Resend, Notion, or Stripe credential only when the user explicitly asks to connect that service and supplies the credential. Pass the credential directly to this tool. Never repeat it, save it in files or profile data, or include it in chat output.",
    inputSchema: {
      provider: z.enum(["github", "resend", "notion", "stripe"]),
      secret: z.string().min(10).max(10_000),
    },
  },
  async ({ provider, secret }) => result(await client.request(`/v1/connectors/${encodeURIComponent(provider)}`, {
    method: "PUT",
    body: JSON.stringify({ secret }),
  })),
);

server.registerTool(
  "disconnect_connector",
  {
    title: "Disconnect a service",
    description: "Remove a saved GitHub, Resend, Notion, or Stripe connection only when the user explicitly asks to disconnect it.",
    inputSchema: { provider: z.enum(["github", "resend", "notion", "stripe"]) },
  },
  async ({ provider }) => result(await client.request(`/v1/connectors/${encodeURIComponent(provider)}`, { method: "DELETE" })),
);

server.registerTool(
  "list_agents",
  {
    title: "List noudleAgents agents",
    description: "List the agents you may collaborate with, including roles, capabilities, status, and current task.",
    inputSchema: { status: z.string().optional(), capability: z.string().optional() },
  },
  async ({ status, capability }) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (capability) query.set("capability", capability);
    return result(await client.request(`/v1/agents${query.size ? `?${query}` : ""}`));
  },
);

server.registerTool(
  "inspect_agent",
  {
    title: "Inspect a noudleAgents agent",
    description: "Inspect one agent's role, capabilities, availability, and accessible workload before delegating.",
    inputSchema: { agentId: z.string().min(1) },
  },
  async ({ agentId: target }) => result(await client.request(`/v1/agents/${encodeURIComponent(target)}`)),
);

server.registerTool(
  "list_computers",
  {
    title: "List noudleAgents computers",
    description: "List running noudleAgents computer sessions. Use this before computer work to see which browser is assigned to you or available as the shared unassigned computer.",
    inputSchema: {},
  },
  async () => result(await client.request("/v1/computers")),
);

server.registerTool(
  "browser_navigate",
  {
    title: "Navigate the noudleAgents browser",
    description: "Open an http or https URL in the visible noudleAgents VM browser. Use this for requests such as 'open Reddit on your computer'; do not use local desktop launchers such as xdg-open or open.",
    inputSchema: {
      url: z.string().url().max(8_000),
      computerId: z.string().min(1).max(160).nullable().default(null),
    },
  },
  async (input) => result(await client.request("/v1/computers/browser/navigate", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.registerTool(
  "computer_screenshot",
  {
    title: "Look at the noudleAgents computer",
    description: "Capture the complete visible noudleAgents VM desktop. Always use this before interacting and whenever the screen may have changed. Coordinates in the returned image map directly to the mouse tools.",
    inputSchema: { computerId: z.string().min(1).max(160).nullable().default(null) },
  },
  async ({ computerId }) => desktopAction({ action: "screenshot", computerId }),
);

server.registerTool(
  "computer_click",
  {
    title: "Click the noudleAgents computer",
    description: "Move the VM pointer to an exact screenshot coordinate and click. Returns a fresh screenshot after the click.",
    inputSchema: {
      x: z.number().int().min(0).max(10_000),
      y: z.number().int().min(0).max(10_000),
      button: z.number().int().min(1).max(3).default(1),
      count: z.number().int().min(1).max(3).default(1),
      computerId: z.string().min(1).max(160).nullable().default(null),
    },
  },
  async (input) => desktopAction({ action: "click", ...input }),
);

server.registerTool(
  "computer_type",
  {
    title: "Type on the noudleAgents computer",
    description: "Paste text into the focused VM field exactly as a user would. Click the target first. Returns a fresh screenshot and never echoes the typed text.",
    inputSchema: { text: z.string().max(20_000), computerId: z.string().min(1).max(160).nullable().default(null) },
  },
  async (input) => desktopAction({ action: "type", ...input }),
);

server.registerTool(
  "computer_key",
  {
    title: "Press a key on the noudleAgents computer",
    description: "Press a VM key or shortcut such as ENTER, TAB, ESC, CTRL+A, CTRL+L, or ALT+LEFT. Returns a fresh screenshot.",
    inputSchema: { key: z.string().min(1).max(80), computerId: z.string().min(1).max(160).nullable().default(null) },
  },
  async (input) => desktopAction({ action: "key", ...input }),
);

server.registerTool(
  "computer_scroll",
  {
    title: "Scroll the noudleAgents computer",
    description: "Scroll the VM at the current pointer, or at an optional screenshot coordinate. Positive amounts scroll down; negative amounts scroll up. Returns a fresh screenshot.",
    inputSchema: {
      amount: z.number().int().min(-30).max(30),
      x: z.number().int().min(0).max(10_000).optional(),
      y: z.number().int().min(0).max(10_000).optional(),
      computerId: z.string().min(1).max(160).nullable().default(null),
    },
  },
  async (input) => desktopAction({ action: "scroll", ...input }),
);

server.registerTool(
  "computer_move",
  {
    title: "Move the noudleAgents computer pointer",
    description: "Move the VM pointer to a screenshot coordinate without clicking, for hover menus and previews. Returns a fresh screenshot.",
    inputSchema: { x: z.number().int().min(0).max(10_000), y: z.number().int().min(0).max(10_000), computerId: z.string().min(1).max(160).nullable().default(null) },
  },
  async (input) => desktopAction({ action: "move", ...input }),
);

server.registerTool(
  "computer_drag",
  {
    title: "Drag on the noudleAgents computer",
    description: "Drag from one screenshot coordinate to another on the VM. Returns a fresh screenshot.",
    inputSchema: {
      fromX: z.number().int().min(0).max(10_000), fromY: z.number().int().min(0).max(10_000),
      toX: z.number().int().min(0).max(10_000), toY: z.number().int().min(0).max(10_000),
      button: z.number().int().min(1).max(3).default(1), steps: z.number().int().min(1).max(100).default(12),
      computerId: z.string().min(1).max(160).nullable().default(null),
    },
  },
  async (input) => desktopAction({ action: "drag", ...input }),
);

server.registerTool(
  "computer_wait",
  {
    title: "Wait for the noudleAgents computer",
    description: "Wait briefly for a page or app transition, then return a fresh VM screenshot.",
    inputSchema: { milliseconds: z.number().int().min(100).max(10_000).default(1000), computerId: z.string().min(1).max(160).nullable().default(null) },
  },
  async (input) => desktopAction({ action: "wait", ...input }),
);

server.registerTool(
  "list_tasks",
  {
    title: "List noudleAgents tasks",
    description: "List visible tasks and their owners, parents, statuses, blockers, and budgets.",
    inputSchema: { status: z.string().optional(), ownerAgentId: z.string().optional() },
  },
  async ({ status, ownerAgentId }) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (ownerAgentId) query.set("ownerAgentId", ownerAgentId);
    return result(await client.request(`/v1/tasks${query.size ? `?${query}` : ""}`));
  },
);

server.registerTool(
  "read_task",
  {
    title: "Read a noudleAgents task",
    description: "Read a task with its parent, children, context references, events, and artifacts.",
    inputSchema: { taskId: z.string().min(1) },
  },
  async ({ taskId }) => result(await client.request(`/v1/tasks/${encodeURIComponent(taskId)}`)),
);

server.registerTool(
  "create_task",
  {
    title: "Create a noudleAgents task",
    description: "Create a bounded task or child task with explicit acceptance criteria and budget.",
    inputSchema: {
      title: z.string().min(1).max(180),
      objective: z.string().min(1).max(20_000),
      acceptanceCriteria: z.array(z.string().min(1)).max(30).default([]),
      parentTaskId: z.string().nullable().default(null),
      ownerAgentId: z.string().nullable().default(null),
      maxTokens: z.number().int().positive().max(10_000_000).default(100_000),
      maxWallSeconds: z.number().int().positive().max(86_400).default(3600),
      maxChildTasks: z.number().int().min(0).max(8).default(4),
    },
  },
  async (input) => result(await client.request("/v1/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      objective: input.objective,
      acceptanceCriteria: input.acceptanceCriteria,
      parentTaskId: input.parentTaskId,
      ownerAgentId: input.ownerAgentId,
      budget: {
        maxTokens: input.maxTokens,
        maxWallSeconds: input.maxWallSeconds,
        maxChildTasks: input.maxChildTasks,
      },
    }),
  })),
);

server.registerTool(
  "delegate_task",
  {
    title: "Delegate a noudleAgents task",
    description: "Assign an existing bounded task to another agent with selected context references. Delegation is visible and policy checked.",
    inputSchema: {
      taskId: z.string().min(1),
      agentId: z.string().min(1),
      message: z.string().max(4000).default(""),
      contextRefs: z.array(z.string().min(1)).max(50).default([]),
    },
  },
  async ({ taskId, ...input }) => result(await client.request(`/v1/tasks/${encodeURIComponent(taskId)}/delegate`, {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.registerTool(
  "message_agent",
  {
    title: "Message a noudleAgents agent",
    description: "Send a visible task-linked message to another agent without transferring ownership.",
    inputSchema: {
      agentId: z.string().min(1),
      taskId: z.string().nullable().default(null),
      message: z.string().min(1).max(20_000),
      contextRefs: z.array(z.string().min(1)).max(50).default([]),
    },
  },
  async (input) => result(await client.request("/v1/collaboration/messages", {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.registerTool(
  "report_blocker",
  {
    title: "Report a task blocker",
    description: "Mark a task blocked with a concrete reason and whether user input is required.",
    inputSchema: { taskId: z.string().min(1), blocker: z.string().min(1).max(4000), needsUser: z.boolean().default(false) },
  },
  async ({ taskId, ...input }) => result(await client.request(`/v1/tasks/${encodeURIComponent(taskId)}/block`, {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

server.registerTool(
  "complete_task",
  {
    title: "Complete a noudleAgents task",
    description: "Complete a task with a concise summary, artifact IDs, and evidence references.",
    inputSchema: {
      taskId: z.string().min(1),
      summary: z.string().min(1).max(20_000),
      artifactIds: z.array(z.string().min(1)).max(100).default([]),
      evidenceRefs: z.array(z.string().min(1)).max(100).default([]),
    },
  },
  async ({ taskId, ...input }) => result(await client.request(`/v1/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: "POST",
    body: JSON.stringify(input),
  })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
