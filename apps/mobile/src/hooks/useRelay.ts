import { RelayApiClient, type RelaySnapshot } from "@noudle-agents/api-client";
import type { Conversation, MessageResponsePart, RelayEvent, Run } from "@noudle-agents/protocol";
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

const activeRunStatuses = new Set<Run["status"]>(["queued", "starting", "running", "waiting_approval", "waiting_user"]);

function captureLiveResponse(current: Record<string, MessageResponsePart[]>, event: RelayEvent): Record<string, MessageResponsePart[]> {
  if (event.type === "message.delta") {
    const runId = typeof event.payload.runId === "string" ? event.payload.runId : event.aggregateId;
    const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
    if (!delta) return current;
    const parts = [...(current[runId] ?? [])];
    const last = parts.at(-1);
    if (last?.type === "text") parts[parts.length - 1] = { ...last, text: last.text + delta };
    else parts.push({ type: "text", text: delta });
    return { ...current, [runId]: parts };
  }
  if (event.type === "tool.started" || event.type === "tool.completed") {
    const raw = event.payload.part;
    if (!raw || typeof raw !== "object" || (raw as { type?: unknown }).type !== "tool") return current;
    const part = raw as MessageResponsePart;
    const parts = [...(current[event.aggregateId] ?? [])];
    const index = parts.findIndex((candidate) => candidate.type === "tool" && candidate.id === (part.type === "tool" ? part.id : ""));
    if (index >= 0) parts[index] = part;
    else parts.push(part);
    return { ...current, [event.aggregateId]: parts };
  }
  return current;
}

export function useRelay() {
  const [state, dispatch] = useReducer(relayReducer, initialRelayState);
  const [config, setConfigState] = useState<InstanceConfig>({ baseUrl: "", token: "" });
  const [configured, setConfigured] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [liveResponses, setLiveResponses] = useState<Record<string, MessageResponsePart[]>>({});
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
      const [snapshot, nextRuns] = await Promise.all([client.getSnapshot(), client.listRuns()]);
      setRuns(nextRuns);
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
      const after = state.cursor;
      void Promise.all([client.getSnapshot(), client.listRuns(), client.listEvents(after).catch(() => [] as RelayEvent[])]).then(([snapshot, nextRuns, events]: [RelaySnapshot, Run[], RelayEvent[]]) => {
        if (!disposed) {
          for (const event of events) {
            dispatch({ type: "event", event });
            setLiveResponses((current) => captureLiveResponse(current, event));
          }
          setRuns(nextRuns);
          dispatch({ type: "hydrate", snapshot, source: "server" });
        }
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
    const activeIds = new Set(runs.filter((run) => activeRunStatuses.has(run.status)).map((run) => run.id));
    setLiveResponses((current) => {
      const retained = Object.fromEntries(Object.entries(current).filter(([runId]) => activeIds.has(runId)));
      return Object.keys(retained).length === Object.keys(current).length ? current : retained;
    });
  }, [runs]);

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

  const sendMessage = useCallback(async (conversationId: string, agentId: string, content: string, attachmentIds: string[] = []) => {
    const id = operationId();
    if (!clientRef.current) throw new Error("Connect before sending a message");
    try {
      const result = await clientRef.current.sendMessage(conversationId, { content, attachmentIds, agentId, taskId: null, replyToMessageId: null, clientOperationId: id });
      dispatch({ type: "optimisticMessage", message: result.message });
      void clientRef.current.listRuns().then(setRuns).catch(() => undefined);
    } catch (error) {
      dispatch({ type: "connection", connection: "offline", error: error instanceof Error ? error.message : "Message queued offline" });
      throw error;
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

  const interruptAgent = useCallback(async (conversationId: string, agentId: string): Promise<void> => {
    if (!clientRef.current) throw new Error("Connect to stop this agent");
    const latestRuns = await clientRef.current.listRuns();
    const activeRun = [...latestRuns]
      .reverse()
      .find((run) => run.conversationId === conversationId && run.agentId === agentId && activeRunStatuses.has(run.status));
    if (!activeRun) return;
    await clientRef.current.interruptRun(activeRun.id);
    const now = new Date().toISOString();
    setRuns(latestRuns.map((run) => run.id === activeRun.id
      ? { ...run, status: "interrupted", completedAt: now, updatedAt: now }
      : run));
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
    runs,
    liveResponses,
    config,
    configured,
    dispatch,
    connect: (nextConfig: InstanceConfig) => connect(nextConfig, true),
    sendMessage,
    clearConversation,
    interruptAgent,
    registerPushSubscription,
    resolveApproval,
    delegateTask,
  }), [clearConversation, config, configured, connect, delegateTask, interruptAgent, liveResponses, registerPushSubscription, resolveApproval, runs, sendMessage, state]);
}
