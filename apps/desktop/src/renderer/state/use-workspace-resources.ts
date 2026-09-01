import type { RelayApiClient } from "@noudle-agents/api-client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ConnectionMode } from "./relay-state";
import {
  createWorkspaceResourceState,
  demoArtifacts,
  demoComputers,
  workspaceResourceReducer,
  type ArtifactRecord,
  type ComputerSession,
  type TerminalResult,
} from "./workspace-resources";

interface CreateComputerInput {
  agentId?: string;
  taskId?: string;
  browser?: boolean;
  networkAccess?: boolean;
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const nested = typeof payload.error === "object" ? payload.error.message : payload.error;
    return new Error(nested ?? payload.message ?? `noudleAgents request failed (${response.status})`);
  } catch {
    return new Error(text && !text.includes("<!DOCTYPE") ? text.slice(0, 240) : `noudleAgents request failed (${response.status})`);
  }
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function useWorkspaceResources(client: RelayApiClient, connection: ConnectionMode) {
  const [state, dispatch] = useReducer(workspaceResourceReducer, undefined, createWorkspaceResourceState);
  const hasEnteredLive = useRef(false);

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${client.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${client.token}`,
        ...init.headers,
      },
    });
    if (!response.ok) throw await responseError(response);
    return (await response.json()) as T;
  }, [client]);

  const sync = useCallback(async () => {
    if (connection !== "live") return;
    dispatch({ type: "loading", value: true });
    try {
      const [artifacts, computers] = await Promise.all([
        request<ArtifactRecord[]>("/v1/artifacts"),
        request<ComputerSession[]>("/v1/computers"),
      ]);
      dispatch({ type: "replace", artifacts, computers, mode: "live" });
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : "Workspace resources could not be synchronized." });
    }
  }, [connection, request]);

  useEffect(() => {
    if (connection === "live") {
      if (!hasEnteredLive.current) {
        hasEnteredLive.current = true;
        dispatch({ type: "replace", artifacts: [], computers: [], mode: "live" });
      }
      void sync();
      const timer = window.setInterval(() => void sync(), 8_000);
      return () => window.clearInterval(timer);
    }
    if (connection === "demo") {
      hasEnteredLive.current = false;
      dispatch({ type: "replace", artifacts: structuredClone(demoArtifacts), computers: structuredClone(demoComputers), mode: "demo" });
      return;
    }
    if (connection === "error") return;
    dispatch({ type: "mode", mode: connection });
  }, [connection, sync]);

  const uploadArtifact = useCallback(async (file: File, context: { taskId?: string; agentId?: string } = {}) => {
    if (state.mode === "live") {
      const body = new FormData();
      body.set("file", file);
      body.set("name", file.name);
      body.set("source", "user_upload");
      if (context.taskId) body.set("taskId", context.taskId);
      if (context.agentId) body.set("agentId", context.agentId);
      const artifact = await request<ArtifactRecord>("/v1/artifacts", { method: "POST", body });
      dispatch({ type: "upsert_artifact", artifact });
      return artifact;
    }
    const now = new Date().toISOString();
    const id = `artifact-${crypto.randomUUID()}`;
    const artifact: ArtifactRecord = {
      id,
      logicalId: id,
      workspaceId: "workspace_local",
      version: 1,
      parentArtifactId: null,
      taskId: context.taskId ?? null,
      runId: null,
      agentId: context.agentId ?? null,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      checksum: `demo-${crypto.randomUUID()}`,
      storageKey: `demo/${file.name}`,
      provenance: { source: "user_upload", createdByType: "user", createdById: "user_local_owner", originalName: file.name },
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    dispatch({ type: "upsert_artifact", artifact });
    return artifact;
  }, [request, state.mode]);

  const renameArtifact = useCallback(async (artifact: ArtifactRecord, name: string) => {
    if (state.mode === "live") {
      const renamed = await request<ArtifactRecord>(`/v1/artifacts/${encodeURIComponent(artifact.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      dispatch({ type: "upsert_artifact", artifact: renamed });
      return;
    }
    dispatch({ type: "upsert_artifact", artifact: { ...artifact, name, updatedAt: new Date().toISOString() } });
  }, [request, state.mode]);

  const downloadArtifact = useCallback(async (artifact: ArtifactRecord) => {
    if (state.mode === "live") {
      const response = await fetch(`${client.baseUrl}/v1/artifacts/${encodeURIComponent(artifact.id)}/download`, {
        headers: { authorization: `Bearer ${client.token}` },
      });
      if (!response.ok) throw await responseError(response);
      saveBlob(await response.blob(), artifact.name);
      return;
    }
    const content = artifact.mimeType.startsWith("text/")
      ? `Demo artifact: ${artifact.name}\n\nConnect the noudleAgents API to download the persisted file.`
      : `Demo artifact placeholder for ${artifact.name}`;
    saveBlob(new Blob([content], { type: artifact.mimeType }), artifact.name);
  }, [client, state.mode]);

  const createComputer = useCallback(async (input: CreateComputerInput) => {
    if (state.mode === "live") {
      const computer = await request<ComputerSession>("/v1/computers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, browser: input.browser ?? true, networkAccess: input.networkAccess ?? true }),
      });
      dispatch({ type: "upsert_computer", computer });
      return computer;
    }
    const now = new Date().toISOString();
    const computer: ComputerSession = {
      id: `computer-${crypto.randomUUID()}`,
      workspaceId: "workspace_local",
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      status: "running",
      browser: input.browser ?? true,
      networkAccess: input.networkAccess ?? true,
      computerUrl: null,
      computerHostPort: null,
      controlMode: "watch",
      controlHolderId: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    dispatch({ type: "upsert_computer", computer });
    return computer;
  }, [request, state.mode]);

  const updateComputerControl = useCallback(async (computer: ComputerSession, action: "takeover" | "return") => {
    if (state.mode === "live") {
      const updated = await request<ComputerSession>(`/v1/computers/${encodeURIComponent(computer.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "takeover" ? { leaseSeconds: 300 } : {}),
      });
      dispatch({ type: "upsert_computer", computer: updated });
      return updated;
    }
    const updated: ComputerSession = {
      ...computer,
      controlMode: action === "takeover" ? "user" : "agent",
      controlHolderId: action === "takeover" ? "user_local_owner" : computer.agentId,
      leaseExpiresAt: action === "takeover" ? new Date(Date.now() + 300_000).toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: "upsert_computer", computer: updated });
    return updated;
  }, [request, state.mode]);

  const executeCommand = useCallback(async (computer: ComputerSession, command: string) => {
    let payload: { exitCode: number; stdout: string; stderr: string };
    if (state.mode === "live") {
      payload = await request(`/v1/computers/${encodeURIComponent(computer.id)}/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: ["sh", "-lc", command], timeoutMs: 30_000 }),
      });
    } else {
      const normalized = command.trim();
      payload = normalized === "pwd"
        ? { exitCode: 0, stdout: "/workspace\n", stderr: "" }
        : normalized === "whoami"
          ? { exitCode: 0, stdout: "agent\n", stderr: "" }
          : normalized.startsWith("ls")
            ? { exitCode: 0, stdout: "README.md  artifacts  src\n", stderr: "" }
            : { exitCode: 0, stdout: `Demo terminal accepted: ${normalized}\n`, stderr: "" };
    }
    const result: TerminalResult = { id: crypto.randomUUID(), sessionId: computer.id, command, ...payload, createdAt: new Date().toISOString() };
    dispatch({ type: "terminal_result", result });
    return result;
  }, [request, state.mode]);

  const stopComputer = useCallback(async (computer: ComputerSession) => {
    if (state.mode === "live") {
      await request<Record<string, never>>(`/v1/computers/${encodeURIComponent(computer.id)}`, { method: "DELETE" });
    }
    dispatch({ type: "remove_computer", id: computer.id });
  }, [request, state.mode]);

  return {
    state,
    dispatch,
    sync,
    uploadArtifact,
    renameArtifact,
    downloadArtifact,
    createComputer,
    updateComputerControl,
    executeCommand,
    stopComputer,
  };
}
