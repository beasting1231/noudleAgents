export class RelayCollaborationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly agentId: string,
  ) {}

  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const contentHeaders = init.body === undefined ? {} : { "content-type": "application/json" };
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        ...contentHeaders,
        authorization: `Bearer ${this.token}`,
        "x-relay-agent-id": this.agentId,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`noudleAgents API ${response.status}: ${text.slice(0, 1000)}`);
    }
    if (response.status === 204) return { ok: true };
    return response.json();
  }
}
