import type { ConnectionMode } from "./relay-state";

export interface ArtifactRecord {
  id: string;
  logicalId: string;
  workspaceId: string;
  version: number;
  parentArtifactId: string | null;
  taskId: string | null;
  runId: string | null;
  agentId: string | null;
  name: string;
  mimeType: string;
  size: number;
  checksum: string;
  storageKey: string;
  provenance: {
    source: "user_upload" | "agent_output" | "sandbox_export";
    createdByType: "user" | "agent" | "system";
    createdById: string;
    originalName: string | null;
  };
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ComputerSession {
  id: string;
  workspaceId: string;
  agentId: string | null;
  taskId: string | null;
  status: string;
  browser: boolean;
  networkAccess: boolean;
  computerUrl: string | null;
  computerHostPort: number | null;
  controlMode: "watch" | "user" | "agent";
  controlHolderId: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalResult {
  id: string;
  sessionId: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  createdAt: string;
}

export interface WorkspaceResourceState {
  artifacts: ArtifactRecord[];
  computers: ComputerSession[];
  terminalResults: TerminalResult[];
  selectedComputerId: string | null;
  loading: boolean;
  error: string | null;
  mode: ConnectionMode;
}

export type WorkspaceResourceAction =
  | { type: "loading"; value: boolean }
  | { type: "error"; message: string | null }
  | { type: "mode"; mode: ConnectionMode }
  | { type: "replace"; artifacts: ArtifactRecord[]; computers: ComputerSession[]; mode: ConnectionMode }
  | { type: "upsert_artifact"; artifact: ArtifactRecord }
  | { type: "upsert_computer"; computer: ComputerSession }
  | { type: "remove_computer"; id: string }
  | { type: "select_computer"; id: string | null }
  | { type: "terminal_result"; result: TerminalResult };

export const demoArtifacts: ArtifactRecord[] = [
  {
    id: "artifact-launch-brief-v1",
    logicalId: "artifact-launch-brief",
    workspaceId: "workspace_local",
    version: 1,
    parentArtifactId: null,
    taskId: "task-launch",
    runId: null,
    agentId: "agent-orbit",
    name: "launch-brief.md",
    mimeType: "text/markdown",
    size: 12_480,
    checksum: "demo-launch-brief-checksum",
    storageKey: "demo/launch-brief.md",
    provenance: { source: "agent_output", createdByType: "agent", createdById: "agent-orbit", originalName: "launch-brief.md" },
    metadata: {},
    createdAt: "2026-08-31T10:25:00.000Z",
    updatedAt: "2026-08-31T10:25:00.000Z",
  },
  {
    id: "artifact-source-matrix-v1",
    logicalId: "artifact-source-matrix",
    workspaceId: "workspace_local",
    version: 1,
    parentArtifactId: null,
    taskId: "task-competitors",
    runId: null,
    agentId: "agent-lumen",
    name: "source-matrix.csv",
    mimeType: "text/csv",
    size: 34_210,
    checksum: "demo-source-matrix-checksum",
    storageKey: "demo/source-matrix.csv",
    provenance: { source: "agent_output", createdByType: "agent", createdById: "agent-lumen", originalName: "source-matrix.csv" },
    metadata: {},
    createdAt: "2026-08-31T10:12:00.000Z",
    updatedAt: "2026-08-31T10:12:00.000Z",
  },
];

export const demoComputers: ComputerSession[] = [
  {
    id: "computer-fabric-demo",
    workspaceId: "workspace_local",
    agentId: "agent-fabric",
    taskId: "task-sandbox",
    status: "running",
    browser: true,
    networkAccess: true,
    computerUrl: null,
    computerHostPort: null,
    controlMode: "agent",
    controlHolderId: "agent-fabric",
    leaseExpiresAt: null,
    createdAt: "2026-08-31T10:02:00.000Z",
    updatedAt: "2026-08-31T10:26:00.000Z",
  },
];

export function createWorkspaceResourceState(): WorkspaceResourceState {
  return {
    artifacts: structuredClone(demoArtifacts),
    computers: structuredClone(demoComputers),
    terminalResults: [],
    selectedComputerId: demoComputers[0]?.id ?? null,
    loading: false,
    error: null,
    mode: "connecting",
  };
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some(({ id }) => id === item.id)
    ? items.map((candidate) => candidate.id === item.id ? item : candidate)
    : [item, ...items];
}

export function workspaceResourceReducer(state: WorkspaceResourceState, action: WorkspaceResourceAction): WorkspaceResourceState {
  switch (action.type) {
    case "loading": return { ...state, loading: action.value };
    case "error": return { ...state, error: action.message, loading: false };
    case "mode": return { ...state, mode: action.mode };
    case "replace":
      return {
        ...state,
        artifacts: action.artifacts,
        computers: action.computers,
        selectedComputerId: state.selectedComputerId && action.computers.some(({ id }) => id === state.selectedComputerId)
          ? state.selectedComputerId
          : (action.computers[0]?.id ?? null),
        loading: false,
        error: null,
        mode: action.mode,
      };
    case "upsert_artifact": return { ...state, artifacts: upsert(state.artifacts, action.artifact), error: null };
    case "upsert_computer": return { ...state, computers: upsert(state.computers, action.computer), selectedComputerId: action.computer.id, error: null };
    case "remove_computer": {
      const computers = state.computers.filter(({ id }) => id !== action.id);
      return { ...state, computers, selectedComputerId: state.selectedComputerId === action.id ? (computers[0]?.id ?? null) : state.selectedComputerId };
    }
    case "select_computer": return { ...state, selectedComputerId: action.id };
    case "terminal_result": return { ...state, terminalResults: [...state.terminalResults, action.result].slice(-60), error: null };
  }
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
