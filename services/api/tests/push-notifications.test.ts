import { describe, expect, it } from "vitest";
import { MemoryRelayRepository } from "../src/database/memory-repository.js";
import { PushNotificationService } from "../src/push-notifications.js";

describe("push notifications", () => {
  it("sends the agent response with chat routing data", async () => {
    const repository = new MemoryRelayRepository();
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const pushFetch: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket-1" }] }), { status: 200 });
    };
    const service = new PushNotificationService(repository, pushFetch);
    await service.register("workspace-test", { token: "ExponentPushToken[test-device]", platform: "ios" });

    await service.notifyAgentResponse({
      id: "message-1",
      workspaceId: "workspace-test",
      conversationId: "conversation-1",
      role: "agent",
      authorId: "agent-1",
      content: "The work is complete.",
      replyToMessageId: null,
      clientOperationId: null,
      createdAt: new Date().toISOString(),
    }, {
      id: "agent-1",
      workspaceId: "workspace-test",
      name: "Builder",
      role: "Builder",
      description: "",
      instructions: "",
      avatar: "BU",
      color: "#ffffff",
      capabilities: [],
      status: "idle",
      currentTaskId: null,
      codexThreadId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(requestUrl).toBe("https://exp.host/--/api/v2/push/send");
    const payload = JSON.parse(String(requestInit?.body));
    expect(payload[0]).toMatchObject({
      to: "ExponentPushToken[test-device]",
      title: "Builder",
      body: "The work is complete.",
      data: { conversationId: "conversation-1", agentId: "agent-1" },
    });
  });
});
