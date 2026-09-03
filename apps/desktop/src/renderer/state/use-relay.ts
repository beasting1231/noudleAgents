import { RelayApiClient, type RelaySnapshot } from "@noudle-agents/api-client";
import type {
  Agent,
  Approval,
  Conversation,
  ComposerSettings,
  CreateAgentInput,
  CreateConversationInput,
  Message,
  Run,
} from "@noudle-agents/protocol";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { demoSnapshot } from "../data/demo";
import { createInitialState, relayReducer } from "./relay-state";

const DEFAULT_API_URL = "http://127.0.0.1:4310";
const DEFAULT_TOKEN = "relay-local-owner";
const ACTIVE_RUN_STATUSES = new Set<Run["status"]>(["queued", "starting", "running", "waiting_approval", "waiting_user"]);

function upsertRun(runs: Run[], run: Run): Run[] {
  return runs.some(({ id }) => id === run.id)
    ? runs.map((candidate) => candidate.id === run.id ? run : candidate)
    : [...runs, run];
}

function configuredClient(): RelayApiClient {
  const url = localStorage.getItem("relay.apiUrl") ?? import.meta.env.VITE_RELAY_API_URL ?? DEFAULT_API_URL;
  const token = localStorage.getItem("relay.apiToken") ?? import.meta.env.VITE_RELAY_API_TOKEN ?? DEFAULT_TOKEN;
  return new RelayApiClient(url, token);
}

function cloneDemo(): RelaySnapshot {
  return structuredClone(demoSnapshot);
}

function readableConnectionError(error: unknown): string {
  if (!(error instanceof Error)) return "noudleAgents API is unavailable.";
  if (error.message.includes("<!DOCTYPE") || error.message.includes("Cannot GET")) return "noudleAgents API is not running.";
  if (error.message === "Failed to fetch") return "noudleAgents API could not be reached.";
  return error.message.slice(0, 180);
}

