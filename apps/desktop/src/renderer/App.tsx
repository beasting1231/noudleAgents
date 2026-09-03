import { encodeMobilePairingPayload } from "@noudle-agents/protocol";
import type { RelayApiClient } from "@noudle-agents/api-client";
import type {
  Agent,
  Approval,
  Conversation,
  ComposerSettings,
  ConnectorProvider,
  ConnectorSummary,
  CreateCustomConnectorInput,
  CreateAgentInput,
  CreateConversationInput,
  Message,
  MessageResponsePart,
  Run,
  Schedule,
  Task,
} from "@noudle-agents/protocol";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  CalendarClock,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Clock3,
  Command,
  Container,
  Copy,
  CreditCard,
  FileCode2,
  FileText,
  Flame,
  FolderOpen,
  Github,
  Download,
  HardDrive,
  Image,
  Inbox,
  LayoutList,
  LoaderCircle,
  Maximize2,
  Mail,
  Menu,
  MessageCircle,
  MessagesSquare,
  Monitor,
  MoreHorizontal,
  Network,
  PanelRight,
  Pin,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Square,
  Trash2,
  Upload,
  Users,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import QRCode from "qrcode";
import { type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { taskChildren, taskProgress, type DrawerTab } from "./state/relay-state";
import { useRelay } from "./state/use-relay";
import { formatBytes, type ArtifactRecord } from "./state/workspace-resources";
import { useWorkspaceResources } from "./state/use-workspace-resources";
import { useSchedules } from "./state/use-schedules";
import { moveCommandSelection, resolveComposerEnter } from "./slash-commands";
import { ResponseContent } from "./ResponseContent";

type DialogName = "agent" | "approvals" | "connection" | "connectors" | "mobile" | null;

const CONTEXT_WIDTH_KEY = "relay.context.width";
const MIN_CONTEXT_WIDTH = 280;
const MAX_CONTEXT_WIDTH = 720;
const PINNED_AGENTS_KEY = "relay.agents.pinned";
const UNREAD_AGENTS_KEY = "relay.agents.unread";
const FULL_AGENT_CAPABILITIES = [
  "code",
  "terminal",
  "files",
  "browser",
  "web",
  "research",
  "analysis",
  "testing",
  "review",
  "tasks",
  "agents",
  "delegation",
  "artifacts",
  "computer",
  "workflows",
  "monitoring",
];

function storedAgentIds(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function clampContextWidth(width: number, viewportWidth = window.innerWidth): number {
  const navigationWidth = viewportWidth > 1220 ? 640 : viewportWidth > 1040 ? 610 : 48;
  const available = Math.max(MIN_CONTEXT_WIDTH, viewportWidth - navigationWidth);
  return Math.round(Math.min(Math.max(width, MIN_CONTEXT_WIDTH), Math.min(MAX_CONTEXT_WIDTH, available)));
}

function initialContextWidth(): number {
  const stored = Number(window.localStorage.getItem(CONTEXT_WIDTH_KEY));
  return clampContextWidth(Number.isFinite(stored) && stored > 0 ? stored : 338);
}

function withViewTransition(update: () => void): void {
  const documentWithTransitions = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  if (documentWithTransitions.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    documentWithTransitions.startViewTransition(() => flushSync(update));
    return;
  }
  update();
}

const statusLabels: Record<Agent["status"], string> = {
  idle: "Idle",
  queued: "Queued",
  planning: "Planning",
  working: "Working",
  waiting_agent: "Waiting for agent",
  waiting_user: "Needs you",
  blocked: "Blocked",
  paused: "Paused",
  failed: "Failed",
  completed: "Complete",
};

const activeRunStatuses = new Set<Run["status"]>(["queued", "starting", "running", "waiting_approval", "waiting_user"]);
const activeAgentStatuses = new Set<Agent["status"]>(["queued", "planning", "working", "waiting_agent", "waiting_user"]);
const runningAgentStatuses = new Set<Agent["status"]>(["queued", "planning", "working"]);

const taskStatusLabels: Record<Task["status"], string> = {
  draft: "Draft",
  queued: "Queued",
  accepted: "Accepted",
  running: "Running",
  waiting_agent: "Waiting",
  waiting_user: "Needs you",
  blocked: "Blocked",
  paused: "Paused",
  completed: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

function initials(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function timeLabel(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function relativeTime(value: string): string {
  const rawDelta = Date.now() - new Date(value).getTime();
  if (rawDelta < -60_000) {
    const futureMinutes = Math.ceil(Math.abs(rawDelta) / 60_000);
    if (futureMinutes < 60) return `in ${futureMinutes}m`;
    const futureHours = Math.ceil(futureMinutes / 60);
    return futureHours < 24 ? `in ${futureHours}h` : `in ${Math.ceil(futureHours / 24)}d`;
  }
  const delta = Math.max(0, rawDelta);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function Avatar({ agent, size = "normal" }: { agent: Agent; size?: "small" | "normal" | "large" }) {
  return (
    <span className={`avatar avatar--${size}`} style={{ "--agent-color": agent.color } as React.CSSProperties} aria-hidden="true">
      {agent.avatar || initials(agent.name)}
    </span>
  );
}

function StatusDot({ status }: { status: Agent["status"] }) {
  return <span className={`status-dot status-dot--${status}`} aria-hidden="true" />;
}

export function App() {
  const { state, runs, liveResponses, dispatch, client, retry, createAgent, deleteAgent, createConversation, clearConversation, sendMessage, interruptAgent, resolveApproval } = useRelay();
  const resources = useWorkspaceResources(client, state.connection);
  const scheduleResources = useSchedules(client, state.connection, state.cursor);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [contextOpen, setContextOpen] = useState(true);
  const [contextWidth, setContextWidth] = useState(initialContextWidth);
  const [contextResizing, setContextResizing] = useState(false);
  const contextResizeStart = useRef<{ pointerX: number; width: number } | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [demoNoticeDismissed, setDemoNoticeDismissed] = useState(false);
  const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>(() => storedAgentIds(PINNED_AGENTS_KEY));
  const [unreadAgentIds, setUnreadAgentIds] = useState<string[]>(() => storedAgentIds(UNREAD_AGENTS_KEY));
  const [agentMenu, setAgentMenu] = useState<{ agentId: string; x: number; y: number } | null>(null);

  const selectedConversation = state.conversations.find(({ id }) => id === state.selectedConversationId) ?? null;
  const selectedAgent = selectedConversation?.kind === "direct"
    ? state.agents.find(({ id }) => id === selectedConversation.memberAgentIds[0]) ?? null
    : null;
  const selectedRun = selectedConversation && selectedAgent
    ? [...runs].reverse().find((run) => run.conversationId === selectedConversation.id && run.agentId === selectedAgent.id && activeRunStatuses.has(run.status)) ?? null
    : null;
  const selectedTask = state.tasks.find(({ id }) => id === state.selectedTaskId) ?? null;
  const orderedAgents = useMemo(() => state.agents
    .map((agent, index) => ({ agent, index }))
    .sort((left, right) => Number(pinnedAgentIds.includes(right.agent.id)) - Number(pinnedAgentIds.includes(left.agent.id)) || left.index - right.index)
    .map(({ agent }) => agent), [pinnedAgentIds, state.agents]);
  const menuAgent = agentMenu ? state.agents.find(({ id }) => id === agentMenu.agentId) ?? null : null;

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setDialog("agent");
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setDialog(null);
        setAgentMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    window.localStorage.setItem(PINNED_AGENTS_KEY, JSON.stringify(pinnedAgentIds));
  }, [pinnedAgentIds]);

  useEffect(() => {
    window.localStorage.setItem(UNREAD_AGENTS_KEY, JSON.stringify(unreadAgentIds));
  }, [unreadAgentIds]);

  useEffect(() => {
    if (!agentMenu) return;
    const close = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".agent-context-menu")) return;
      setAgentMenu(null);
    };
    const closeOnBlur = () => setAgentMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [agentMenu]);

  useEffect(() => {
    const onResize = () => setContextWidth((width) => clampContextWidth(width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!contextResizing) return;
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const start = contextResizeStart.current;
      if (!start) return;
      setContextWidth(clampContextWidth(start.width + start.pointerX - event.clientX));
    };
    const onPointerUp = () => {
      contextResizeStart.current = null;
      setContextResizing(false);
      setContextWidth((width) => {
        window.localStorage.setItem(CONTEXT_WIDTH_KEY, String(width));
        return width;
      });
    };
    document.body.classList.add("is-resizing-context");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      document.body.classList.remove("is-resizing-context");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [contextResizing]);

  const beginContextResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    contextResizeStart.current = { pointerX: event.clientX, width: contextWidth };
    setContextResizing(true);
  };

  const resizeContextWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = contextWidth + 24;
    if (event.key === "ArrowRight") nextWidth = contextWidth - 24;
    if (event.key === "Home") nextWidth = MIN_CONTEXT_WIDTH;
    if (event.key === "End") nextWidth = MAX_CONTEXT_WIDTH;
    if (nextWidth === null) return;
    event.preventDefault();
    const clamped = clampContextWidth(nextWidth);
    setContextWidth(clamped);
    window.localStorage.setItem(CONTEXT_WIDTH_KEY, String(clamped));
  };

  const openDirectConversation = async (agent: Agent) => {
    const existing = state.conversations.find(
      (conversation) => conversation.kind === "direct" && conversation.memberAgentIds.length === 1 && conversation.memberAgentIds[0] === agent.id,
    );
    if (existing) {
      dispatch({ type: "select_conversation", id: existing.id });
      setRailOpen(false);
      return;
    }
    try {
      await createConversation({ kind: "direct", title: agent.name, memberAgentIds: [agent.id], taskId: null });
      setRailOpen(false);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not start the conversation.");
    }
  };

  return (
    <main
      className={`app-shell ${contextOpen ? "has-context" : ""} ${contextResizing ? "is-resizing" : ""}`}
      style={{ "--context-width": `${contextWidth}px` } as React.CSSProperties}
    >
      <div className="titlebar-drag" aria-hidden="true" />
      <button className={`mobile-backdrop ${railOpen ? "is-open" : ""}`} aria-label="Close navigation" onClick={() => setRailOpen(false)} />

      <aside className={`agent-rail ${railOpen ? "is-open" : ""}`} aria-label="Agent roster">
        <button className="new-agent-icon" aria-label="New agent" title="New agent" onClick={() => setDialog("agent")}>
          <Plus size={18} />
        </button>

        <div className="section-label">
          <span>Agents</span>
        </div>
        <div className="agent-list">
          {orderedAgents.map((agent) => {
            const conversation = state.conversations.find(({ kind, memberAgentIds }) => kind === "direct" && memberAgentIds.length === 1 && memberAgentIds[0] === agent.id);
            const lastMessage = state.messages
              .filter(({ conversationId }) => conversationId === conversation?.id)
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
              .at(-1);
            const active = selectedConversation?.kind === "direct" && selectedConversation.memberAgentIds[0] === agent.id;
            const agentRunning = runningAgentStatuses.has(agent.status);
            return (
              <button
                className={`agent-row ${active ? "active" : ""} ${agentRunning ? "is-running" : ""} ${unreadAgentIds.includes(agent.id) ? "is-unread" : ""}`}
                key={agent.id}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setUnreadAgentIds((ids) => ids.filter((id) => id !== agent.id));
                  void openDirectConversation(agent);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setAgentMenu({
                    agentId: agent.id,
                    x: Math.min(event.clientX, window.innerWidth - 216),
                    y: Math.min(event.clientY, window.innerHeight - 190),
                  });
                }}
              >
                <span className="agent-avatar-wrap">
                  <Avatar agent={agent} />
                  {agentRunning && <StatusDot status={agent.status} />}
                </span>
                <span className="agent-row-copy">
                  <span className="agent-chat-line">
                    {unreadAgentIds.includes(agent.id) && <span className="agent-unread-dot" aria-label="Unread" />}
                    <strong>{agent.name}</strong>
                    <span className="agent-role-chip">{agent.role}</span>
                    {pinnedAgentIds.includes(agent.id) && <Pin className="agent-pin-mark" size={10} fill="currentColor" aria-label="Pinned" />}
                    <time>{timeLabel(conversation?.lastMessageAt ?? lastMessage?.createdAt ?? null)}</time>
                  </span>
                  <span className={`agent-preview ${agentRunning ? "agent-preview--running" : ""}`}>
                    {agentRunning ? statusLabels[agent.status] : lastMessage?.content ?? `${statusLabels[agent.status]} · ${agent.role}`}
                  </span>
                </span>
              </button>
            );
          })}
          {state.agents.length === 0 && (
            <div className="compact-empty"><Bot size={18} /><span>No agents yet</span></div>
          )}
        </div>

        <div className="rail-spacer" />
        <button className="mobile-connect-button" onClick={() => setDialog("mobile")}>
          <Smartphone size={14} /><span>Connect to mobile app</span>
        </button>
        <button className="connector-button" onClick={() => setDialog("connectors")}>
          <Plug size={14} /><span>Connectors</span>
        </button>
        <button className="command-hint" onClick={() => setPaletteOpen(true)}>
          <Search size={14} /><span>Search</span><kbd>⌘ K</kbd>
        </button>
        <button className="connection-row" onClick={() => setDialog("connection")}>
          <span className={`connection-pulse connection-pulse--${state.connection}`} />
          <span>{state.connection === "live" ? "Connected" : state.connection === "demo" ? "Demo workspace" : state.connection}</span>
          <MoreHorizontal size={15} />
        </button>
      </aside>

      <section className="conversation-pane" aria-label="Conversation">
        <ChatHeader
          conversation={selectedConversation}
          agent={selectedAgent}
          contextOpen={contextOpen}
          onOpenRail={() => setRailOpen(true)}
          onContext={() => setContextOpen((open) => !open)}
        />

        {state.connectionMessage && !demoNoticeDismissed && (
          <div className={`connection-banner connection-banner--${state.connection}`}>
            {state.connection === "offline" ? <WifiOff size={15} /> : state.connection === "error" ? <CircleAlert size={15} /> : <Sparkles size={15} />}
            <span>{state.connectionMessage}</span>
            {(state.connection === "offline" || state.connection === "error") && <button onClick={() => void retry()}><RefreshCw size={13} /> Retry</button>}
            {state.connection === "demo" && <button className="banner-close" aria-label="Dismiss demo notice" onClick={() => setDemoNoticeDismissed(true)}><X size={14} /></button>}
          </div>
        )}

        {selectedConversation ? (
          <Chat
            conversation={selectedConversation}
            agent={selectedAgent}
            activeRun={selectedRun}
            liveParts={selectedRun ? liveResponses[selectedRun.id] : undefined}
            messages={state.messages.filter(({ conversationId }) => conversationId === selectedConversation.id)}
            demoMode={state.connection === "demo"}
            client={client}
            onRetry={retry}
            onClear={async () => {
              try {
                await clearConversation(selectedConversation);
                setToast("Chat cleared");
              } catch (error) {
                setToast(error instanceof Error ? error.message : "Chat could not be cleared.");
              }
            }}
            onSend={async (content, settings, attachmentIds) => {
              const agentId = selectedConversation.memberAgentIds[0];
              if (!agentId) return;
              try {
                await sendMessage(selectedConversation.id, content, agentId, settings, attachmentIds);
              } catch (error) {
                setToast(error instanceof Error ? error.message : "Message was not sent.");
              }
            }}
            onUploadAttachment={(file) => resources.uploadArtifact(file, selectedAgent ? { agentId: selectedAgent.id } : {})}
            onStop={async () => {
              if (!selectedAgent) return;
              try {
                await interruptAgent(selectedConversation.id, selectedAgent.id);
              } catch (error) {
                setToast(error instanceof Error ? error.message : "Could not stop the agent.");
              }
            }}
          />
        ) : (
          <EmptyConversation />
        )}
      </section>

      <ContextDrawer
        open={contextOpen}
        tab={state.drawerTab}
        onTab={(tab) => dispatch({ type: "drawer_tab", tab })}
        onClose={() => setContextOpen(false)}
        task={selectedTask}
        agentId={selectedAgent?.id ?? null}
        agents={state.agents}
        resources={resources}
        scheduleResources={scheduleResources}
        width={contextWidth}
        resizing={contextResizing}
        onResizeStart={beginContextResize}
        onResizeKeyDown={resizeContextWithKeyboard}
      />

      {dialog === "agent" && (
        <NewAgentDialog
          onClose={() => setDialog(null)}
          onCreate={async (input) => {
            await createAgent(input);
            setDialog(null);
            setToast("Agent created");
          }}
        />
      )}
      {dialog === "approvals" && (
        <ApprovalsDialog
          approvals={state.approvals}
          agents={state.agents}
          onClose={() => setDialog(null)}
          onResolve={async (approval, decision) => {
            try {
              await resolveApproval(approval, decision);
              setToast(decision === "approve" ? "Action approved" : "Action denied");
            } catch (error) {
              setToast(error instanceof Error ? error.message : "Approval could not be resolved.");
            }
          }}
        />
      )}
      {dialog === "connection" && (
        <ConnectionDialog
          clientUrl={client.baseUrl}
          clientToken={client.token}
          mode={state.connection}
          onClose={() => setDialog(null)}
          onRetry={() => { setDialog(null); void retry(); }}
          onSave={(url, token) => {
            localStorage.setItem("relay.apiUrl", url.replace(/\/$/, ""));
            localStorage.setItem("relay.apiToken", token);
            window.location.reload();
          }}
        />
      )}
      {dialog === "connectors" && <ConnectorsDialog client={client} agents={state.agents} onClose={() => setDialog(null)} />}
      {dialog === "mobile" && <MobilePairingDialog clientUrl={client.baseUrl} clientToken={client.token} onClose={() => setDialog(null)} />}
      {paletteOpen && (
        <CommandPalette
          agents={state.agents}
          onClose={() => setPaletteOpen(false)}
          onNewAgent={() => { setPaletteOpen(false); setDialog("agent"); }}
          onApprovals={() => { setPaletteOpen(false); setDialog("approvals"); }}
          onSelectAgent={(agent) => { setPaletteOpen(false); void openDirectConversation(agent); }}
        />
      )}
      {agentMenu && menuAgent && createPortal(
        <div className="agent-context-menu" role="menu" aria-label={`${menuAgent.name} actions`} style={{ left: agentMenu.x, top: agentMenu.y }}>
          <button role="menuitem" onClick={() => {
            setPinnedAgentIds((ids) => ids.includes(menuAgent.id) ? ids.filter((id) => id !== menuAgent.id) : [menuAgent.id, ...ids]);
            setAgentMenu(null);
          }}><Pin size={15} />{pinnedAgentIds.includes(menuAgent.id) ? "Unpin" : "Pin"}</button>
          <button role="menuitem" onClick={() => {
            setUnreadAgentIds((ids) => ids.includes(menuAgent.id) ? ids : [...ids, menuAgent.id]);
            setAgentMenu(null);
          }}><Mail size={15} />Mark as unread</button>
          <button role="menuitem" onClick={async () => {
            setAgentMenu(null);
            try {
              await createAgent({
                name: `${menuAgent.name} copy`,
                role: menuAgent.role,
                description: menuAgent.description,
                instructions: menuAgent.instructions,
                avatar: menuAgent.avatar,
                color: menuAgent.color,
                capabilities: menuAgent.capabilities,
              });
              setToast(`${menuAgent.name} duplicated`);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "Agent could not be duplicated.");
            }
          }}><Copy size={15} />Duplicate</button>
          <div className="agent-context-separator" />
          <button className="danger" role="menuitem" onClick={async () => {
            setAgentMenu(null);
            try {
              await deleteAgent(menuAgent.id);
              setPinnedAgentIds((ids) => ids.filter((id) => id !== menuAgent.id));
              setUnreadAgentIds((ids) => ids.filter((id) => id !== menuAgent.id));
              setToast(`${menuAgent.name} deleted`);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "Agent could not be deleted.");
            }
          }}><Trash2 size={15} />Delete</button>
        </div>,
        document.body,
      )}
      {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}

