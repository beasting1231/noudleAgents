import { RelayApiClient, type RelaySnapshot } from "@noudle-agents/api-client";
import type { Conversation, Message } from "@noudle-agents/protocol";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Platform } from "react-native";

import { demoSnapshot } from "../demo";
import { loadInstanceConfig, saveInstanceConfig } from "../lib/config";
import { SYNC_INTERVAL_MS } from "../lib/syncPolicy";
import type { InstanceConfig } from "../model";
import { initialRelayState, relayReducer } from "../state/relay";

function operationId(): string {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useRelay() {
  const [state, dispatch] = useReducer(relayReducer, initialRelayState);
  const [config, setConfigState] = useState<InstanceConfig>({ baseUrl: "", token: "" });
  const [configured, setConfigured] = useState(false);
  const clientRef = useRef<RelayApiClient | null>(null);

  const connect = useCallback(async (nextConfig: InstanceConfig, persist = false) => {
    const normalized = { baseUrl: nextConfig.baseUrl.trim().replace(/\/$/, ""), token: nextConfig.token.trim() };
    setConfigState(normalized);
    setConfigured(Boolean(normalized.baseUrl && normalized.token));
    if (persist) await saveInstanceConfig(normalized);

    if (!normalized.baseUrl || !normalized.token) {
      clientRef.current = null;
      dispatch({ type: "hydrate", snapshot: demoSnapshot, source: "demo" });
      return false;
    }

    dispatch({ type: "connection", connection: "loading" });
    const client = new RelayApiClient(normalized.baseUrl, normalized.token);
    clientRef.current = client;
    try {
      const snapshot = await client.getSnapshot();
      dispatch({ type: "hydrate", snapshot, source: "server" });
      return true;
    } catch (error) {
      dispatch({ type: "hydrate", snapshot: demoSnapshot, source: "demo" });
      dispatch({ type: "connection", connection: "offline", error: error instanceof Error ? error.message : "Could not reach noudleAgents" });
      return false;
    }
  }, []);

  useEffect(() => {
    void loadInstanceConfig().then((saved) => connect(saved));
  }, [connect]);

  useEffect(() => {
    if (state.connection !== "live" || !clientRef.current) return;
    const client = clientRef.current;
    let disposed = false;
    let stopEvents: (() => void) | null = null;

    if (Platform.OS === "web" && typeof globalThis.EventSource !== "undefined") {
      stopEvents = client.subscribe(state.cursor, (event) => dispatch({ type: "event", event }), () => {
        dispatch({ type: "connection", connection: "offline", error: "Live updates paused. Reconnecting…" });
      });
    }

    const interval = setInterval(() => {
      void client.getSnapshot().then((snapshot: RelaySnapshot) => {
        if (!disposed) dispatch({ type: "hydrate", snapshot, source: "server" });
      }).catch((error: unknown) => {
        if (!disposed) dispatch({ type: "connection", connection: "offline", error: error instanceof Error ? error.message : "Sync interrupted" });
      });
    }, SYNC_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(interval);
      stopEvents?.();
    };
  }, [state.connection, state.cursor]);

  useEffect(() => {
    if (!configured || state.connection === "live" || state.connection === "loading" || !config.baseUrl || !config.token) return;
    const client = clientRef.current ?? new RelayApiClient(config.baseUrl, config.token);
    clientRef.current = client;
    const interval = setInterval(() => {
      void client.getSnapshot().then((snapshot) => {
        dispatch({ type: "hydrate", snapshot, source: "server" });
      }).catch(() => undefined);
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [config.baseUrl, config.token, configured, state.connection]);

  const sendMessage = useCallback(async (conversationId: string, agentId: string, content: string) => {
    const id = operationId();
    const message: Message = {
      id,
      workspaceId: "workspace_local",
      conversationId,
      role: "user",
      authorId: null,
      content,
      replyToMessageId: null,
      clientOperationId: id,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "optimisticMessage", message });
    if (!clientRef.current) return;
    try {
      const result = await clientRef.current.sendMessage(conversationId, { content, agentId, taskId: null, replyToMessageId: null, clientOperationId: id });
      dispatch({ type: "optimisticMessage", message: result.message });
    } catch (error) {
      dispatch({ type: "connection", connection: "offline", error: error instanceof Error ? error.message : "Message queued offline" });
    }
  }, []);

  const clearConversation = useCallback(async (conversationId: string): Promise<Conversation> => {
    if (!clientRef.current) throw new Error("Connect to clear this chat");
    const replacement = await clientRef.current.clearConversation(conversationId);
    const snapshot = await clientRef.current.getSnapshot();
    dispatch({ type: "hydrate", snapshot, source: "server" });
    dispatch({ type: "selectConversation", conversationId: replacement.id });
    return replacement;
  }, []);

  const registerPushSubscription = useCallback(async (token: string) => {
    if (!clientRef.current) throw new Error("Connect before enabling notifications");
    await clientRef.current.registerPushSubscription({ token, platform: Platform.OS === "android" ? "android" : "ios" });
  }, []);

  const resolveApproval = useCallback(async (approvalId: string, decision: "approve" | "deny") => {
    dispatch({ type: "resolveApproval", approvalId, decision: decision === "approve" ? "approved" : "denied" });
    try {
      await clientRef.current?.resolveApproval(approvalId, decision);
    } catch (error) {
      dispatch({ type: "connection", connection: "offline", error: error instanceof Error ? error.message : "Decision will retry when online" });
    }
  }, []);

  const delegateTask = useCallback(async (taskId: string, agentId: string) => {
    dispatch({ type: "delegateTask", taskId, agentId });
    try {
      await clientRef.current?.delegateTask(taskId, agentId, "Delegated from noudleAgents mobile");
    } catch (error) {
      dispatch({ type: "connection", connection: "offline", error: error instanceof Error ? error.message : "Delegation will retry when online" });
    }
  }, []);

  return useMemo(() => ({
    state,
    config,
    configured,
    dispatch,
    connect: (nextConfig: InstanceConfig) => connect(nextConfig, true),
    sendMessage,
    clearConversation,
    registerPushSubscription,
    resolveApproval,
    delegateTask,
  }), [clearConversation, config, configured, connect, delegateTask, registerPushSubscription, resolveApproval, sendMessage, state]);
}
