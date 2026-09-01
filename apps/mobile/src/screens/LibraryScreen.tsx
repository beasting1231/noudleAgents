import { Ionicons } from "@expo/vector-icons";
import { radii, spacing } from "@noudle-agents/design-tokens";
import type { Agent } from "@noudle-agents/protocol";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { type ArtifactRecord, WorkspaceApi } from "../lib/workspaceApi";
import type { InstanceConfig, LibraryPage, RelayState } from "../model";
import { AgentAvatar, Button, PressableRow, SectionHeader, StateNotice, StatusLabel, theme, uiStyles } from "../ui";

const pages: Array<{ id: Exclude<LibraryPage, "root">; title: string; detail: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "agents", title: "Agents", detail: "Roles, capabilities, and live state", icon: "people-outline" },
  { id: "files", title: "Files", detail: "Shared artifacts and workspace output", icon: "folder-open-outline" },
  { id: "skills", title: "Skills", detail: "Reusable instructions and tools", icon: "shapes-outline" },
  { id: "routines", title: "Routines", detail: "Scheduled and event-driven work", icon: "repeat-outline" },
  { id: "memory", title: "Memory", detail: "Facts saved across conversations", icon: "albums-outline" },
  { id: "settings", title: "Settings", detail: "Instance, security, and devices", icon: "settings-outline" },
];

function LibraryHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.pageHeader}>
      <Pressable accessibilityLabel="Back to library" accessibilityRole="button" onPress={onBack} style={styles.backButton}><Ionicons name="chevron-back" size={22} color={theme.textPrimary} /></Pressable>
      <Text style={styles.pageTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function RootPage({ state, onOpen }: { state: RelayState; onOpen: (page: LibraryPage) => void }) {
  const activeAgents = state.agents.filter((agent) => !["idle", "completed", "failed"].includes(agent.status)).length;
  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
      <View style={styles.overviewCard}>
        <View style={styles.overviewMark}><Text style={styles.overviewMarkText}>R</Text></View>
        <View style={styles.flex}>
          <Text style={styles.workspaceName}>Local workspace</Text>
          <Text style={styles.workspaceDetail}>{activeAgents} active agent{activeAgents === 1 ? "" : "s"} · {state.tasks.length} tasks</Text>
        </View>
        <Ionicons name="cloud-done-outline" size={19} color={state.connection === "live" ? theme.success : theme.textMuted} />
      </View>
      <SectionHeader title="Workspace library" />
      <View style={styles.menu}>
        {pages.map((page) => (
          <PressableRow key={page.id} accessibilityLabel={`Open ${page.title}`} onPress={() => onOpen(page.id)} style={styles.menuRow}>
            <View style={styles.menuIcon}><Ionicons name={page.icon} size={20} color={theme.textSecondary} /></View>
            <View style={styles.flex}><Text style={styles.menuTitle}>{page.title}</Text><Text style={styles.menuDetail}>{page.detail}</Text></View>
            {page.id === "agents" ? <Text style={styles.menuCount}>{state.agents.length}</Text> : null}
            <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
          </PressableRow>
        ))}
      </View>
      <View style={styles.localNote}><Ionicons name="information-circle-outline" size={18} color={theme.textMuted} /><Text style={styles.localNoteText}>Everything here is shared with desktop. Demo content is clearly marked until you connect a noudleAgents instance.</Text></View>
    </ScrollView>
  );
}

