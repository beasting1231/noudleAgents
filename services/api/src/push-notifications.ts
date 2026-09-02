import type { Agent, Message } from "@noudle-agents/protocol";
import type { PushSubscription, RelayRepository } from "./database/repository.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

export type PushFetch = typeof fetch;

export class PushNotificationService {
  constructor(private readonly repository: RelayRepository, private readonly pushFetch: PushFetch = fetch) {}

  async register(workspaceId: string, input: { token: string; platform: "ios" | "android"; deviceId?: string | null | undefined }): Promise<void> {
    const now = new Date().toISOString();
    const current = (await this.repository.listPushSubscriptions(workspaceId)).find((item) => item.token === input.token);
    const subscription: PushSubscription = {
      token: input.token,
      workspaceId,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    await this.repository.putPushSubscription(subscription);
  }

  async unregister(workspaceId: string, token: string): Promise<void> {
    await this.repository.deletePushSubscription(workspaceId, token);
  }

  async notifyAgentResponse(message: Message, agent: Agent): Promise<void> {
    const subscriptions = await this.repository.listPushSubscriptions(message.workspaceId);
    if (subscriptions.length === 0) return;
    const body = message.content.trim().replace(/\s+/g, " ").slice(0, 180) || "Response complete";
    const response = await this.pushFetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(subscriptions.map((subscription) => ({
        to: subscription.token,
        title: agent.name,
        body,
        sound: "default",
        data: { conversationId: message.conversationId, agentId: agent.id },
      }))),
    });
    if (!response.ok) throw new Error(`Expo push request failed (${response.status})`);
    const payload = await response.json() as { data?: ExpoTicket[] };
    await Promise.all((payload.data ?? []).map((ticket, index) => {
      if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
        const subscription = subscriptions[index];
        return subscription ? this.repository.deletePushSubscription(message.workspaceId, subscription.token) : Promise.resolve(false);
      }
      return Promise.resolve(false);
    }));
  }
}
