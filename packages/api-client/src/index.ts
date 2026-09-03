import type {
  Agent,
  Approval,
  Conversation,
  ConnectorProvider,
  CreateCustomConnectorInput,
  ConnectorSummary,
  CreateAgentInput,
  CreateConversationInput,
  CreateScheduleInput,
  CreateTaskInput,
  Message,
  RelayEvent,
  Run,
  Schedule,
  SendMessageInput,
  Task,
  UpdateScheduleInput,
} from "@noudle-agents/protocol";

export interface RelaySnapshot {
  agents: Agent[];
  conversations: Conversation[];
  messages: Message[];
  tasks: Task[];
  approvals: Approval[];
  cursor: number;
}

export class RelayApiClient {
  readonly baseUrl: string;
  readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${this.token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `noudleAgents request failed (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  getSnapshot(): Promise<RelaySnapshot> {
    return this.request("/v1/snapshot");
  }

  listAgents(): Promise<Agent[]> {
    return this.request("/v1/agents");
  }

  createAgent(input: CreateAgentInput): Promise<Agent> {
    return this.request("/v1/agents", { method: "POST", body: JSON.stringify(input) });
  }

  deleteAgent(id: string): Promise<void> {
    return this.request(`/v1/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  listConversations(): Promise<Conversation[]> {
    return this.request("/v1/conversations");
  }

  createConversation(input: CreateConversationInput): Promise<Conversation> {
    return this.request("/v1/conversations", { method: "POST", body: JSON.stringify(input) });
  }

  clearConversation(id: string): Promise<Conversation> {
    return this.request(`/v1/conversations/${encodeURIComponent(id)}/clear`, { method: "POST" });
  }

  registerPushSubscription(input: { token: string; platform: "ios" | "android"; deviceId?: string | null }): Promise<void> {
    return this.request("/v1/push-subscriptions", { method: "PUT", body: JSON.stringify(input) });
  }

  unregisterPushSubscription(token: string): Promise<void> {
    return this.request("/v1/push-subscriptions", { method: "DELETE", body: JSON.stringify({ token }) });
  }

  listConnectors(): Promise<ConnectorSummary[]> {
    return this.request("/v1/connectors");
  }

  connectConnector(provider: ConnectorProvider, secret: string): Promise<ConnectorSummary> {
    return this.request(`/v1/connectors/${encodeURIComponent(provider)}`, {
      method: "PUT",
      body: JSON.stringify({ secret }),
    });
  }

  disconnectConnector(provider: ConnectorProvider): Promise<void> {
    return this.request(`/v1/connectors/${encodeURIComponent(provider)}`, { method: "DELETE" });
  }

  createConnector(input: CreateCustomConnectorInput): Promise<ConnectorSummary> {
    return this.request("/v1/connectors", { method: "POST", body: JSON.stringify(input) });
  }

  deleteConnector(id: string): Promise<void> {
    return this.request(`/v1/connectors/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  listMessages(conversationId: string): Promise<Message[]> {
    return this.request(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
  }

  sendMessage(conversationId: string, input: SendMessageInput): Promise<{ message: Message; runId: string }> {
    return this.request(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": input.clientOperationId },
      body: JSON.stringify(input),
    });
  }

  listTasks(): Promise<Task[]> {
    return this.request("/v1/tasks");
  }

  listRuns(): Promise<Run[]> {
    return this.request("/v1/runs");
  }

  listEvents(after: number, limit = 500): Promise<RelayEvent[]> {
    return this.request(`/v1/event-history?after=${encodeURIComponent(String(after))}&limit=${encodeURIComponent(String(limit))}`);
  }

  listSchedules(): Promise<Schedule[]> {
    return this.request("/v1/schedules");
  }

  createSchedule(input: CreateScheduleInput): Promise<Schedule> {
    return this.request("/v1/schedules", { method: "POST", body: JSON.stringify(input) });
  }

  updateSchedule(id: string, input: UpdateScheduleInput): Promise<Schedule> {
    return this.request(`/v1/schedules/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  }

  deleteSchedule(id: string): Promise<void> {
    return this.request(`/v1/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  createTask(input: CreateTaskInput): Promise<Task> {
    return this.request("/v1/tasks", { method: "POST", body: JSON.stringify(input) });
  }

  delegateTask(taskId: string, agentId: string, message = "", contextRefs: string[] = []): Promise<Task> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}/delegate`, {
      method: "POST",
      body: JSON.stringify({ agentId, message, contextRefs }),
    });
  }

  resolveApproval(approvalId: string, decision: "approve" | "deny"): Promise<Approval> {
    return this.request(`/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`, { method: "POST" });
  }

  interruptRun(runId: string): Promise<void> {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/interrupt`, { method: "POST" });
  }

  subscribe(after: number, onEvent: (event: RelayEvent) => void, onError?: (error: Event) => void): () => void {
    const url = new URL(`${this.baseUrl}/v1/events`);
    url.searchParams.set("after", String(after));
    url.searchParams.set("token", this.token);
    const source = new EventSource(url);
    source.onmessage = (message) => onEvent(JSON.parse(message.data) as RelayEvent);
    source.onerror = (error) => onError?.(error);
    return () => source.close();
  }
}