export function useRelay() {
  const client = useMemo(configuredClient, []);
  const [state, dispatch] = useReducer(relayReducer, cloneDemo(), createInitialState);
  const [runs, setRuns] = useState<Run[]>([]);
  const modeRef = useRef<"live" | "demo">("demo");
  const streamTimers = useRef<number[]>([]);

  const loadLiveSnapshot = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) {
      dispatch({ type: "connection", connection: "offline", message: "No network connection. Showing the latest workspace state." });
      return false;
    }
    dispatch({ type: "connection", connection: "connecting" });
    try {
      const [snapshot, nextRuns] = await Promise.all([client.getSnapshot(), client.listRuns()]);
      modeRef.current = "live";
      setRuns(nextRuns);
      dispatch({ type: "snapshot", snapshot, connection: "live" });
      return true;
    } catch (error) {
      const message = readableConnectionError(error);
      modeRef.current = "demo";
      setRuns([]);
      dispatch({ type: "snapshot", snapshot: cloneDemo(), connection: "demo" });
      dispatch({ type: "connection", connection: "demo", message: `${message} Inspecting the seeded workspace instead.` });
      return false;
    }
  }, [client]);

  useEffect(() => {
    void loadLiveSnapshot();
  }, [loadLiveSnapshot]);

  useEffect(() => {
    let closeEvents: (() => void) | undefined;
    let refreshTimer: number | undefined;
    let queuedRefresh: number | undefined;

    const refresh = () => {
      window.clearTimeout(queuedRefresh);
      queuedRefresh = window.setTimeout(async () => {
        try {
          const [snapshot, nextRuns] = await Promise.all([client.getSnapshot(), client.listRuns()]);
          setRuns(nextRuns);
          dispatch({ type: "snapshot", snapshot, connection: "live" });
        } catch {
          dispatch({ type: "connection", connection: navigator.onLine ? "error" : "offline", message: "Sync paused. Reconnecting…" });
        }
      }, 180);
    };

    if (state.connection === "live") {
      closeEvents = client.subscribe(state.cursor, refresh, () => {
        dispatch({ type: "connection", connection: navigator.onLine ? "error" : "offline", message: "Live updates paused. Polling for changes." });
      });
      refreshTimer = window.setInterval(refresh, 12_000);
    } else if (state.connection === "error") {
      refreshTimer = window.setInterval(refresh, 4_000);
    }

    return () => {
      closeEvents?.();
      window.clearInterval(refreshTimer);
      window.clearTimeout(queuedRefresh);
    };
  }, [client, state.connection, state.cursor]);

  useEffect(() => {
    const handleOffline = () => dispatch({ type: "connection", connection: "offline", message: "No network connection. Changes are not being sent." });
    const handleOnline = () => void loadLiveSnapshot();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      streamTimers.current.forEach(window.clearTimeout);
    };
  }, [loadLiveSnapshot]);

  const createAgent = useCallback(async (input: CreateAgentInput): Promise<Agent> => {
    if (modeRef.current === "live") {
      const agent = await client.createAgent(input);
      dispatch({ type: "upsert_agent", agent });
      return agent;
    }
    const timestamp = new Date().toISOString();
    const agent: Agent = {
      id: `agent-${crypto.randomUUID()}`,
      workspaceId: "workspace_local",
      name: input.name,
      role: input.role,
      description: input.description ?? "",
      instructions: input.instructions ?? "",
      avatar: input.avatar ?? input.name.slice(0, 2).toUpperCase(),
      color: input.color ?? "#D7FF64",
      capabilities: input.capabilities ?? [],
      status: "idle",
      currentTaskId: null,
      codexThreadId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    dispatch({ type: "upsert_agent", agent });
    return agent;
  }, [client]);

  const deleteAgent = useCallback(async (id: string): Promise<void> => {
    if (modeRef.current === "live") await client.deleteAgent(id);
    dispatch({ type: "remove_agent", id });
  }, [client]);

  const createConversation = useCallback(async (input: CreateConversationInput): Promise<Conversation> => {
    if (modeRef.current === "live") {
      const conversation = await client.createConversation(input);
      dispatch({ type: "upsert_conversation", conversation });
      return conversation;
    }
    const timestamp = new Date().toISOString();
    const conversation: Conversation = {
      id: `conversation-${crypto.randomUUID()}`,
      workspaceId: "workspace_local",
      kind: input.kind,
      title: input.title,
      memberAgentIds: input.memberAgentIds,
      taskId: input.taskId ?? null,
      lastMessageAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    dispatch({ type: "upsert_conversation", conversation });
    return conversation;
  }, [client]);

  const sendMessage = useCallback(async (conversationId: string, content: string, agentId: string, settings: ComposerSettings, attachmentIds: string[] = []): Promise<void> => {
    const operationId = crypto.randomUUID();
    if (modeRef.current === "live") {
      const response = await client.sendMessage(conversationId, {
        content,
        attachmentIds,
        agentId,
        clientOperationId: operationId,
        settings,
      });
      dispatch({ type: "upsert_message", message: response.message });
      const run: Run = {
        id: response.runId,
        workspaceId: response.message.workspaceId,
        agentId,
        conversationId,
        taskId: null,
        triggerMessageId: response.message.id,
        status: "queued",
        codexTurnId: null,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: response.message.createdAt,
        updatedAt: response.message.createdAt,
      };
      setRuns((current) => upsertRun(current, run));
      return;
    }

    const createdAt = new Date().toISOString();
    const userMessage: Message = {
      id: `message-${crypto.randomUUID()}`,
      workspaceId: "workspace_local",
      conversationId,
      role: "user",
      authorId: "user_local_owner",
      content,
      attachments: attachmentIds.map((artifactId) => ({ artifactId, name: "Attachment", mimeType: "application/octet-stream", size: 0, path: "demo" })),
      replyToMessageId: null,
      clientOperationId: operationId,
      createdAt,
    };
    dispatch({ type: "upsert_message", message: userMessage });

  }, [client]);

  const clearConversation = useCallback(async (conversation: Conversation): Promise<Conversation> => {
    streamTimers.current.forEach(window.clearTimeout);
    streamTimers.current = [];
    let replacement: Conversation;
    if (modeRef.current === "live") {
      replacement = await client.clearConversation(conversation.id);
    } else {
      const timestamp = new Date().toISOString();
      replacement = {
        ...conversation,
        id: `conversation-${crypto.randomUUID()}`,
        taskId: null,
        lastMessageAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
    setRuns((current) => current.filter(({ conversationId }) => conversationId !== conversation.id));
    dispatch({ type: "replace_conversation", previousId: conversation.id, conversation: replacement });
    return replacement;
  }, [client]);

  const interruptAgent = useCallback(async (conversationId: string, agentId: string): Promise<void> => {
    if (modeRef.current === "live") {
      const latestRuns = await client.listRuns();
      const activeRun = [...latestRuns]
        .reverse()
        .find((run) => run.conversationId === conversationId && run.agentId === agentId && ACTIVE_RUN_STATUSES.has(run.status));
      if (!activeRun) return;
      await client.interruptRun(activeRun.id);
      const now = new Date().toISOString();
      setRuns(latestRuns.map((run) => run.id === activeRun.id
        ? { ...run, status: "interrupted", completedAt: now, updatedAt: now }
        : run));
      return;
    }

    streamTimers.current.forEach(window.clearTimeout);
    streamTimers.current = [];
    const now = new Date().toISOString();
    setRuns((current) => current.map((run) => run.conversationId === conversationId && run.agentId === agentId && ACTIVE_RUN_STATUSES.has(run.status)
      ? { ...run, status: "interrupted", completedAt: now, updatedAt: now }
      : run));
    const agent = state.agents.find(({ id }) => id === agentId);
    if (agent) dispatch({ type: "upsert_agent", agent: { ...agent, status: "idle", updatedAt: now } });
  }, [client, state.agents]);

  const resolveApproval = useCallback(async (approval: Approval, decision: "approve" | "deny"): Promise<void> => {
    if (modeRef.current === "live") await client.resolveApproval(approval.id, decision);
    dispatch({
      type: "resolve_approval",
      id: approval.id,
      decision: decision === "approve" ? "approved" : "denied",
      at: new Date().toISOString(),
    });
  }, [client]);

  return {
    state,
    runs,
    dispatch,
    client,
    retry: loadLiveSnapshot,
    createAgent,
    deleteAgent,
    createConversation,
    clearConversation,
    sendMessage,
    interruptAgent,
    resolveApproval,
  };
}