function ConversationList({ conversations, messages, selectedId, onSelect }: {
  conversations: Conversation[];
  messages: Message[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = [...conversations].sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
  if (sorted.length === 0) return <div className="panel-empty"><MessagesSquare size={22} /><strong>No conversations</strong><span>Start with an agent or create a group.</span></div>;
  return (
    <div className="conversation-list">
      <div className="section-label"><span>Recent</span><span>{sorted.length}</span></div>
      {sorted.map((conversation) => {
        const last = [...messages].reverse().find(({ conversationId }) => conversationId === conversation.id);
        return (
          <button className={`conversation-row ${selectedId === conversation.id ? "active" : ""}`} key={conversation.id} onClick={() => onSelect(conversation.id)}>
            <span className={`conversation-icon conversation-icon--${conversation.kind}`}>
              {conversation.kind === "group" ? <Users size={15} /> : <MessageCircle size={15} />}
            </span>
            <span className="conversation-copy">
              <span className="conversation-title-line"><strong>{conversation.title}</strong><time>{timeLabel(conversation.lastMessageAt)}</time></span>
              <span className="conversation-preview">{last?.content ?? "No messages yet"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TaskList({ tasks, agents, selectedId, onSelect }: { tasks: Task[]; agents: Agent[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const roots = taskChildren(tasks, null);
  if (roots.length === 0) return <div className="panel-empty"><LayoutList size={22} /><strong>No active tasks</strong><span>Ask an agent to turn an objective into work.</span></div>;
  return (
    <div className="task-list">
      <div className="section-label"><span>Task graph</span><span>{tasks.length}</span></div>
      {roots.map((task) => <TaskTreeItem key={task.id} task={task} tasks={tasks} agents={agents} selectedId={selectedId} onSelect={onSelect} />)}
    </div>
  );
}

function TaskTreeItem({ task, tasks, agents, selectedId, onSelect }: { task: Task; tasks: Task[]; agents: Agent[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const children = taskChildren(tasks, task.id);
  const [open, setOpen] = useState(true);
  const owner = agents.find(({ id }) => id === task.ownerAgentId);
  const progress = taskProgress(tasks, task.id);
  return (
    <div className={`task-tree task-tree--depth-${Math.min(task.depth, 3)}`}>
      <div className={`task-row ${selectedId === task.id ? "active" : ""}`}>
        <button className="tree-toggle" aria-label={open ? "Collapse delegated tasks" : "Expand delegated tasks"} disabled={children.length === 0} onClick={() => setOpen((value) => !value)}>
          {children.length > 0 ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <CircleDot size={8} />}
        </button>
        <button className="task-main" onClick={() => onSelect(task.id)}>
          <span className="task-title">{task.title}</span>
          <span className="task-meta">
            <span className={`task-state task-state--${task.status}`}>{taskStatusLabels[task.status]}</span>
            {owner && <span>{owner.name}</span>}
            {children.length > 0 && <span>{progress.complete}/{progress.total}</span>}
          </span>
        </button>
      </div>
      {open && children.map((child) => <TaskTreeItem key={child.id} task={child} tasks={tasks} agents={agents} selectedId={selectedId} onSelect={onSelect} />)}
    </div>
  );
}

function ChatHeader({ conversation, agent, contextOpen, onOpenRail, onContext }: {
  conversation: Conversation | null;
  agent: Agent | null;
  contextOpen: boolean;
  onOpenRail: () => void;
  onContext: () => void;
}) {
  return (
    <header className="chat-header">
      <button className="icon-button nav-trigger nav-trigger--rail" aria-label="Open agents" onClick={onOpenRail}><Menu size={18} /></button>
      <div className="chat-title-block">
        <strong>{conversation?.title ?? "Workspace"}</strong>
        {agent && (
          <span className={`chat-agent-status chat-agent-status--${agent.status}`} role="status" aria-live="polite">
            <StatusDot status={agent.status} />
            {statusLabels[agent.status]}
          </span>
        )}
      </div>
      <button className={`icon-button ${contextOpen ? "active" : ""}`} aria-label={contextOpen ? "Close context" : "Open context"} aria-pressed={contextOpen} onClick={onContext}><PanelRight size={17} /></button>
    </header>
  );
}

const COMPOSER_MODELS: Array<{ value: ComposerSettings["model"]; label: string; shortLabel: string }> = [
  { value: "gpt-5.6-sol", label: "OpenAI · GPT-5.6 Sol", shortLabel: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "OpenAI · GPT-5.6 Terra", shortLabel: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "OpenAI · GPT-5.6 Luna", shortLabel: "GPT-5.6 Luna" },
];
const REASONING_OPTIONS: Array<{ value: ComposerSettings["reasoning"]; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];
const SPEED_OPTIONS: Array<{ value: ComposerSettings["speed"]; label: string }> = [
  { value: "balanced", label: "Standard" },
  { value: "extra-fast", label: "Extra Fast" },
];
const DEFAULT_COMPOSER_SETTINGS: ComposerSettings = {
  model: "gpt-5.6-sol",
  reasoning: "medium",
  speed: "balanced",
};

const SLASH_COMMANDS = [
  { value: "/clear", label: "Clear chat", icon: RotateCcw },
  { value: "/stop", label: "Stop agent", icon: Square },
] as const;

function readComposerSettings(conversationId: string): ComposerSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(`relay.composer.${conversationId}`) ?? "null") as Partial<ComposerSettings> | null;
    return {
      model: COMPOSER_MODELS.some(({ value }) => value === stored?.model) ? stored!.model! : DEFAULT_COMPOSER_SETTINGS.model,
      reasoning: REASONING_OPTIONS.some(({ value }) => value === stored?.reasoning) ? stored!.reasoning! : DEFAULT_COMPOSER_SETTINGS.reasoning,
      speed: SPEED_OPTIONS.some(({ value }) => value === stored?.speed) ? stored!.speed! : DEFAULT_COMPOSER_SETTINGS.speed,
    };
  } catch {
    return DEFAULT_COMPOSER_SETTINGS;
  }
}

function Chat({ conversation, agent, activeRun, liveParts, messages, demoMode, client, onRetry, onClear, onSend, onStop, onUploadAttachment }: {
  conversation: Conversation;
  agent: Agent | null;
  activeRun: Run | null;
  liveParts: MessageResponsePart[] | undefined;
  messages: Message[];
  demoMode: boolean;
  client: RelayApiClient;
  onRetry: () => Promise<boolean>;
  onClear: () => Promise<void>;
  onSend: (content: string, settings: ComposerSettings, attachmentIds: string[]) => Promise<void>;
  onStop: () => Promise<void>;
  onUploadAttachment: (file: File) => Promise<ArtifactRecord>;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [settings, setSettings] = useState<ComposerSettings>(() => readComposerSettings(conversation.id));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"model" | "reasoning" | "speed" | null>(null);
  const [commandIndex, setCommandIndex] = useState<number | null>(null);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ artifact: ArtifactRecord; previewUrl: string | null }>>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<{ url: string; name: string } | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const ordered = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const showDockerAction = demoMode && ordered.at(-1)?.role === "user";
  const agentRunning = Boolean(activeRun) || Boolean(agent && activeAgentStatuses.has(agent.status));
  const activityLabel = activeRun?.status === "queued" || activeRun?.status === "starting"
    ? "Thinking"
    : activeRun?.status === "running"
      ? liveParts?.some((part) => part.type === "tool" || part.text.trim()) ? "Working" : "Thinking"
      : !activeRun && (agent?.status === "queued" || agent?.status === "planning")
        ? "Thinking"
        : !activeRun && agent?.status === "working"
          ? "Working"
          : null;
  const showStop = agentRunning && !value.trim() && attachments.length === 0;
  const commandQuery = value.startsWith("/") && !value.slice(1).includes(" ") && !value.includes("\n")
    ? value.slice(1).toLowerCase()
    : null;
  const matchingCommands = commandQuery === null
    ? []
    : SLASH_COMMANDS.filter(({ value: command }) => command.slice(1).startsWith(commandQuery));
  const commandMenuOpen = !commandDismissed && matchingCommands.length > 0;

  useEffect(() => {
    setSettings(readComposerSettings(conversation.id));
    setSettingsOpen(false);
    setSubmenu(null);
    setCommandDismissed(false);
    setCommandIndex(null);
    setAttachmentMenuOpen(false);
    setAttachments((current) => {
      current.forEach(({ previewUrl }) => { if (previewUrl) URL.revokeObjectURL(previewUrl); });
      return [];
    });
  }, [conversation.id]);

  useEffect(() => {
    if (commandIndex === null || commandIndex < matchingCommands.length) return;
    setCommandIndex(null);
  }, [commandIndex, matchingCommands.length]);

  useEffect(() => {
    localStorage.setItem(`relay.composer.${conversation.id}`, JSON.stringify(settings));
  }, [conversation.id, settings]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
        setSubmenu(null);
        setAttachmentMenuOpen(false);
      }
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setSubmenu(null);
        setAttachmentMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [value]);

  useLayoutEffect(() => {
    const container = messageScrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [conversation.id, ordered.length, ordered.at(-1)?.content, liveParts]);

  const addFiles = async (files: File[]) => {
    const available = files.filter((file) => file.size > 0).slice(0, Math.max(0, 10 - attachments.length));
    if (available.length === 0 || attachmentBusy) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
    setAttachmentMenuOpen(false);
    try {
      for (const file of available) {
        const artifact = await onUploadAttachment(file);
        setAttachments((current) => [...current, { artifact, previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null }]);
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Attachment could not be uploaded.");
    } finally {
      setAttachmentBusy(false);
    }
  };
  const removeAttachment = (id: string) => setAttachments((current) => {
    const removed = current.find(({ artifact }) => artifact.id === id);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    return current.filter(({ artifact }) => artifact.id !== id);
  });
  const submit = async (contentOverride?: string) => {
    const content = (contentOverride ?? value).trim();
    if ((!content && attachments.length === 0) || sending || attachmentBusy) return;
    const sentAttachments = attachments;
    setValue("");
    setCommandDismissed(false);
    setCommandIndex(null);
    setSending(true);
    try {
      if (content.toLowerCase() === "/clear" && sentAttachments.length === 0) await onClear();
      else if (content.toLowerCase() === "/stop" && sentAttachments.length === 0) await onStop();
      else await onSend(content, settings, sentAttachments.map(({ artifact }) => artifact.id));
      setAttachments([]);
      sentAttachments.forEach(({ previewUrl }) => { if (previewUrl) URL.revokeObjectURL(previewUrl); });
    } finally { setSending(false); }
  };
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setCommandIndex((index) => moveCommandSelection(index, direction, matchingCommands.length));
      return;
    }
    if (commandMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setCommandDismissed(true);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const action = resolveComposerEnter(value, commandMenuOpen, matchingCommands.map(({ value: command }) => command), commandIndex);
      if (action.type === "submit-command") void submit(action.value);
      if (action.type === "submit-message") void submit();
    }
  };
  const stop = async () => {
    if (!agentRunning || stopping) return;
    setStopping(true);
    try { await onStop(); } finally { setStopping(false); }
  };

  return (
    <div className="chat-body">
      <div className="message-scroll" ref={messageScrollRef} aria-live="polite">
        {ordered.length === 0 && !activityLabel && (
          <div className="chat-start">
            <div className="chat-start-mark"><MessageCircle size={20} /></div>
            <h2>Start with an objective</h2>
            <p>{conversation.kind === "group" ? "The agents in this room can coordinate and delegate work to each other." : "Describe the outcome. The agent will keep the task state and context here."}</p>
          </div>
        )}
        <div className="message-column">
          {ordered.map((message) => <MessageItem key={message.id} message={message} client={client} onOpenImage={setFullscreenImage} />)}
          {liveParts?.length ? <article className="message message--agent message--streaming"><ResponseContent content={liveParts.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n\n")} parts={liveParts} /></article> : null}
          {activityLabel ? <div className="run-activity" role="status" aria-live="polite"><span>{activityLabel}</span></div> : null}
          {showDockerAction && <DockerStartCard onRetry={onRetry} />}
        </div>
      </div>
      <div className="composer-wrap">
        <div className="composer" ref={composerRef}>
          <div className={`slash-command-menu ${commandMenuOpen ? "is-open" : ""}`} id="slash-command-menu" role="listbox" aria-label="Commands" aria-hidden={!commandMenuOpen} inert={!commandMenuOpen}>
            {matchingCommands.map((command, index) => {
              const Icon = command.icon;
              return <button type="button" role="option" aria-selected={index === commandIndex} className={index === commandIndex ? "is-active" : ""} key={command.value} onClick={() => { void submit(command.value); }}><Icon size={15} /><code>{command.value}</code><span>{command.label}</span></button>;
            })}
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => { setValue(event.target.value); setCommandDismissed(false); setCommandIndex(null); }}
            onKeyDown={onComposerKeyDown}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
              if (files.length > 0) { event.preventDefault(); void addFiles(files); }
            }}
            placeholder="Ask anything"
            rows={1}
            aria-label={`Message ${conversation.title}`}
            aria-controls="slash-command-menu"
            aria-expanded={commandMenuOpen}
          />
          {attachments.length > 0 && <div className="composer-attachments">{attachments.map(({ artifact, previewUrl }) => previewUrl ? (
            <div className="composer-image-attachment" key={artifact.id}>
              <button type="button" className="composer-image-open" aria-label={`Open ${artifact.name} fullscreen`} onClick={() => setFullscreenImage({ url: previewUrl, name: artifact.name })}><img src={previewUrl} alt={artifact.name} /></button>
              <button type="button" className="composer-image-remove" aria-label={`Remove ${artifact.name}`} onClick={() => removeAttachment(artifact.id)}><X size={13} /></button>
            </div>
          ) : <div className="composer-attachment" key={artifact.id}><FileText size={17} /><span><strong>{artifact.name}</strong><small>{formatBytes(artifact.size)}</small></span><button type="button" aria-label={`Remove ${artifact.name}`} onClick={() => removeAttachment(artifact.id)}><X size={13} /></button></div>)}</div>}
          {attachmentError && <div className="composer-attachment-error">{attachmentError}</div>}
          <div className="composer-bottom">
            <div className="composer-tools">
              <div className={`composer-attach ${attachmentMenuOpen ? "is-open" : ""}`}>
                <button className="composer-plus" type="button" aria-label="Add attachment" aria-haspopup="menu" aria-expanded={attachmentMenuOpen} disabled={attachmentBusy || attachments.length >= 10} onClick={() => { setAttachmentMenuOpen((open) => !open); setSettingsOpen(false); }}><Plus size={17} /></button>
                <div className="composer-attach-menu" role="menu" aria-hidden={!attachmentMenuOpen}>
                  <button type="button" role="menuitem" onClick={() => cameraInputRef.current?.click()}><Camera size={16} /><span>Camera</span></button>
                  <button type="button" role="menuitem" onClick={() => photosInputRef.current?.click()}><Image size={16} /><span>Photos</span></button>
                  <button type="button" role="menuitem" onClick={() => filesInputRef.current?.click()}><FileText size={16} /><span>Files</span></button>
                </div>
                <input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
                <input ref={photosInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
                <input ref={filesInputRef} hidden type="file" multiple onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
              </div>
              <div className={`composer-settings ${settingsOpen ? "is-open" : ""}`}>
                <button
                  className="composer-settings-pill"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={settingsOpen}
                  onClick={() => { setSettingsOpen((open) => !open); setSubmenu(null); }}
                >
                  {settings.speed === "extra-fast" && <Zap className="composer-speed-icon" size={13} fill="currentColor" />}
                  <strong>{COMPOSER_MODELS.find(({ value }) => value === settings.model)?.shortLabel}</strong>
                  <span>{REASONING_OPTIONS.find(({ value }) => value === settings.reasoning)?.label}</span>
                  <ChevronDown className="composer-chevron" size={13} />
                </button>

              <div className="composer-settings-menu" role="menu" aria-hidden={!settingsOpen}>
                <ComposerSettingsRow label="Model" value={COMPOSER_MODELS.find(({ value }) => value === settings.model)?.shortLabel ?? ""} active={submenu === "model"} onOpen={() => setSubmenu(submenu === "model" ? null : "model")} />
                <ComposerSettingsRow label="Effort" value={REASONING_OPTIONS.find(({ value }) => value === settings.reasoning)?.label ?? ""} active={submenu === "reasoning"} onOpen={() => setSubmenu(submenu === "reasoning" ? null : "reasoning")} />
                <ComposerSettingsRow label="Speed" value={SPEED_OPTIONS.find(({ value }) => value === settings.speed)?.label ?? ""} active={submenu === "speed"} onOpen={() => setSubmenu(submenu === "speed" ? null : "speed")} />

                <ComposerOptionsPanel open={submenu === "model"} wide>
                  {COMPOSER_MODELS.map((option) => <ComposerOption key={option.value} label={option.label} selected={settings.model === option.value} onClick={() => { setSettings({ ...settings, model: option.value }); setSettingsOpen(false); setSubmenu(null); }} />)}
                </ComposerOptionsPanel>
                <ComposerOptionsPanel open={submenu === "reasoning"}>
                  {REASONING_OPTIONS.map((option) => <ComposerOption key={option.value} label={option.label} selected={settings.reasoning === option.value} onClick={() => { setSettings({ ...settings, reasoning: option.value }); setSettingsOpen(false); setSubmenu(null); }} />)}
                </ComposerOptionsPanel>
                <ComposerOptionsPanel open={submenu === "speed"}>
                  {SPEED_OPTIONS.map((option) => <ComposerOption key={option.value} label={option.label} selected={settings.speed === option.value} onClick={() => { setSettings({ ...settings, speed: option.value }); setSettingsOpen(false); setSubmenu(null); }} />)}
                </ComposerOptionsPanel>
              </div>
              </div>
            </div>
            <button
              className={`send-button ${showStop ? "send-button--stop" : ""}`}
              disabled={showStop ? stopping : (!value.trim() && attachments.length === 0) || sending || attachmentBusy}
              onClick={() => showStop ? void stop() : void submit()}
              aria-label={showStop ? "Stop agent" : "Send message"}
              title={showStop ? "Stop agent" : "Send message"}
            >
              {showStop ? <Square size={11} fill="currentColor" /> : <ArrowUp size={16} strokeWidth={2.4} />}
            </button>
          </div>
        </div>
      </div>
      {fullscreenImage && createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={fullscreenImage.name} onClick={() => setFullscreenImage(null)}><img src={fullscreenImage.url} alt={fullscreenImage.name} /><button type="button" aria-label="Close fullscreen image" onClick={() => setFullscreenImage(null)}><X size={22} /></button></div>, document.body)}
    </div>
  );
}

function DockerStartCard({ onRetry }: { onRetry: () => Promise<boolean> }) {
  const [state, setState] = useState<"idle" | "starting" | "started" | "already-running" | "failed">("idle");
  const [message, setMessage] = useState("The live agent service needs Docker Desktop.");

  const start = async () => {
    if (state === "starting") return;
    if (!window.relayDesktop?.docker) {
      setState("failed");
      setMessage("Docker can only be started from the desktop app.");
      return;
    }

    setState("starting");
    setMessage("Checking Docker…");
    const result = await window.relayDesktop.docker.start();
    setState(result.status === "unsupported" ? "failed" : result.status);
    setMessage(result.message);

    if (result.status === "started") {
      [4_000, 10_000, 20_000].forEach((delay) => {
        window.setTimeout(() => void onRetry(), delay);
      });
    }
  };

  const settled = state === "started" || state === "already-running";
  return (
    <aside className={`docker-start-card docker-start-card--${state}`} role="status">
      <span className="docker-start-icon"><Container size={18} /></span>
      <span className="docker-start-copy">
        <strong>{state === "already-running" ? "Docker is running" : state === "started" ? "Starting Docker" : "Start live agents"}</strong>
        <small>{message}</small>
      </span>
      <button type="button" onClick={() => void start()} disabled={state === "starting" || settled}>
        {state === "starting" && <LoaderCircle className="spin" size={13} />}
        {state === "starting" ? "Starting" : settled ? "Done" : "Start Docker"}
      </button>
    </aside>
  );
}

function ComposerSettingsRow({ label, value, active, onOpen }: { label: string; value: string; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" role="menuitem" className={`composer-settings-row ${active ? "is-active" : ""}`} onClick={onOpen}>
      <span>{label}</span><em>{value}</em><ChevronRight size={14} />
    </button>
  );
}

function ComposerOptionsPanel({ open, wide = false, children }: { open: boolean; wide?: boolean; children: React.ReactNode }) {
  return <div className={`composer-options-panel ${wide ? "is-wide" : ""} ${open ? "is-open" : ""}`} role="menu" aria-hidden={!open}>{children}</div>;
}

function ComposerOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return <button type="button" role="menuitemradio" aria-checked={selected} className={`composer-option ${selected ? "is-selected" : ""}`} onClick={onClick}><span>{label}</span>{selected && <Check size={14} />}</button>;
}

function MessageImageAttachment({ artifactId, name, client, onOpen }: { artifactId: string; name: string; client: RelayApiClient; onOpen: (image: { url: string; name: string }) => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void fetch(`${client.baseUrl}/v1/artifacts/${encodeURIComponent(artifactId)}/download`, {
      headers: { authorization: `Bearer ${client.token}` },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Image download failed (${response.status})`);
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactId, client]);

  return url ? <button type="button" className="message-image-attachment" aria-label={`Open ${name} fullscreen`} onClick={() => onOpen({ url, name })}><img src={url} alt={name} /></button> : <div className="message-image-placeholder" aria-label={`Loading ${name}`} />;
}

function MessageItem({ message, client, onOpenImage }: { message: Message; client: RelayApiClient; onOpenImage: (image: { url: string; name: string }) => void }) {
  const imageOnly = Boolean(message.attachments?.length) && !message.content && message.attachments!.every(({ mimeType }) => mimeType.startsWith("image/"));
  return (
    <article className={`message message--${message.role} ${imageOnly ? "message--image-only" : ""}`}>
      {message.attachments?.length ? <div className="message-attachments">{message.attachments.map((attachment) => attachment.mimeType.startsWith("image/")
        ? <MessageImageAttachment artifactId={attachment.artifactId} name={attachment.name} client={client} onOpen={onOpenImage} key={attachment.artifactId} />
        : <div className="message-attachment" key={attachment.artifactId}><FileText size={15} /><span>{attachment.name}</span></div>)}</div> : null}
      {message.content ? message.role === "agent" ? <ResponseContent content={message.content} parts={message.responseParts} /> : <p>{message.content}</p> : null}
    </article>
  );
}

function EmptyConversation() {
  return (
    <div className="main-empty">
      <div className="empty-orbit"><Network size={24} /></div>
      <h1>Choose an agent.</h1>
      <p>Select an agent from the left to open its conversation.</p>
    </div>
  );
}

function ContextDrawer({ open, tab, onTab, onClose, task, agentId, agents, resources, scheduleResources, width, resizing, onResizeStart, onResizeKeyDown }: {
  open: boolean;
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  onClose: () => void;
  task: Task | null;
  agentId: string | null;
  agents: Agent[];
  resources: ReturnType<typeof useWorkspaceResources>;
  scheduleResources: ReturnType<typeof useSchedules>;
  width: number;
  resizing: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const tabs: Array<{ id: DrawerTab; label: string; icon: typeof LayoutList }> = [
    { id: "computer", label: "Computer", icon: Monitor },
    { id: "files", label: "File system", icon: FolderOpen },
  ];
  const activeTab: DrawerTab = tab === "files" ? "files" : "computer";
  return (
    <aside className={`context-drawer ${open ? "is-open" : ""}`} aria-label="Context" aria-hidden={!open} inert={!open}>
      <div
        className={`context-resize-handle ${resizing ? "is-active" : ""}`}
        role="separator"
        aria-label="Resize context panel"
        aria-orientation="vertical"
        aria-valuemin={MIN_CONTEXT_WIDTH}
        aria-valuemax={MAX_CONTEXT_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      ><span /></div>
      <header className="context-header"><button className="icon-button" aria-label="Close context" onClick={onClose}><X size={16} /></button></header>
      <div className="context-tabs" role="tablist" aria-label="Context sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={activeTab === id} aria-label={label} title={label} className={activeTab === id ? "active" : ""} onClick={() => onTab(id)}><Icon size={16} /></button>
        ))}
      </div>
      <div className="context-content">
        {activeTab === "files" && <FilesContext resources={resources} task={task} agents={agents} />}
        {activeTab === "computer" && <div className="computer-tab-content"><ComputerContext resources={resources} agentId={agentId} /><SchedulesContext schedules={scheduleResources} agentId={agentId} agents={agents} /></div>}
      </div>
    </aside>
  );
}

function scheduleCadence(expression: string): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/);
  if (minute?.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every ${minute.slice(2)} minutes`;
  }
  const numericMinute = Number(minute);
  const numericHour = Number(hour);
  const time = Number.isInteger(numericMinute) && Number.isInteger(numericHour)
    ? `${String(numericHour).padStart(2, "0")}:${String(numericMinute).padStart(2, "0")}`
    : null;
  if (time && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") return `Daily at ${time}`;
  if (time && dayOfMonth === "*" && month === "*" && dayOfWeek) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = dayOfWeek.split(",").map((value) => {
      const range = value.split("-");
      if (range.length === 2) {
        const from = Number(range[0]);
        const to = Number(range[1]);
        if (Number.isInteger(from) && Number.isInteger(to)) return `${names[from === 7 ? 0 : from] ?? from}–${names[to === 7 ? 0 : to] ?? to}`;
      }
      return names[Number(value) === 7 ? 0 : Number(value)] ?? value;
    }).join(" + ");
    return `${days} at ${time}`;
  }
  return expression;
}

function SchedulesContext({ schedules: resource, agentId, agents }: {
  schedules: ReturnType<typeof useSchedules>;
  agentId: string | null;
  agents: Agent[];
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const visible = resource.schedules
    .filter((schedule) => !agentId || schedule.agentId === agentId)
    .sort((left, right) => (left.nextRunAt ?? "z").localeCompare(right.nextRunAt ?? "z"));
  const selected = editing && editing !== "new" ? resource.schedules.find(({ id }) => id === editing) ?? null : null;
  const defaultAgentId = agentId ?? agents[0]?.id ?? "";

  const toggle = async (schedule: Schedule) => {
    setBusy(schedule.id); setLocalError(null);
    try { await resource.updateSchedule(schedule.id, { enabled: !schedule.enabled }); }
    catch (error) { setLocalError(error instanceof Error ? error.message : "Schedule could not be updated."); }
    finally { setBusy(null); }
  };

  return (
    <section className="schedules-section" aria-label="Schedules">
      <header className="schedules-heading">
        <button disabled={!defaultAgentId} onClick={() => setEditing("new")} aria-label="New automation" title="New automation"><Plus size={14} /></button>
      </header>
      {(localError || resource.error) && <div className="resource-error"><CircleAlert size={13} /><span>{localError ?? resource.error}</span></div>}
      {resource.loading ? <div className="schedule-loading"><LoaderCircle className="spin" size={14} /> Loading schedules</div> : visible.length === 0 ? (
        <button className="schedule-empty" onClick={() => setEditing("new")} disabled={!defaultAgentId}><CalendarClock size={18} /><span><strong>No scheduled jobs</strong><small>Ask this agent, or add one here.</small></span></button>
      ) : (
        <div className="schedule-list">
          {visible.map((schedule) => (
            <article className={`schedule-card ${schedule.enabled ? "is-enabled" : "is-disabled"}`} key={schedule.id}>
              <button className="schedule-card-body" onClick={() => setEditing(schedule.id)} aria-label={`Configure ${schedule.title}`}>
                <span className="schedule-mark">{schedule.triggerType === "webhook" ? <Zap size={14} /> : <CalendarClock size={14} />}</span>
                <span className="schedule-copy"><strong>{schedule.title}</strong><small>{schedule.triggerType === "webhook" ? "Webhook · POST" : `${scheduleCadence(schedule.cronExpression)} · ${schedule.timezone}`}</small><em>{!schedule.enabled ? "Paused" : schedule.triggerType === "webhook" ? "Waiting for request" : schedule.nextRunAt ? `Next ${relativeTime(schedule.nextRunAt)}` : "Scheduled"}</em></span>
              </button>
              <button
                className={`schedule-toggle ${schedule.enabled ? "is-on" : ""}`}
                role="switch"
                aria-checked={schedule.enabled}
                aria-label={`${schedule.enabled ? "Disable" : "Enable"} ${schedule.title}`}
                disabled={busy === schedule.id}
                onClick={() => void toggle(schedule)}
              ><span /></button>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <ScheduleEditor
          key={selected?.id ?? "new"}
          schedule={selected}
          agentId={defaultAgentId}
          agents={agents}
          webhookUrl={selected ? resource.webhookUrl(selected) : null}
          busy={busy === (selected?.id ?? "new")}
          onCancel={() => { setEditing(null); setLocalError(null); }}
          onSave={async (input) => {
            setBusy(selected?.id ?? "new"); setLocalError(null);
            try {
              if (selected) await resource.updateSchedule(selected.id, input);
              else await resource.createSchedule({ ...input, agentId: input.agentId ?? defaultAgentId, title: input.title ?? "", prompt: input.prompt ?? "", cronExpression: input.cronExpression ?? "0 9 * * *" });
              setEditing(null);
            } catch (error) { setLocalError(error instanceof Error ? error.message : "Schedule could not be saved."); }
            finally { setBusy(null); }
          }}
          {...(selected ? { onDelete: async () => {
            setBusy(selected.id); setLocalError(null);
            try { await resource.deleteSchedule(selected.id); setEditing(null); }
            catch (error) { setLocalError(error instanceof Error ? error.message : "Schedule could not be deleted."); }
            finally { setBusy(null); }
          } } : {})}
        />
      )}
    </section>
  );
}

function ScheduleEditor({ schedule, agentId, agents, webhookUrl, busy, onCancel, onSave, onDelete }: {
  schedule: Schedule | null;
  agentId: string;
  agents: Agent[];
  webhookUrl: string | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { triggerType: "cron" | "webhook"; title: string; prompt: string; cronExpression: string; timezone: string; enabled: boolean; agentId: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [title, setTitle] = useState(schedule?.title ?? "");
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [triggerType, setTriggerType] = useState<"cron" | "webhook">(schedule?.triggerType ?? "cron");
  const [cronExpression, setCronExpression] = useState(schedule?.cronExpression ?? "0 9 * * *");
  const [timezone, setTimezone] = useState(schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [ownerId, setOwnerId] = useState(schedule?.agentId ?? agentId);
  const [copied, setCopied] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !prompt.trim() || !cronExpression.trim() || !timezone.trim() || !ownerId) return;
    void onSave({ triggerType, title: title.trim(), prompt: prompt.trim(), cronExpression: cronExpression.trim(), timezone: timezone.trim(), enabled: schedule?.enabled ?? true, agentId: ownerId });
  };
  return (
    <form className="schedule-editor" onSubmit={submit}>
      <div className="schedule-editor-title"><strong>{schedule ? "Configure automation" : "New automation"}</strong><button type="button" onClick={onCancel} aria-label="Close automation editor"><X size={13} /></button></div>
      <label><span>Name</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Morning project digest" /></label>
      <label><span>Instruction</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should the agent do?" rows={3} /></label>
      <label><span>Trigger</span><select value={triggerType} onChange={(event) => setTriggerType(event.target.value as "cron" | "webhook")}><option value="cron">Schedule</option><option value="webhook">Webhook</option></select></label>
      {triggerType === "cron" ? <div className="schedule-editor-grid">
        <label><span>Schedule</span><input value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} placeholder="*/5 * * * *" /><small>minute · hour · day · month · weekday</small></label>
        <label><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Europe/Amsterdam" /></label>
      </div> : webhookUrl ? <label className="webhook-field"><span>Webhook URL</span><div><input readOnly value={webhookUrl} /><button type="button" onClick={async () => { await navigator.clipboard.writeText(webhookUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }} aria-label="Copy webhook URL">{copied ? <Check size={12} /> : <Copy size={12} />}</button></div><small>Send a POST request with an optional JSON body.</small></label> : <div className="webhook-notice"><Zap size={13} /><span>A private webhook URL will be generated when you save.</span></div>}
      {!schedule && agents.length > 1 && <label><span>Agent</span><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label>}
      <div className="schedule-editor-actions">
        {onDelete && <button type="button" className="schedule-delete" disabled={busy} onClick={() => void onDelete()}><Trash2 size={12} /> Delete</button>}
        <span />
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="schedule-save" disabled={busy || !title.trim() || !prompt.trim()}>{busy ? <LoaderCircle className="spin" size={12} /> : "Save"}</button>
      </div>
    </form>
  );
}

function TaskContext({ task, tasks, agents }: { task: Task | null; tasks: Task[]; agents: Agent[] }) {
  if (!task) return <ContextEmpty icon={LayoutList} title="No linked task" body="Select a task to inspect its objective and delegation tree." />;
  const owner = agents.find(({ id }) => id === task.ownerAgentId);
  const children = taskChildren(tasks, task.id);
  const parent = tasks.find(({ id }) => id === task.parentTaskId);
  return (
    <div className="context-stack">
      <div className="context-eyebrow"><span className={`task-state task-state--${task.status}`}>{taskStatusLabels[task.status]}</span><span>{task.priority} priority</span></div>
      <h2>{task.title}</h2>
      <p className="context-objective">{task.objective}</p>
      {owner && <div className="owner-card"><Avatar agent={owner} /><span><small>Owner</small><strong>{owner.name}</strong><em>{owner.role}</em></span></div>}
      <section className="context-section">
        <h3>Acceptance</h3>
        <ul className="check-list">{task.acceptanceCriteria.map((criterion) => <li key={criterion}><span><Check size={11} /></span>{criterion}</li>)}</ul>
      </section>
      {(parent || children.length > 0) && (
        <section className="context-section">
          <h3>Delegation</h3>
          {parent && <div className="delegation-link"><span>From</span><strong>{parent.title}</strong></div>}
          {children.map((child) => {
            const childOwner = agents.find(({ id }) => id === child.ownerAgentId);
            return <div className="delegated-item" key={child.id}><ArrowRight size={13} /><span><strong>{child.title}</strong><small>{childOwner?.name ?? "Unassigned"} · {taskStatusLabels[child.status]}</small></span></div>;
          })}
        </section>
      )}
      <section className="context-section budget-block">
        <h3>Budget</h3>
        <div><span>{task.budget.maxTokens.toLocaleString()} tokens</span><span>{Math.round(task.budget.maxWallSeconds / 60)} min</span><span>{task.budget.maxChildTasks} delegates</span></div>
      </section>
    </div>
  );
}

function TeamContext({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) return <ContextEmpty icon={Users} title="No team here" body="Add agents to a group conversation to coordinate work." />;
  return (
    <div className="context-stack">
      <div><h2>Active team</h2><p className="context-objective">Every agent can discover the others, inspect assigned tasks, and request scoped context.</p></div>
      <div className="team-list">
        {agents.map((agent) => <div className="team-card" key={agent.id}><Avatar agent={agent} /><span><strong>{agent.name}</strong><small>{agent.role}</small><em><StatusDot status={agent.status} />{statusLabels[agent.status]}</em></span></div>)}
      </div>
      <section className="context-section"><h3>Shared capabilities</h3><div className="capability-list">{[...new Set(agents.flatMap(({ capabilities }) => capabilities))].map((capability) => <span key={capability}>{capability}</span>)}</div></section>
    </div>
  );
}

function FilesContext({ resources, task, agents }: { resources: ReturnType<typeof useWorkspaceResources>; task: Task | null; agents: Agent[] }) {
  const { state } = resources;
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canMutate = state.mode === "live" || state.mode === "demo";
  const normalizedQuery = query.trim().toLowerCase();
  const visible = state.artifacts
    .filter((artifact) => artifact.name.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setLocalError(null);
    for (const file of Array.from(files)) {
      setBusyId(`upload:${file.name}`);
      try {
        await resources.uploadArtifact(file, {
          ...(task ? { taskId: task.id } : {}),
          ...(task?.ownerAgentId ? { agentId: task.ownerAgentId } : {}),
        });
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
        break;
      }
    }
    setBusyId(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const finishRename = async (artifact: ArtifactRecord) => {
    const nextName = renameValue.trim();
    if (!nextName || nextName === artifact.name) { setRenamingId(null); return; }
    setBusyId(artifact.id); setLocalError(null);
    try { await resources.renameArtifact(artifact, nextName); setRenamingId(null); }
    catch (error) { setLocalError(error instanceof Error ? error.message : "File could not be renamed."); }
    finally { setBusyId(null); }
  };

  return (
    <div className="context-stack resource-context">
      <div className="resource-title-row">
        <button className="resource-icon-button" disabled={!canMutate || Boolean(busyId)} onClick={() => fileInput.current?.click()} aria-label="Upload files" title="Upload files">
          {busyId?.startsWith("upload:") ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
        </button>
        <input ref={fileInput} className="visually-hidden" type="file" multiple onChange={(event) => void upload(event.target.files)} />
      </div>
      <label className="resource-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter files" aria-label="Filter files" /></label>
      {(localError || state.error) && <div className="resource-error"><CircleAlert size={13} /><span>{localError ?? state.error}</span><button onClick={() => { setLocalError(null); void resources.sync(); }}>Retry</button></div>}
      {state.loading && state.artifacts.length === 0 ? (
        <div className="resource-loading"><LoaderCircle className="spin" size={18} />Loading files…</div>
      ) : visible.length > 0 ? (
        <div className="file-list file-list--interactive">
          {visible.map((artifact) => {
            const agent = agents.find(({ id }) => id === artifact.agentId);
            const isText = artifact.mimeType.startsWith("text/") || artifact.name.endsWith(".md") || artifact.name.endsWith(".json");
            return (
              <div className="file-row" key={artifact.id}>
                <span>{isText ? <FileText size={16} /> : <FileCode2 size={16} />}</span>
                <div>
                  {renamingId === artifact.id ? (
                    <input
                      autoFocus
                      className="rename-input"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => void finishRename(artifact)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void finishRename(artifact);
                        if (event.key === "Escape") setRenamingId(null);
                      }}
                      aria-label={`Rename ${artifact.name}`}
                    />
                  ) : <strong title={artifact.name}>{artifact.name}</strong>}
                  <small>{agent?.name ?? (artifact.provenance.source === "user_upload" ? "You" : "Agent")} · {formatBytes(artifact.size)} · v{artifact.version}</small>
                </div>
                <div className="file-actions">
                  <button disabled={busyId === artifact.id || !canMutate} aria-label={`Rename ${artifact.name}`} title="Rename" onClick={() => { setRenamingId(artifact.id); setRenameValue(artifact.name); }}><FileCode2 size={13} /></button>
                  <button disabled={busyId === artifact.id} aria-label={`Download ${artifact.name}`} title="Download" onClick={async () => { setBusyId(artifact.id); setLocalError(null); try { await resources.downloadArtifact(artifact); } catch (error) { setLocalError(error instanceof Error ? error.message : "Download failed."); } finally { setBusyId(null); } }}>
                    {busyId === artifact.id ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="resource-empty"><FolderOpen size={20} /><strong>{normalizedQuery ? "No matching files" : "No files yet"}</strong><span>{normalizedQuery ? "Try a different name." : "Upload a file or let an agent create an artifact."}</span>{!normalizedQuery && <button disabled={!canMutate} onClick={() => fileInput.current?.click()}><Upload size={13} /> Upload file</button>}</div>
      )}
    </div>
  );
}

function ActivityContext({ tasks, messages, agents }: { tasks: Task[]; messages: Message[]; agents: Agent[] }) {
  const taskEvents = tasks.slice(0, 4).map((task) => ({ id: task.id, at: task.updatedAt, text: `${agents.find(({ id }) => id === task.ownerAgentId)?.name ?? "Agent"} · ${taskStatusLabels[task.status]}`, title: task.title }));
  const messageEvents = messages.slice(-3).map((message) => ({ id: message.id, at: message.createdAt, text: message.role === "user" ? "You sent a message" : `${agents.find(({ id }) => id === message.authorId)?.name ?? "noudleAgents"} replied`, title: message.content.slice(0, 52) }));
  const events = [...taskEvents, ...messageEvents].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="context-stack"><div><h2>Activity</h2><p className="context-objective">A durable record of work, delegation, and decisions.</p></div><div className="timeline">{events.map((event) => <div className="timeline-row" key={event.id}><span /><div><strong>{event.title}</strong><small>{event.text} · {relativeTime(event.at)}</small></div></div>)}</div></div>
  );
}

function ComputerContext({ resources, agentId }: { resources: ReturnType<typeof useWorkspaceResources>; agentId: string | null }) {
  const { state } = resources;
  const [expanded, setExpanded] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const computer = agentId
    ? state.computers.find((candidate) => candidate.agentId === null && candidate.browser && candidate.status === "running")
      ?? state.computers.find((candidate) => candidate.agentId === agentId && candidate.browser && candidate.status === "running")
      ?? null
    : state.computers.find(({ id }) => id === state.selectedComputerId) ?? null;
  const safeComputerUrl = useMemo(() => {
    if (!computer?.computerUrl) return null;
    try {
      const url = new URL(computer.computerUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (url.pathname.endsWith("/vnc.html")) {
        url.pathname = `${url.pathname.slice(0, -"vnc.html".length)}relay.html`;
        url.searchParams.delete("autoconnect");
        url.searchParams.delete("resize");
      }
      return url.toString();
    } catch {
      return null;
    }
  }, [computer?.computerUrl]);
  const controlled = computer?.controlMode === "user";

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      withViewTransition(() => setExpanded(false));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "relay-computer-escape" || !safeComputerUrl) return;
      if (event.origin !== new URL(safeComputerUrl).origin) return;
      withViewTransition(() => setExpanded(false));
    };
    document.body.classList.add("computer-is-expanded");
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("message", onMessage);
    return () => {
      document.body.classList.remove("computer-is-expanded");
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("message", onMessage);
    };
  }, [expanded, safeComputerUrl]);

  const toggleControl = async () => {
    if (!computer || controlBusy) return;
    setControlBusy(true);
    setControlError(null);
    try {
      await resources.updateComputerControl(computer, controlled ? "return" : "takeover");
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "Could not change computer control.");
    } finally {
      setControlBusy(false);
    }
  };

  const panel = (
    <div className={`computer-context ${expanded ? "is-expanded" : ""}`}>
      <button
        className={`computer-expand-button ${expanded ? "is-close" : ""}`}
        aria-label={expanded ? "Close fullscreen computer" : "Open computer fullscreen"}
        title={expanded ? "Close fullscreen (Esc)" : "Fullscreen"}
        onClick={() => withViewTransition(() => setExpanded((value) => !value))}
      >{expanded ? <X size={15} /> : <Maximize2 size={14} />}</button>
      <div className={`computer-live-frame ${controlled ? "is-controlled" : "is-watch-only"}`}>
        {safeComputerUrl ? (
          <iframe src={safeComputerUrl} title="Virtual machine" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads" allow="clipboard-read; clipboard-write" referrerPolicy="no-referrer" />
        ) : (
          <div className="computer-canvas"><Monitor size={31} /><span>No active session</span></div>
        )}
      </div>
      {computer && <button className={`computer-control-button ${controlled ? "return-control" : "take-control"}`} disabled={controlBusy} onClick={() => void toggleControl()}>
        {controlBusy && <LoaderCircle className="spin" size={12} />}{controlled ? "Give back PC" : "Take control"}
      </button>}
      {controlError && <p className="computer-control-error" role="alert">{controlError}</p>}
    </div>
  );
  return expanded ? createPortal(panel, document.body) : panel;
}

function ContextEmpty({ icon: Icon, title, body }: { icon: typeof LayoutList; title: string; body: string }) {
  return <div className="context-empty"><Icon size={22} /><strong>{title}</strong><span>{body}</span></div>;
}

function DialogShell({ title, subtitle, onClose, children, wide = false, minimal = false }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean; minimal?: boolean }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`dialog ${wide ? "dialog--wide" : ""} ${minimal ? "dialog--minimal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <header className="dialog-header"><div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></header>
        {children}
      </section>
    </div>
  );
}

function NewAgentDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: CreateAgentInput) => Promise<void> }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [color, setColor] = useState("#D7FF64");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colors = ["#D7FF64", "#74B9FF", "#F3C66D", "#FF7D84", "#72D6A0"];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !role.trim()) return;
    setBusy(true); setError(null);
    try {
      await onCreate({ name: name.trim(), role: role.trim(), instructions: instructions.trim(), avatar: initials(name), color, capabilities: FULL_AGENT_CAPABILITIES });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the agent.");
      setBusy(false);
    }
  };
  return (
    <DialogShell title="Create agent" onClose={onClose} minimal>
      <form className="dialog-form agent-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid"><label><span>Name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Atlas" /></label><label><span>Role</span><input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Backend engineer" /></label></div>
        <label><span>Instructions</span><textarea rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Working style, constraints, and definition of done" /></label>
        <fieldset className="color-field"><legend>Color</legend><div>{colors.map((choice) => <button type="button" key={choice} aria-label={`Use ${choice}`} aria-pressed={color === choice} className={color === choice ? "active" : ""} style={{ background: choice }} onClick={() => setColor(choice)}>{color === choice && <Check size={12} />}</button>)}</div></fieldset>
        {error && <p className="form-error"><CircleAlert size={14} />{error}</p>}
        <div className="dialog-actions"><button className="accent-button" disabled={busy || !name.trim() || !role.trim()}>{busy ? "Creating…" : "Create agent"}</button></div>
      </form>
    </DialogShell>
  );
}

const CONNECTOR_META: Record<ConnectorProvider, { name: string; credential: string; placeholder: string; icon: typeof Github }> = {
  github: { name: "GitHub", credential: "Personal access token", placeholder: "github_pat_…", icon: Github },
  resend: { name: "Resend", credential: "API key", placeholder: "re_…", icon: Mail },
  notion: { name: "Notion", credential: "Integration token", placeholder: "ntn_…", icon: BookOpen },
  stripe: { name: "Stripe", credential: "Secret or restricted API key", placeholder: "sk_… or rk_…", icon: CreditCard },
  firebase: { name: "Firebase", credential: "Firebase CLI refresh token", placeholder: "1//…", icon: Flame },
};

function ConnectorsDialog({ client, agents, onClose }: { client: ReturnType<typeof useRelay>["client"]; agents: Agent[]; onClose: () => void }) {
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [editing, setEditing] = useState<ConnectorProvider | "custom" | null>(null);
  const [secret, setSecret] = useState("");
  const [custom, setCustom] = useState<CreateCustomConnectorInput>({ name: "", baseUrl: "", authType: "bearer", headerName: null, authPrefix: "", secret: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ConnectorSummary | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => client.listConnectors()
      .then((items) => { if (active) setConnectors(items); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load connectors."); });
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [client]);

  const update = (connector: ConnectorSummary) => {
    setConnectors((items) => items.some((item) => item.id === connector.id)
      ? items.map((item) => item.id === connector.id ? connector : item)
      : [...items, connector]);
  };

  const connect = async (provider: ConnectorProvider) => {
    if (!secret.trim() || busy) return;
    setBusy(provider); setError(null);
    try {
      update(await client.connectConnector(provider, secret));
      setEditing(null); setSecret("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection failed.");
    } finally { setBusy(null); }
  };

  const remove = async (connector: ConnectorSummary) => {
    if (busy) return false;
    setBusy(connector.id); setError(null);
    try {
      await client.deleteConnector(connector.id);
      setConnectors(await client.listConnectors());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove connector.");
      return false;
    } finally { setBusy(null); }
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    if (await remove(pendingRemoval)) setPendingRemoval(null);
  };

  const createCustom = async (event: FormEvent) => {
    event.preventDefault();
    if (!custom.name.trim() || !custom.baseUrl.trim() || !custom.secret.trim() || busy) return;
    setBusy("custom"); setError(null);
    try {
      update(await client.createConnector(custom));
      setCustom({ name: "", baseUrl: "", authType: "bearer", headerName: null, authPrefix: "", secret: "" });
      setEditing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create connector.");
    } finally { setBusy(null); }
  };

  const creator = (connector: ConnectorSummary) => {
    if (!connector.createdById) return "Shared workspace connector";
    if (connector.createdByType === "user") return "Shared · added by you";
    return `Shared · added by ${agents.find((agent) => agent.id === connector.createdById)?.name ?? "an agent"}`;
  };

  const builtins = connectors.filter((connector) => connector.kind === "builtin");
  const customConnectors = connectors.filter((connector) => connector.kind === "custom");

  return (
    <>
      <DialogShell title="Connectors" onClose={onClose} minimal>
        <div className="connector-list">
        <div className="connector-toolbar">
          <button onClick={() => { setEditing(editing === "custom" ? null : "custom"); setError(null); }}><Plus size={13} />New connector</button>
        </div>
        {editing === "custom" && (
          <form className="connector-create" onSubmit={(event) => void createCustom(event)}>
            <div className="connector-create-grid">
              <label><span>Name</span><input autoFocus value={custom.name} onChange={(event) => setCustom({ ...custom, name: event.target.value })} placeholder="Hostinger" /></label>
              <label><span>HTTPS base URL</span><input value={custom.baseUrl} onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })} placeholder="https://api.example.com/v1/" /></label>
            </div>
            <div className="connector-create-grid connector-create-grid--auth">
              <label><span>Authentication</span><select value={custom.authType} onChange={(event) => setCustom({ ...custom, authType: event.target.value as CreateCustomConnectorInput["authType"] })}><option value="bearer">Bearer token</option><option value="header">API key header</option><option value="basic">Basic credential</option></select></label>
              {custom.authType === "header" && <label><span>Header name</span><input value={custom.headerName ?? ""} onChange={(event) => setCustom({ ...custom, headerName: event.target.value })} placeholder="X-API-Key" /></label>}
              <label><span>Secret</span><input type="password" value={custom.secret} onChange={(event) => setCustom({ ...custom, secret: event.target.value })} placeholder="Encrypted after saving" autoComplete="off" spellCheck={false} /></label>
            </div>
            <div className="connector-create-actions"><button type="button" onClick={() => setEditing(null)}>Cancel</button><button disabled={busy === "custom" || !custom.name.trim() || !custom.baseUrl.trim() || !custom.secret.trim()}>{busy === "custom" ? "Saving…" : "Save for team"}</button></div>
          </form>
        )}
        {(["github", "resend", "notion", "stripe", "firebase"] as ConnectorProvider[]).map((provider) => {
          const meta = CONNECTOR_META[provider];
          const connector = builtins.find((item) => item.provider === provider);
          const connected = Boolean(connector?.connected);
          const Icon = meta.icon;
          return (
            <div className={`connector-card ${editing === provider ? "is-editing" : ""}`} key={provider}>
              <div className="connector-card-main">
                <span className="connector-mark"><Icon size={18} /></span>
                <div><strong>{meta.name}</strong><small>{connected && connector ? `${connector.accountLabel} · ${creator(connector)}` : "Built-in connector"}</small></div>
                {connected ? (
                  <button className="connector-action connector-action--muted" disabled={busy === connector?.id} onClick={() => { if (connector) { setError(null); setPendingRemoval(connector); } }}>{busy === connector?.id ? "…" : "Disconnect"}</button>
                ) : (
                  <button className="connector-action" onClick={() => { setEditing(provider); setSecret(""); setError(null); }}>Connect</button>
                )}
              </div>
              {editing === provider && !connected && (
                <form className="connector-auth" onSubmit={(event) => { event.preventDefault(); void connect(provider); }}>
                  <input autoFocus type="password" value={secret} onChange={(event) => setSecret(event.target.value)} aria-label={meta.credential} placeholder={meta.placeholder} autoComplete="off" spellCheck={false} />
                  <button type="button" onClick={() => { setEditing(null); setSecret(""); }}>Cancel</button>
                  <button disabled={!secret.trim() || busy === provider}>{busy === provider ? "Connecting…" : "Save"}</button>
                </form>
              )}
            </div>
          );
        })}
        {customConnectors.map((connector) => (
          <div className="connector-card" key={connector.id}>
            <div className="connector-card-main">
              <span className="connector-mark connector-mark--custom"><Network size={18} /></span>
              <div><strong>{connector.name}</strong><small>{connector.accountLabel} · {creator(connector)}</small></div>
              <button className="connector-action connector-action--muted" disabled={busy === connector.id} onClick={() => { setError(null); setPendingRemoval(connector); }}>{busy === connector.id ? "…" : "Remove"}</button>
            </div>
          </div>
        ))}
        {error && <p className="form-error"><CircleAlert size={14} />{error}</p>}
        </div>
      </DialogShell>
      {pendingRemoval && createPortal(
        <div className="dialog-backdrop connector-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) setPendingRemoval(null); }}>
          <section className="connector-confirm-dialog" role="dialog" aria-modal="true" aria-label={`${pendingRemoval.kind === "custom" ? "Remove" : "Disconnect"} ${pendingRemoval.name}`}>
            <span className="connector-confirm-icon"><CircleAlert size={20} /></span>
            <h2>{pendingRemoval.kind === "custom" ? `Remove ${pendingRemoval.name}?` : `Disconnect ${pendingRemoval.name}?`}</h2>
            <p>{pendingRemoval.kind === "custom"
              ? "Are you sure you want to remove this connector? It will no longer be available to the workspace."
              : "Are you sure you want to disconnect this connector? It can be connected again later."}</p>
            {error && <p className="connector-confirm-error" role="alert">{error}</p>}
            <footer>
              <button type="button" disabled={Boolean(busy)} onClick={() => setPendingRemoval(null)}>Cancel</button>
              <button type="button" className="connector-confirm-destructive" disabled={Boolean(busy)} onClick={() => void confirmRemoval()}>
                {busy ? (pendingRemoval.kind === "custom" ? "Removing…" : "Disconnecting…") : (pendingRemoval.kind === "custom" ? "Remove" : "Disconnect")}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

function NewConversationDialog({ agents, onClose, onCreate }: { agents: Agent[]; onClose: () => void; onCreate: (input: CreateConversationInput) => Promise<void> }) {
  const [kind, setKind] = useState<"direct" | "group">("group");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((current) => kind === "direct" ? [id] : current.includes(id) ? current.filter((value) => value !== id) : current.length < 6 ? [...current, id] : current);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const members = kind === "direct" ? selected.slice(0, 1) : selected;
    if (members.length === 0) return;
    const directAgent = agents.find(({ id }) => id === members[0]);
    setBusy(true); setError(null);
    try { await onCreate({ kind, title: kind === "direct" ? directAgent?.name ?? "Direct chat" : title.trim() || "Agent room", memberAgentIds: members, taskId: null }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the conversation."); setBusy(false); }
  };
  return (
    <DialogShell title="New conversation" subtitle="Start direct or put several agents in one shared room." onClose={onClose}>
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <div className="kind-picker"><button type="button" className={kind === "direct" ? "active" : ""} onClick={() => { setKind("direct"); setSelected((items) => items.slice(0, 1)); }}><MessageCircle size={16} /><span><strong>Direct</strong><small>One agent</small></span></button><button type="button" className={kind === "group" ? "active" : ""} onClick={() => setKind("group")}><Users size={16} /><span><strong>Group</strong><small>Up to six agents</small></span></button></div>
        {kind === "group" && <label><span>Room name</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Product launch" /></label>}
        <fieldset className="agent-picker"><legend>{kind === "direct" ? "Choose an agent" : `Choose agents · ${selected.length}/6`}</legend>{agents.map((agent) => <button type="button" key={agent.id} className={selected.includes(agent.id) ? "active" : ""} onClick={() => toggle(agent.id)}><Avatar agent={agent} /><span><strong>{agent.name}</strong><small>{agent.role}</small></span><span className="picker-check">{selected.includes(agent.id) && <Check size={12} />}</span></button>)}</fieldset>
        {agents.length === 0 && <div className="form-empty">Create an agent before starting a conversation.</div>}
        {error && <p className="form-error"><CircleAlert size={14} />{error}</p>}
        <div className="dialog-actions"><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="accent-button" disabled={busy || selected.length === 0}>{busy ? "Starting…" : "Start conversation"}</button></div>
      </form>
    </DialogShell>
  );
}

function ApprovalsDialog({ approvals, agents, onClose, onResolve }: { approvals: Approval[]; agents: Agent[]; onClose: () => void; onResolve: (approval: Approval, decision: "approve" | "deny") => Promise<void> }) {
  const pending = approvals.filter(({ status }) => status === "pending");
  const decided = approvals.filter(({ status }) => status !== "pending");
  return (
    <DialogShell wide title="Approvals" subtitle="Nothing leaves the workspace without a clear decision." onClose={onClose}>
      <div className="approval-list">
        {pending.map((approval) => {
          const agent = agents.find(({ id }) => id === approval.agentId);
          return <article className="approval-card" key={approval.id}><header><span className="risk-icon"><ShieldCheck size={17} /></span><div><small>{approval.risk.replaceAll("_", " ")} · {agent?.name ?? "Agent"}</small><h3>{approval.title}</h3></div><span className="pending-label">Pending</span></header><p>{approval.description}</p><pre>{JSON.stringify(approval.normalizedArguments, null, 2)}</pre><footer><span><Clock3 size={13} />Expires {relativeTime(approval.expiresAt)}</span><div><button className="deny-button" onClick={() => void onResolve(approval, "deny")}><X size={14} /> Deny</button><button className="approve-button" onClick={() => void onResolve(approval, "approve")}><Check size={14} /> Approve</button></div></footer></article>;
        })}
        {pending.length === 0 && <div className="approval-empty"><ShieldCheck size={24} /><strong>All clear</strong><span>No agent is waiting on a risky action.</span></div>}
        {decided.length > 0 && <div className="decided-list"><h3>Recent decisions</h3>{decided.map((approval) => <div key={approval.id}><span className={`decision-dot decision-dot--${approval.status}`} /><strong>{approval.title}</strong><small>{approval.status}</small></div>)}</div>}
      </div>
    </DialogShell>
  );
}

function ConnectionDialog({ clientUrl, clientToken, mode, onClose, onRetry, onSave }: { clientUrl: string; clientToken: string; mode: string; onClose: () => void; onRetry: () => void; onSave: (url: string, token: string) => void }) {
  const [url, setUrl] = useState(clientUrl);
  const [token, setToken] = useState(clientToken);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Use an http:// or https:// server URL.");
      if (!token.trim()) throw new Error("An owner token is required.");
      onSave(parsed.toString().replace(/\/$/, ""), token.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enter a valid noudleAgents server URL.");
    }
  };
  return (
    <DialogShell title="Connection" subtitle="Connect this desktop to a local, private-network, or VPS noudleAgents server." onClose={onClose}>
      <form className="connection-dialog" onSubmit={save}>
        <div className="connection-summary"><span className={`connection-pulse connection-pulse--${mode}`} /><div><strong>{mode === "live" ? "noudleAgents server connected" : mode === "demo" ? "Seeded workspace active" : "noudleAgents server unavailable"}</strong><small>{clientUrl}</small></div></div>
        <div className="connection-fields">
          <label><span>Server URL</span><input type="url" spellCheck={false} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://relay.example.com" /></label>
          <label><span>Owner token</span><div><input type={showToken ? "text" : "password"} autoComplete="off" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} placeholder="noudleAgents bearer token" /><button type="button" onClick={() => setShowToken((value) => !value)}>{showToken ? "Hide" : "Show"}</button></div></label>
        </div>
        {error && <p className="form-error"><CircleAlert size={14} />{error}</p>}
        <p><HardDrive size={14} />Changing servers reloads noudleAgents. Agent history, files, computers, and approvals come from that server.</p>
        <div className="dialog-actions"><button type="button" className="text-button" onClick={onClose}>Close</button><button type="button" className="secondary-button" onClick={onRetry}><RefreshCw size={14} />Retry current</button><button className="accent-button" disabled={url.trim() === clientUrl && token === clientToken}>Save & reconnect</button></div>
      </form>
    </DialogShell>
  );
}

function MobilePairingDialog({ clientUrl, clientToken, onClose }: { clientUrl: string; clientToken: string; onClose: () => void }) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const create = async () => {
      try {
        const parsed = new URL(clientUrl);
        if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !clientToken.trim()) throw new Error("Connect the desktop to your VPS first.");
        if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) throw new Error("Connect the desktop to a reachable VPS or LAN address first. localhost cannot be reached by your phone.");
        const payload = encodeMobilePairingPayload({
          type: "noudleAgents.mobile-pair",
          version: 1,
          baseUrl: parsed.toString().replace(/\/$/, ""),
          token: clientToken.trim(),
        });
        const image = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 320,
          color: { dark: "#090a0b", light: "#f4f4f2" },
        });
        if (active) setQrCode(image);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not create the connection code.");
      }
    };
    void create();
    return () => { active = false; };
  }, [clientToken, clientUrl]);

  return (
    <DialogShell title="Connect to mobile app" subtitle="Scan this code with noudleAgents on your phone." onClose={onClose} minimal>
      <div className="mobile-pairing">
        {error ? <div className="mobile-pairing-code mobile-pairing-code--error"><WifiOff size={26} /></div> : qrCode ? <div className="mobile-pairing-code"><img alt="noudleAgents mobile connection QR code" src={qrCode} /></div> : <div className="mobile-pairing-code mobile-pairing-code--loading"><LoaderCircle size={22} /></div>}
        <strong>{clientUrl}</strong>
        <p><ShieldCheck size={14} />This code contains the owner token. Only scan it with a device you control.</p>
        {error && <p className="form-error"><CircleAlert size={14} />{error}</p>}
      </div>
    </DialogShell>
  );
}

function CommandPalette({ agents, onClose, onNewAgent, onApprovals, onSelectAgent }: { agents: Agent[]; onClose: () => void; onNewAgent: () => void; onApprovals: () => void; onSelectAgent: (agent: Agent) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visibleAgents = agents.filter((agent) => `${agent.name} ${agent.role}`.toLowerCase().includes(normalized)).slice(0, 4);
  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents or commands" /><kbd>esc</kbd></div>
        <div className="palette-results">
          {!normalized && <><span className="palette-heading">Commands</span><button onClick={onNewAgent}><span><Bot size={16} />Create agent</span><kbd>⌘ N</kbd></button><button onClick={onApprovals}><span><ShieldCheck size={16} />Open approvals</span></button></>}
          {visibleAgents.length > 0 && <><span className="palette-heading">Agents</span>{visibleAgents.map((agent) => <button key={agent.id} onClick={() => onSelectAgent(agent)}><span><Avatar agent={agent} size="small" />{agent.name}<small>{agent.role}</small></span><ArrowRight size={14} /></button>)}</>}
          {normalized && visibleAgents.length === 0 && <div className="palette-empty">No matches for “{query}”</div>}
        </div>
        <footer><span><Command size={12} /> noudleAgents command</span><span>↵ open</span></footer>
      </section>
    </div>
  );
}