function AgentsPage({ agents }: { agents: Agent[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (agents.length === 0) return <StateNotice icon="people-outline" title="No agents" detail="Your agent roster will appear here after the first agent is created." />;
  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
      {agents.map((agent) => {
        const expanded = agent.id === expandedId;
        return (
          <Pressable key={agent.id} accessibilityRole="button" onPress={() => setExpandedId(expanded ? null : agent.id)} style={({ pressed }) => [styles.agentCard, pressed && styles.pressed]}>
            <View style={styles.agentTop}>
              <AgentAvatar agent={agent} size={46} />
              <View style={styles.flex}><Text style={styles.agentName}>{agent.name}</Text><Text style={styles.agentRole}>{agent.role}</Text><View style={styles.agentStatus}><StatusLabel status={agent.status} /></View></View>
              <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={17} color={theme.textMuted} />
            </View>
            {expanded ? (
              <View style={styles.agentExpanded}>
                <Text style={styles.agentDescription}>{agent.description}</Text>
                <View style={styles.capabilities}>{agent.capabilities.map((capability) => <View key={capability} style={styles.capability}><Text style={styles.capabilityText}>{capability}</Text></View>)}</View>
                <View style={styles.agentMeta}><Text style={styles.agentMetaLabel}>CODEX THREAD</Text><Text numberOfLines={1} style={styles.agentMetaValue}>{agent.codexThreadId ?? "Not started"}</Text></View>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const demoArtifacts: ArtifactRecord[] = [
  { id: "demo-sync", logicalId: "logical-sync", workspaceId: "workspace_local", version: 1, parentArtifactId: null, taskId: "task-mvp", runId: null, agentId: "agent-orbit", name: "mobile-sync-report.md", mimeType: "text/markdown", size: 18_432, checksum: "demo-checksum-sync", storageKey: "demo/mobile-sync-report.md", provenance: { source: "agent_output", createdByType: "agent", createdById: "agent-orbit", originalName: "mobile-sync-report.md" }, metadata: {}, createdAt: new Date(Date.now() - 180_000).toISOString(), updatedAt: new Date(Date.now() - 180_000).toISOString() },
  { id: "demo-architecture", logicalId: "logical-architecture", workspaceId: "workspace_local", version: 2, parentArtifactId: "demo-architecture-v1", taskId: "task-mvp", runId: null, agentId: "agent-flint", name: "relay-architecture.pdf", mimeType: "application/pdf", size: 2_516_582, checksum: "demo-checksum-architecture", storageKey: "demo/relay-architecture.pdf", provenance: { source: "agent_output", createdByType: "agent", createdById: "agent-flint", originalName: "relay-architecture.pdf" }, metadata: {}, createdAt: new Date(Date.now() - 720_000).toISOString(), updatedAt: new Date(Date.now() - 720_000).toISOString() },
  { id: "demo-browser", logicalId: "logical-browser", workspaceId: "workspace_local", version: 1, parentArtifactId: null, taskId: "task-stream", runId: null, agentId: "agent-vale", name: "browser-test.png", mimeType: "image/png", size: 655_360, checksum: "demo-checksum-browser", storageKey: "demo/browser-test.png", provenance: { source: "sandbox_export", createdByType: "agent", createdById: "agent-vale", originalName: "browser-test.png" }, metadata: {}, createdAt: new Date(Date.now() - 1_440_000).toISOString(), updatedAt: new Date(Date.now() - 1_440_000).toISOString() },
];

function bytesLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactIcon(mimeType: string): keyof typeof Ionicons.glyphMap {
  if (mimeType.startsWith("image/")) return "image-outline";
  if (mimeType === "application/pdf") return "document-outline";
  if (mimeType.includes("zip")) return "archive-outline";
  return "document-text-outline";
}

function FilesPage({ config, connected, agents }: { config: InstanceConfig; connected: boolean; agents: Agent[] }) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>(demoArtifacts);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ArtifactRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const api = useMemo(() => config.baseUrl && config.token ? new WorkspaceApi(config.baseUrl, config.token) : null, [config.baseUrl, config.token]);
  const filtered = artifacts.filter((artifact) => artifact.name.toLowerCase().includes(query.toLowerCase()));

  const refresh = async () => {
    if (!api || !connected) {
      setArtifacts(demoArtifacts);
      return;
    }
    try {
      setError(null);
      setArtifacts(await api.listArtifacts());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load files");
    }
  };

  useEffect(() => { void refresh(); }, [api, connected]);

  const upload = async () => {
    if (!api || !connected) { setError("Connect a noudleAgents instance to upload files."); return; }
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setBusyId("upload"); setError(null);
    try {
      const uploaded = await api.uploadArtifact({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? "application/octet-stream", size: asset.size, file: asset.file });
      setArtifacts((current) => [uploaded, ...current.filter((artifact) => artifact.id !== uploaded.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed");
    } finally { setBusyId(null); }
  };

  const download = async (artifact: ArtifactRecord) => {
    if (!api || !connected) { setError("Downloads become available when the noudleAgents instance is connected."); return; }
    setBusyId(artifact.id); setError(null);
    try {
      if (Platform.OS === "web") {
        const response = await api.downloadArtifact(artifact.id);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = artifact.name; anchor.click();
        URL.revokeObjectURL(url);
      } else {
        const base = FileSystem.cacheDirectory;
        if (!base) throw new Error("This device does not provide a temporary download folder");
        const safeName = artifact.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const result = await FileSystem.downloadAsync(api.artifactDownloadUrl(artifact.id), `${base}${Date.now()}-${safeName}`, { headers: { authorization: `Bearer ${config.token}` } });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri, { dialogTitle: `Save ${artifact.name}`, mimeType: artifact.mimeType });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download failed");
    } finally { setBusyId(null); }
  };

  const rename = async () => {
    const name = renameValue.trim();
    if (!api || !renameTarget || !name) return;
    setBusyId(renameTarget.id); setError(null);
    try {
      const updated = await api.renameArtifact(renameTarget.id, name);
      setArtifacts((current) => current.map((artifact) => artifact.id === updated.id ? updated : artifact));
      setRenameTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Rename failed");
    } finally { setBusyId(null); }
  };

  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
      <View style={styles.fileToolbar}>
        <View style={[styles.search, styles.fileSearch]}><Ionicons name="search" size={17} color={theme.textMuted} /><TextInput accessibilityLabel="Search files" onChangeText={setQuery} placeholder="Search shared files" placeholderTextColor={theme.textMuted} style={styles.searchInput} value={query} /></View>
        <Button label="Upload" icon="cloud-upload-outline" variant="primary" loading={busyId === "upload"} onPress={() => void upload()} />
      </View>
      {error ? <View style={styles.fileError}><Ionicons name="alert-circle-outline" size={16} color={theme.warning} /><Text style={styles.fileErrorText}>{error}</Text></View> : null}
      <SectionHeader title="Artifacts" detail={`${filtered.length}`} action={<Pressable accessibilityLabel="Refresh files" accessibilityRole="button" onPress={() => void refresh()} style={styles.refreshButton}><Ionicons name="refresh" size={17} color={theme.textSecondary} /></Pressable>} />
      {filtered.length ? <View style={styles.menu}>
        {filtered.map((artifact) => {
          const agent = agents.find((candidate) => candidate.id === artifact.agentId);
          return <View key={artifact.id} style={styles.fileRow}>
            <View style={styles.fileIcon}><Ionicons name={artifactIcon(artifact.mimeType)} size={20} color={theme.textSecondary} /></View>
            <View style={styles.flex}><Text numberOfLines={1} style={styles.fileName}>{artifact.name}</Text><Text style={styles.fileDetail}>{bytesLabel(artifact.size)} · v{artifact.version} · {agent?.name ?? artifact.provenance.source.replaceAll("_", " ")}</Text></View>
            <Pressable accessibilityLabel={`Rename ${artifact.name}`} accessibilityRole="button" disabled={!connected} onPress={() => { setRenameTarget(artifact); setRenameValue(artifact.name); }} style={styles.fileAction}><Ionicons name="pencil-outline" size={17} color={theme.textMuted} /></Pressable>
            <Pressable accessibilityLabel={`Download ${artifact.name}`} accessibilityRole="button" disabled={busyId === artifact.id} onPress={() => void download(artifact)} style={styles.fileAction}><Ionicons name={busyId === artifact.id ? "hourglass-outline" : "download-outline"} size={18} color={theme.textSecondary} /></Pressable>
          </View>;
        })}
      </View> : <StateNotice icon="folder-open-outline" title="No files found" detail={query ? "No artifact matches this search." : "Uploaded files and agent output will appear here."} />}
      {!connected ? <Text style={styles.demoLabel}>OFFLINE DEMO · CONNECT AN INSTANCE TO UPLOAD, DOWNLOAD, AND RENAME</Text> : null}
      <Modal animationType="fade" transparent visible={Boolean(renameTarget)} onRequestClose={() => setRenameTarget(null)}>
        <Pressable accessibilityLabel="Close rename dialog" onPress={() => setRenameTarget(null)} style={styles.renameOverlay}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.renameDialog}>
            <Text style={styles.renameTitle}>Rename artifact</Text>
            <TextInput autoFocus accessibilityLabel="New file name" onChangeText={setRenameValue} onSubmitEditing={() => void rename()} selectTextOnFocus style={styles.field} value={renameValue} />
            <View style={styles.renameActions}><Button label="Cancel" variant="secondary" onPress={() => setRenameTarget(null)} style={styles.flex} /><Button label="Rename" variant="primary" loading={busyId === renameTarget?.id} disabled={!renameValue.trim()} onPress={() => void rename()} style={styles.flex} /></View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function SkillsPage() {
  const skills = [
    { name: "Frontend design", detail: "Production-grade interface patterns", installed: true },
    { name: "Browser control", detail: "Navigate, inspect, and test web apps", installed: true },
    { name: "Release review", detail: "Validate builds and deployment gates", installed: false },
  ];
  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
      <SectionHeader title="Available to agents" detail={`${skills.filter((skill) => skill.installed).length} enabled`} />
      <View style={styles.menu}>{skills.map((skill) => <View key={skill.name} style={styles.skillRow}><View style={styles.skillIcon}><Ionicons name="sparkles-outline" size={19} color={skill.installed ? theme.accent : theme.textMuted} /></View><View style={styles.flex}><Text style={styles.menuTitle}>{skill.name}</Text><Text style={styles.menuDetail}>{skill.detail}</Text></View><View style={[styles.installedPill, skill.installed && styles.installedPillActive]}><Text style={[styles.installedText, skill.installed && styles.installedTextActive]}>{skill.installed ? "ON" : "OFF"}</Text></View></View>)}</View>
      <Button label="Add skill from Git" icon="add" variant="secondary" onPress={() => undefined} style={styles.fullButton} />
      <Text style={styles.demoLabel}>SKILL INSTALLATION ACTIONS CONNECT WITH THE SERVER REGISTRY</Text>
    </ScrollView>
  );
}

function RoutinesPage() {
  const [daily, setDaily] = useState(true);
  const [review, setReview] = useState(false);
  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
      <SectionHeader title="Automations" detail="Local time" />
      <View style={styles.menu}>
        <View style={styles.routineRow}><View style={styles.routineIcon}><Ionicons name="sunny-outline" size={19} color={theme.warning} /></View><View style={styles.flex}><Text style={styles.menuTitle}>Morning brief</Text><Text style={styles.menuDetail}>Every weekday · 08:30</Text></View><Switch accessibilityLabel="Toggle morning brief" onValueChange={setDaily} trackColor={{ false: theme.borderStrong, true: theme.accentQuiet }} thumbColor={daily ? theme.accent : theme.textMuted} value={daily} /></View>
        <View style={styles.routineRow}><View style={styles.routineIcon}><Ionicons name="git-pull-request-outline" size={19} color={theme.info} /></View><View style={styles.flex}><Text style={styles.menuTitle}>Review completed tasks</Text><Text style={styles.menuDetail}>When a task completes</Text></View><Switch accessibilityLabel="Toggle task review" onValueChange={setReview} trackColor={{ false: theme.borderStrong, true: theme.accentQuiet }} thumbColor={review ? theme.accent : theme.textMuted} value={review} /></View>
      </View>
      <Button label="New routine" icon="add" variant="primary" onPress={() => undefined} style={styles.fullButton} />
      <Text style={styles.demoLabel}>CHANGES ARE LOCAL MOCKS UNTIL ROUTINE ENDPOINTS LAND</Text>
    </ScrollView>
  );
}

function MemoryPage() {
  const [query, setQuery] = useState("");
  const memories = [
    { title: "Deployment preference", body: "Build locally with Docker Compose before moving the same images to a VPS.", source: "MVP planning" },
    { title: "Approval boundary", body: "Publishing, purchases, deletion, and external communication always require approval.", source: "Safety policy" },
    { title: "Interface direction", body: "Use quiet dark surfaces, direct labels, and minimal operational chrome.", source: "Product brief" },
  ];
  const filtered = useMemo(() => memories.filter((memory) => `${memory.title} ${memory.body}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
      <View style={styles.search}><Ionicons name="search" size={17} color={theme.textMuted} /><TextInput accessibilityLabel="Search memory" onChangeText={setQuery} placeholder="Search remembered facts" placeholderTextColor={theme.textMuted} style={styles.searchInput} value={query} /></View>
      <SectionHeader title="Saved memory" detail={`${filtered.length}`} />
      {filtered.length ? filtered.map((memory) => <View key={memory.title} style={styles.memoryCard}><View style={styles.memoryTop}><Ionicons name="bookmark-outline" size={16} color={theme.accent} /><Text style={styles.memoryTitle}>{memory.title}</Text></View><Text style={styles.memoryBody}>{memory.body}</Text><Text style={styles.memorySource}>{memory.source.toUpperCase()}</Text></View>) : <StateNotice icon="search-outline" title="No matching memory" detail="Try a broader phrase. Memory search checks titles, facts, and source context." />}
      <Text style={styles.demoLabel}>DEMO MEMORY · SERVER SEARCH ENDPOINT PENDING</Text>
    </ScrollView>
  );
}

function SettingsPage({ state, config, configured, onSave }: { state: RelayState; config: InstanceConfig; configured: boolean; onSave: (config: InstanceConfig) => Promise<boolean> }) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [token, setToken] = useState(config.token);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => { setBaseUrl(config.baseUrl); setToken(config.token); }, [config.baseUrl, config.token]);
  const save = async () => {
    setSaving(true); setResult(null);
    const connected = await onSave({ baseUrl, token });
    setResult(connected ? "Connection verified" : baseUrl && token ? "Saved. Instance is currently unreachable; demo mode remains available." : "Demo mode enabled");
    setSaving(false);
  };
  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionHeader title="noudleAgents instance" detail={state.connection === "live" ? "Connected" : configured ? "Unavailable" : "Demo"} />
      <View style={styles.settingsCard}>
        <Text style={styles.fieldLabel}>INSTANCE URL</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} accessibilityLabel="Instance URL" keyboardType="url" onChangeText={setBaseUrl} placeholder="http://192.168.1.20:4310" placeholderTextColor={theme.textMuted} style={styles.field} value={baseUrl} />
        <Text style={styles.fieldHint}>Use your Mac’s LAN address on iPhone. localhost only works in the web simulator.</Text>
        <Text style={[styles.fieldLabel, styles.fieldSpacing]}>ACCESS TOKEN</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} accessibilityLabel="Access token" onChangeText={setToken} placeholder="Paste instance token" placeholderTextColor={theme.textMuted} secureTextEntry style={styles.field} value={token} />
        <Text style={styles.fieldHint}>Stored in iOS Keychain through Expo SecureStore. Web preview uses browser storage.</Text>
        {result ? <View style={styles.result}><Ionicons name={state.connection === "live" ? "checkmark-circle-outline" : "information-circle-outline"} size={17} color={state.connection === "live" ? theme.success : theme.warning} /><Text style={styles.resultText}>{result}</Text></View> : null}
        <Button label="Save and test connection" variant="primary" loading={saving} onPress={() => void save()} style={styles.fullButton} />
      </View>
      <SectionHeader title="Device" />
      <View style={styles.menu}>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>This device</Text><Text style={styles.infoValue}>iPhone · Mobile</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Sync mode</Text><Text style={styles.infoValue}>Snapshot + live events</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Offline behavior</Text><Text style={styles.infoValue}>Demo fallback</Text></View>
      </View>
      <SectionHeader title="Security" />
      <View style={styles.securityNote}><Ionicons name="lock-closed-outline" size={18} color={theme.success} /><Text style={styles.securityText}>Agent credentials and Codex authentication stay on the trusted server. This device only stores its instance access token.</Text></View>
    </ScrollView>
  );
}

export function LibraryScreen({ state, config, configured, onOpen, onSaveConfig }: { state: RelayState; config: InstanceConfig; configured: boolean; onOpen: (page: LibraryPage) => void; onSaveConfig: (config: InstanceConfig) => Promise<boolean> }) {
  if (state.libraryPage === "root") return <RootPage state={state} onOpen={onOpen} />;
  const title = pages.find((page) => page.id === state.libraryPage)?.title ?? "Library";
  return (
    <View style={uiStyles.screen}>
      <LibraryHeader title={title} onBack={() => onOpen("root")} />
      {state.libraryPage === "agents" ? <AgentsPage agents={state.agents} /> : null}
      {state.libraryPage === "files" ? <FilesPage config={config} connected={state.connection === "live"} agents={state.agents} /> : null}
      {state.libraryPage === "skills" ? <SkillsPage /> : null}
      {state.libraryPage === "routines" ? <RoutinesPage /> : null}
      {state.libraryPage === "memory" ? <MemoryPage /> : null}
      {state.libraryPage === "settings" ? <SettingsPage state={state} config={config} configured={configured} onSave={onSaveConfig} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  content: { paddingHorizontal: spacing.x4, paddingBottom: 130 },
  pageHeader: { minHeight: 54, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  backButton: { width: 54, height: 54, alignItems: "center", justifyContent: "center" },
  pageTitle: { flex: 1, color: theme.textPrimary, fontSize: 15, fontWeight: "700", textAlign: "center" },
  headerSpacer: { width: 54 },
  overviewCard: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingHorizontal: spacing.x4, marginTop: spacing.x3, borderRadius: radii.card, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  overviewMark: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent },
  overviewMarkText: { color: theme.canvas, fontSize: 19, fontWeight: "900" },
  workspaceName: { color: theme.textPrimary, fontSize: 15, fontWeight: "700" },
  workspaceDetail: { marginTop: 4, color: theme.textMuted, fontSize: 11 },
  menu: { overflow: "hidden", borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle, backgroundColor: theme.surface1 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingHorizontal: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  menuIcon: { width: 35, height: 35, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 },
  menuTitle: { color: theme.textPrimary, fontSize: 13, fontWeight: "700" },
  menuDetail: { marginTop: 3, color: theme.textMuted, fontSize: 10 },
  menuCount: { minWidth: 24, color: theme.textMuted, fontSize: 12, textAlign: "right" },
  localNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.x2, marginTop: spacing.x4, paddingHorizontal: spacing.x2 },
  localNoteText: { flex: 1, color: theme.textMuted, fontSize: 10, lineHeight: 15 },
  agentCard: { marginTop: spacing.x3, overflow: "hidden", borderRadius: radii.card, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  agentTop: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingHorizontal: spacing.x3 },
  agentName: { color: theme.textPrimary, fontSize: 15, fontWeight: "700" },
  agentRole: { marginTop: 2, color: theme.textSecondary, fontSize: 11 },
  agentStatus: { marginTop: 5 },
  agentExpanded: { padding: spacing.x3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle, backgroundColor: theme.white04 },
  agentDescription: { color: theme.textSecondary, fontSize: 12, lineHeight: 18 },
  capabilities: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.x3 },
  capability: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: theme.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  capabilityText: { color: theme.textSecondary, fontSize: 9, fontWeight: "600" },
  agentMeta: { marginTop: spacing.x4 },
  agentMetaLabel: { color: theme.textMuted, fontSize: 8, fontWeight: "800", letterSpacing: 0.8 },
  agentMetaValue: { marginTop: 4, color: theme.textSecondary, fontSize: 10 },
  search: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.x2, paddingHorizontal: spacing.x3, marginTop: spacing.x3, borderRadius: radii.control, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderStrong },
  searchInput: { flex: 1, height: 46, color: theme.textPrimary, fontSize: 13 },
  fileToolbar: { flexDirection: "row", alignItems: "center", gap: spacing.x2, marginTop: spacing.x3 },
  fileSearch: { flex: 1, marginTop: 0 },
  fileError: { flexDirection: "row", alignItems: "flex-start", gap: spacing.x2, padding: spacing.x3, marginTop: spacing.x3, borderRadius: radii.control, backgroundColor: "rgba(243,198,109,0.06)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(243,198,109,0.18)" },
  fileErrorText: { flex: 1, color: theme.warning, fontSize: 10, lineHeight: 15 },
  refreshButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  fileRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingHorizontal: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  fileIcon: { width: 38, height: 38, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 },
  fileName: { color: theme.textPrimary, fontSize: 12, fontWeight: "700" },
  fileDetail: { marginTop: 4, color: theme.textMuted, fontSize: 10 },
  fileAction: { width: 44, height: 44, marginHorizontal: -6, alignItems: "center", justifyContent: "center" },
  renameOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.x6, backgroundColor: theme.overlay },
  renameDialog: { width: "100%", maxWidth: 420, padding: spacing.x4, borderRadius: 16, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderStrong },
  renameTitle: { color: theme.textPrimary, fontSize: 17, fontWeight: "700" },
  renameActions: { flexDirection: "row", gap: spacing.x2, marginTop: spacing.x4 },
  demoLabel: { marginTop: spacing.x4, color: theme.textMuted, fontSize: 8, fontWeight: "700", letterSpacing: 0.7, lineHeight: 13, textAlign: "center" },
  skillRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingHorizontal: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  skillIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 },
  installedPill: { width: 40, height: 24, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: theme.surface2 },
  installedPillActive: { backgroundColor: theme.accentQuiet },
  installedText: { color: theme.textMuted, fontSize: 8, fontWeight: "900" },
  installedTextActive: { color: theme.accent },
  fullButton: { marginTop: spacing.x4 },
  routineRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingHorizontal: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  routineIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 },
  memoryCard: { padding: spacing.x4, marginBottom: spacing.x3, borderRadius: radii.card, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  memoryTop: { flexDirection: "row", alignItems: "center", gap: spacing.x2 },
  memoryTitle: { color: theme.textPrimary, fontSize: 13, fontWeight: "700" },
  memoryBody: { marginTop: spacing.x3, color: theme.textSecondary, fontSize: 12, lineHeight: 18 },
  memorySource: { marginTop: spacing.x3, color: theme.textMuted, fontSize: 8, fontWeight: "800", letterSpacing: 0.7 },
  settingsCard: { padding: spacing.x4, borderRadius: radii.card, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  fieldLabel: { color: theme.textMuted, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  fieldSpacing: { marginTop: spacing.x4 },
  field: { height: 48, paddingHorizontal: spacing.x3, marginTop: 7, borderRadius: radii.control, color: theme.textPrimary, fontSize: 13, backgroundColor: theme.canvas, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderStrong },
  fieldHint: { marginTop: 6, color: theme.textMuted, fontSize: 9, lineHeight: 14 },
  result: { flexDirection: "row", alignItems: "flex-start", gap: spacing.x2, padding: spacing.x3, marginTop: spacing.x4, borderRadius: radii.control, backgroundColor: theme.white04 },
  resultText: { flex: 1, color: theme.textSecondary, fontSize: 10, lineHeight: 15 },
  infoRow: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  infoLabel: { color: theme.textSecondary, fontSize: 12 },
  infoValue: { color: theme.textMuted, fontSize: 11 },
  securityNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.x3, padding: spacing.x4, borderRadius: radii.card, backgroundColor: "rgba(114,214,160,0.05)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(114,214,160,0.18)" },
  securityText: { flex: 1, color: theme.textSecondary, fontSize: 11, lineHeight: 17 },
});
