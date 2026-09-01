import { Ionicons } from "@expo/vector-icons";
import { radii, spacing } from "@noudle-agents/design-tokens";
import type { Agent } from "@noudle-agents/protocol";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { type ComputerSession, type ExecResult, resolveComputerUrl, safeTerminalActions, WorkspaceApi } from "../lib/workspaceApi";
import { SYNC_INTERVAL_MS } from "../lib/syncPolicy";
import type { InstanceConfig } from "../model";
import { AgentAvatar, Button, SectionHeader, StateNotice, theme, uiStyles } from "../ui";

const demoSession: ComputerSession = {
  id: "demo-computer", workspaceId: "workspace_local", agentId: "agent-orbit", taskId: "task-mvp", status: "running", browser: true, networkAccess: true, computerUrl: null, computerHostPort: null, controlMode: "watch", controlHolderId: null, leaseExpiresAt: null, createdAt: new Date(Date.now() - 600_000).toISOString(), updatedAt: new Date().toISOString(),
};

function MockBrowser({ controlled }: { controlled: boolean }) {
  return (
    <View style={styles.mockBrowser}>
      <View style={styles.mockSiteHeader}><View style={styles.mockLogo}><Ionicons name="cube" size={14} color="#171A1F" /></View><View style={styles.mockNavLine} /><View style={styles.mockAvatar} /></View>
      <View style={styles.mockHero}><Text style={styles.mockEyebrow}>WORKSPACE STATUS</Text><Text style={styles.mockTitle}>Your agents are{`\n`}building together.</Text><Text style={styles.mockBody}>One live workspace. Every task and decision stays visible.</Text><View style={styles.mockButton}><Text style={styles.mockButtonText}>VIEW ACTIVITY</Text></View></View>
      <View style={styles.mockCards}><View style={styles.mockCard}><View style={styles.mockImageLime} /><View style={styles.mockCopy} /></View><View style={styles.mockCard}><View style={styles.mockImageBlue} /><View style={styles.mockCopy} /></View></View>
      <View style={styles.watchBadge}><Ionicons name={controlled ? "hand-left-outline" : "eye-outline"} size={14} color="#FFFFFF" /><Text style={styles.watchBadgeText}>{controlled ? "YOU HAVE CONTROL" : "WATCH ONLY"}</Text></View>
    </View>
  );
}

function StreamView({ session, config, controlled }: { session: ComputerSession; config: InstanceConfig; controlled: boolean }) {
  const streamUrl = useMemo(() => session.computerUrl ? resolveComputerUrl(session.computerUrl, config.baseUrl) : null, [config.baseUrl, session.computerUrl]);
  if (!streamUrl) return <MockBrowser controlled={controlled} />;
  return <WebView accessibilityLabel="Live agent computer" allowFileAccess={false} allowsLinkPreview={false} domStorageEnabled javaScriptEnabled originWhitelist={["http://*", "https://*"]} sharedCookiesEnabled={false} source={{ uri: streamUrl, headers: { authorization: `Bearer ${config.token}` } }} style={styles.webView} />;
}

function findSessionAgent(session: ComputerSession, agents: Agent[]): Agent | undefined {
  return agents.find((agent) => agent.id === session.agentId) ?? agents.find((agent) => agent.status === "working") ?? agents[0];
}

export function ComputerScreen({ agents, config, connected }: { agents: Agent[]; config: InstanceConfig; connected: boolean }) {
  const [sessions, setSessions] = useState<ComputerSession[]>([demoSession]);
  const [selectedId, setSelectedId] = useState(demoSession.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminalResult, setTerminalResult] = useState<ExecResult | null>(null);
  const api = useMemo(() => config.baseUrl && config.token ? new WorkspaceApi(config.baseUrl, config.token) : null, [config.baseUrl, config.token]);
  const activeSession = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const activeAgent = activeSession ? findSessionAgent(activeSession, agents) : agents[0];
  const controlled = activeSession?.controlMode === "user";

  useEffect(() => {
    if (!api || !connected) { setSessions([demoSession]); setSelectedId(demoSession.id); return; }
    let disposed = false;
    const load = async () => {
      try {
        const next = await api.listComputers();
        if (disposed) return;
        setSessions(next);
        setSelectedId((current) => next.some((session) => session.id === current) ? current : (next[0]?.id ?? ""));
        setError(null);
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "Computer sync failed");
      }
    };
    void load();
    const interval = setInterval(() => void load(), SYNC_INTERVAL_MS);
    return () => { disposed = true; clearInterval(interval); };
  }, [api, connected]);

  const updateSession = (session: ComputerSession) => {
    setSessions((current) => current.some((item) => item.id === session.id) ? current.map((item) => item.id === session.id ? session : item) : [session, ...current]);
    setSelectedId(session.id);
  };

  const create = async () => {
    if (!api || !connected) { setError("Connect a noudleAgents instance to start a computer."); return; }
    setBusy("create"); setError(null);
    try { updateSession(await api.createComputer({ agentId: agents[0]?.id })); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start computer"); } finally { setBusy(null); }
  };

  const setControl = async (takeover: boolean) => {
    if (!activeSession) return;
    if (!api || !connected) {
      updateSession({ ...activeSession, controlMode: takeover ? "user" : "watch", controlHolderId: takeover ? "user_local_owner" : null, leaseExpiresAt: takeover ? new Date(Date.now() + 300_000).toISOString() : null });
      return;
    }
    setBusy("control"); setError(null);
    try { updateSession(takeover ? await api.takeoverComputer(activeSession.id, 300) : await api.returnComputer(activeSession.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Control request failed"); } finally { setBusy(null); }
  };

  const runAction = async (action: (typeof safeTerminalActions)[number]) => {
    if (!api || !connected || !activeSession) { setError("Terminal actions require a connected computer."); return; }
    setBusy(action.id); setError(null); setTerminalResult(null);
    try { setTerminalResult(await api.execComputer(activeSession.id, action.command)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Terminal action failed"); } finally { setBusy(null); }
  };

  if (!activeSession && connected) return <StateNotice icon="desktop-outline" title="No computer sessions" detail="Start a browser sandbox for an agent, then watch or take control from this phone." action={<Button label="Start computer" icon="add" variant="primary" loading={busy === "create"} onPress={() => void create()} />} />;
  if (!activeSession) return <StateNotice icon="desktop-outline" title="Computer unavailable" detail="Reconnect to restore agent computer sessions." />;

  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
      <View style={styles.sessionHeader}><View style={styles.identity}>{activeAgent ? <AgentAvatar agent={activeAgent} size={38} /> : <View style={styles.fallbackAvatar}><Ionicons name="desktop-outline" size={18} color={theme.textSecondary} /></View>}<View><Text style={styles.sessionTitle}>{activeAgent?.name ?? "Agent"}’s computer</Text><View style={styles.liveRow}><View style={[styles.liveDot, activeSession.status !== "running" && styles.liveDotIdle]} /><Text style={styles.liveText}>{activeSession.status.toUpperCase()} · {activeSession.browser ? "BROWSER" : "TERMINAL"}</Text></View></View></View><Button label="New" icon="add" variant="secondary" loading={busy === "create"} onPress={() => void create()} /></View>
      {sessions.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sessionStrip} contentContainerStyle={styles.sessionStripContent}>{sessions.map((session) => <Pressable accessibilityRole="button" accessibilityState={{ selected: session.id === activeSession.id }} key={session.id} onPress={() => setSelectedId(session.id)} style={[styles.sessionChip, session.id === activeSession.id && styles.sessionChipActive]}><View style={[styles.sessionChipDot, { backgroundColor: session.status === "running" ? theme.success : theme.textMuted }]} /><Text style={styles.sessionChipText}>{findSessionAgent(session, agents)?.name ?? session.id.slice(0, 8)}</Text></Pressable>)}</ScrollView> : null}
      {error ? <View style={styles.error}><Ionicons name="alert-circle-outline" size={16} color={theme.warning} /><Text style={styles.errorText}>{error}</Text></View> : null}
      <View style={[styles.frame, controlled && styles.frameControlled]}><View style={styles.browserChrome}><View style={styles.chromeDots}><View style={styles.chromeDot} /><View style={styles.chromeDot} /><View style={styles.chromeDot} /></View><View style={styles.address}><Ionicons name="lock-closed" size={9} color={theme.textMuted} /><Text numberOfLines={1} style={styles.addressText}>{activeSession.computerUrl ?? "relay.local/computer"}</Text></View><View style={styles.controlMode}><Text style={[styles.controlModeText, controlled && styles.controlModeTextActive]}>{controlled ? "CONTROL" : "WATCH"}</Text></View></View><StreamView session={activeSession} config={config} controlled={controlled} /></View>
      <View style={styles.controlBar}>{controlled ? <Button label="Return to agent" icon="return-down-back-outline" variant="danger" loading={busy === "control"} onPress={() => void setControl(false)} style={styles.flex} /> : <Button label="Take control for 5 min" icon="hand-left-outline" variant="primary" loading={busy === "control"} onPress={() => void setControl(true)} style={styles.flex} />}</View>
      <View style={styles.controlNotice}><Ionicons name={controlled ? "finger-print-outline" : "eye-outline"} size={17} color={controlled ? theme.accent : theme.info} /><Text style={styles.controlNoticeText}>{controlled ? "Your touches and keyboard input now go to this session. Return control when finished." : "Watching is read-only. Takeover uses a five-minute lease and remains visible to the agent."}</Text></View>
      <SectionHeader title="Safe terminal" detail={controlled ? "Read-only actions" : "Take control first"} />
      <View style={styles.actionGrid}>{safeTerminalActions.map((action) => <Pressable accessibilityLabel={action.label} accessibilityRole="button" disabled={!connected || !controlled || busy !== null} key={action.id} onPress={() => void runAction(action)} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, (!connected || !controlled || busy !== null) && styles.disabled]}><Ionicons name={busy === action.id ? "hourglass-outline" : "terminal-outline"} size={17} color={theme.textSecondary} /><Text style={styles.actionLabel}>{action.label}</Text></Pressable>)}</View>
      {terminalResult ? <View style={styles.terminal}><View style={styles.terminalHeader}><Text style={styles.terminalTitle}>OUTPUT</Text><Text style={[styles.exitCode, terminalResult.exitCode !== 0 && styles.exitCodeError]}>EXIT {terminalResult.exitCode}</Text></View><Text selectable style={styles.terminalText}>{terminalResult.stdout || terminalResult.stderr || "Command completed without output."}</Text>{terminalResult.stderr && terminalResult.stdout ? <Text selectable style={styles.terminalError}>{terminalResult.stderr}</Text> : null}</View> : null}
      {!connected ? <Text style={styles.demoNote}>OFFLINE DEMO · LIVE VIEW, TAKEOVER, AND TERMINAL CONNECT AUTOMATICALLY WITH THE INSTANCE</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, content: { paddingHorizontal: spacing.x4, paddingBottom: 130 },
  sessionHeader: { minHeight: 66, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.x3 }, identity: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.x3 }, fallbackAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 }, sessionTitle: { color: theme.textPrimary, fontSize: 15, fontWeight: "700" }, liveRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 }, liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.success }, liveDotIdle: { backgroundColor: theme.textMuted }, liveText: { color: theme.textMuted, fontSize: 9, fontWeight: "800", letterSpacing: 0.6 },
  sessionStrip: { flexGrow: 0, maxHeight: 42, marginBottom: spacing.x2 }, sessionStripContent: { gap: spacing.x2, alignItems: "center" }, sessionChip: { height: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle }, sessionChipActive: { borderColor: theme.borderStrong, backgroundColor: theme.surface2 }, sessionChipDot: { width: 6, height: 6, borderRadius: 3 }, sessionChipText: { color: theme.textSecondary, fontSize: 10, fontWeight: "700" },
  error: { flexDirection: "row", gap: spacing.x2, padding: spacing.x3, marginBottom: spacing.x3, borderRadius: radii.control, backgroundColor: "rgba(243,198,109,0.06)" }, errorText: { flex: 1, color: theme.warning, fontSize: 10, lineHeight: 15 },
  frame: { height: 500, overflow: "hidden", borderRadius: radii.card, backgroundColor: "#EDEDE9", borderWidth: 1, borderColor: theme.borderStrong }, frameControlled: { borderColor: theme.accent }, browserChrome: { height: 34, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, backgroundColor: "#23262B" }, chromeDots: { flexDirection: "row", gap: 4 }, chromeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#61666D" }, address: { flex: 1, height: 22, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: 5, backgroundColor: "#17191C" }, addressText: { flex: 1, color: "#9A9FA6", fontSize: 8 }, controlMode: { minWidth: 42, alignItems: "flex-end" }, controlModeText: { color: theme.info, fontSize: 7, fontWeight: "900", letterSpacing: 0.6 }, controlModeTextActive: { color: theme.accent }, webView: { flex: 1, backgroundColor: "#F1F1ED" },
  mockBrowser: { flex: 1, backgroundColor: "#F1F1ED" }, mockSiteHeader: { height: 40, flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingHorizontal: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#D1D1CC" }, mockLogo: { width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: "#D7FF64" }, mockNavLine: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "#D2D3CF" }, mockAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#D6D7D2" }, mockHero: { paddingHorizontal: 20, paddingTop: 35, paddingBottom: 28, backgroundColor: "#171A1F" }, mockEyebrow: { color: "#D7FF64", fontSize: 6, fontWeight: "800", letterSpacing: 1.2 }, mockTitle: { marginTop: 9, color: "#F4F5F2", fontSize: 24, lineHeight: 25, fontWeight: "800", letterSpacing: -1.2 }, mockBody: { width: "80%", marginTop: 12, color: "#92979D", fontSize: 8, lineHeight: 12 }, mockButton: { alignSelf: "flex-start", marginTop: 18, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 4, backgroundColor: "#D7FF64" }, mockButtonText: { color: "#111317", fontSize: 6, fontWeight: "900", letterSpacing: 0.6 }, mockCards: { flexDirection: "row", gap: 8, padding: 13 }, mockCard: { flex: 1, padding: 10, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: "#D2D2CE", backgroundColor: "#FAFAF7" }, mockImageLime: { height: 52, borderRadius: 3, backgroundColor: "#E3F7A8" }, mockImageBlue: { height: 52, borderRadius: 3, backgroundColor: "#CFE4F6" }, mockCopy: { width: "65%", height: 3, marginTop: 9, backgroundColor: "#B8BAB7" }, watchBadge: { position: "absolute", right: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 5, backgroundColor: "rgba(17,19,23,0.80)" }, watchBadgeText: { color: "#FFFFFF", fontSize: 7, fontWeight: "800", letterSpacing: 0.8 },
  controlBar: { minHeight: 66, flexDirection: "row", alignItems: "center" }, controlNotice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.x2, padding: spacing.x3, borderRadius: radii.control, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle }, controlNoticeText: { flex: 1, color: theme.textSecondary, fontSize: 11, lineHeight: 16 }, actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.x2 }, actionButton: { width: "48.5%", minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.x2, paddingHorizontal: spacing.x3, borderRadius: radii.control, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle }, actionLabel: { flex: 1, color: theme.textSecondary, fontSize: 11, fontWeight: "700" }, pressed: { opacity: 0.65 }, disabled: { opacity: 0.4 },
  terminal: { overflow: "hidden", marginTop: spacing.x3, borderRadius: radii.card, backgroundColor: "#070809", borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderStrong }, terminalHeader: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle }, terminalTitle: { color: theme.textMuted, fontSize: 8, fontWeight: "900", letterSpacing: 1 }, exitCode: { color: theme.success, fontSize: 8, fontWeight: "800" }, exitCodeError: { color: theme.danger }, terminalText: { padding: spacing.x3, color: "#C8D1C7", fontSize: 10, lineHeight: 15, fontFamily: "monospace" }, terminalError: { paddingHorizontal: spacing.x3, paddingBottom: spacing.x3, color: theme.danger, fontSize: 10, lineHeight: 15, fontFamily: "monospace" }, demoNote: { marginTop: spacing.x4, color: theme.textMuted, fontSize: 8, fontWeight: "700", letterSpacing: 0.7, lineHeight: 13, textAlign: "center" },
});
