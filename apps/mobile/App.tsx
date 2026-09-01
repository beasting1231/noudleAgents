import { Ionicons } from "@expo/vector-icons";
import { spacing } from "@noudle-agents/design-tokens";
import { StatusBar } from "expo-status-bar";
import type { ComponentProps } from "react";
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { useRelay } from "./src/hooks/useRelay";
import type { RootTab } from "./src/model";
import { ChatsScreen } from "./src/screens/ChatsScreen";
import { ComputerScreen } from "./src/screens/ComputerScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { TasksScreen } from "./src/screens/TasksScreen";
import { ConnectionPill, theme } from "./src/ui";

const tabs: Array<{ id: RootTab; label: string; icon: ComponentProps<typeof Ionicons>["name"]; activeIcon: ComponentProps<typeof Ionicons>["name"] }> = [
  { id: "chats", label: "Chats", icon: "chatbubble-outline", activeIcon: "chatbubble" },
  { id: "tasks", label: "Tasks", icon: "git-branch-outline", activeIcon: "git-branch" },
  { id: "computer", label: "Computer", icon: "desktop-outline", activeIcon: "desktop" },
  { id: "library", label: "Library", icon: "grid-outline", activeIcon: "grid" },
];

function AppHeader({ tab, connection, source, pendingApprovals }: { tab: RootTab; connection: "loading" | "live" | "offline" | "error"; source: "server" | "demo"; pendingApprovals: number }) {
  const title = tabs.find((item) => item.id === tab)?.label ?? "noudleAgents";
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>R</Text></View>
        <View>
          <Text style={styles.headerEyebrow}>RELAY</Text>
          <Text style={styles.headerTitle}>{title}</Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        {pendingApprovals > 0 ? <View style={styles.approvalBadge}><Ionicons name="shield-outline" size={13} color={theme.warning} /><Text style={styles.approvalBadgeText}>{pendingApprovals}</Text></View> : null}
        <ConnectionPill connection={connection} source={source} />
      </View>
    </View>
  );
}

function BottomTabs({ active, pendingTasks, onSelect }: { active: RootTab; pendingTasks: number; onSelect: (tab: RootTab) => void }) {
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <Pressable
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
          >
            <View>
              <Ionicons name={selected ? tab.activeIcon : tab.icon} size={21} color={selected ? theme.accent : theme.textMuted} />
              {tab.id === "tasks" && pendingTasks > 0 ? <View style={styles.taskDot} /> : null}
            </View>
            <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function App() {
  const relay = useRelay();
  const { state } = relay;
  const pendingTasks = state.tasks.filter((task) => ["blocked", "waiting_user"].includes(task.status)).length;
  const pendingApprovals = state.approvals.filter((approval) => approval.status === "pending").length;

  return (
    <View style={styles.outer}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.app}>
        <AppHeader tab={state.activeTab} connection={state.connection} source={state.source} pendingApprovals={pendingApprovals} />
        {state.error ? (
          <View style={styles.syncNotice}>
            <Ionicons name="cloud-offline-outline" size={15} color={theme.warning} />
            <Text numberOfLines={2} style={styles.syncNoticeText}>{state.error}</Text>
          </View>
        ) : null}
        <View style={styles.content}>
          {state.connection === "loading" && state.agents.length === 0 ? (
            <View style={styles.loading}>
              <View style={styles.loadingMark}><ActivityIndicator color={theme.canvas} /></View>
              <Text style={styles.loadingTitle}>Opening workspace</Text>
              <Text style={styles.loadingDetail}>Recovering agents, messages, and tasks…</Text>
            </View>
          ) : null}
          {state.connection !== "loading" || state.agents.length > 0 ? (
            <>
              {state.activeTab === "chats" ? <ChatsScreen state={state} onSelectConversation={(conversationId) => relay.dispatch({ type: "selectConversation", conversationId })} onSend={relay.sendMessage} onResolveApproval={(approvalId, decision) => void relay.resolveApproval(approvalId, decision)} /> : null}
              {state.activeTab === "tasks" ? <TasksScreen tasks={state.tasks} agents={state.agents} onDelegate={(taskId, agentId) => void relay.delegateTask(taskId, agentId)} /> : null}
              {state.activeTab === "computer" ? <ComputerScreen agents={state.agents} config={relay.config} connected={state.connection === "live"} /> : null}
              {state.activeTab === "library" ? <LibraryScreen state={state} config={relay.config} configured={relay.configured} onOpen={(page) => relay.dispatch({ type: "openLibrary", page })} onSaveConfig={relay.connect} /> : null}
            </>
          ) : null}
        </View>
        <BottomTabs active={state.activeTab} pendingTasks={pendingTasks} onSelect={(tab) => relay.dispatch({ type: "selectTab", tab })} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: "center", backgroundColor: "#050607" },
  app: { flex: 1, width: "100%", maxWidth: 560, overflow: "hidden", backgroundColor: theme.canvas, borderLeftWidth: Platform.OS === "web" ? StyleSheet.hairlineWidth : 0, borderRightWidth: Platform.OS === "web" ? StyleSheet.hairlineWidth : 0, borderColor: theme.borderSubtle },
  header: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.x4, paddingTop: Platform.OS === "android" ? spacing.x2 : 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle, backgroundColor: theme.canvas },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent },
  brandMarkText: { color: theme.canvas, fontSize: 14, fontWeight: "900" },
  headerEyebrow: { color: theme.textMuted, fontSize: 7, fontWeight: "900", letterSpacing: 1.3 },
  headerTitle: { marginTop: 1, color: theme.textPrimary, fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.x2 },
  approvalBadge: { minWidth: 28, height: 28, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 7, borderRadius: 14, backgroundColor: "rgba(243,198,109,0.08)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(243,198,109,0.22)" },
  approvalBadgeText: { color: theme.warning, fontSize: 10, fontWeight: "800" },
  syncNotice: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: spacing.x2, paddingHorizontal: spacing.x4, paddingVertical: 6, backgroundColor: "rgba(243,198,109,0.055)", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(243,198,109,0.16)" },
  syncNoticeText: { flex: 1, color: theme.warning, fontSize: 9, lineHeight: 12 },
  content: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.x8 },
  loadingMark: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent },
  loadingTitle: { marginTop: spacing.x4, color: theme.textPrimary, fontSize: 16, fontWeight: "700" },
  loadingDetail: { marginTop: 5, color: theme.textMuted, fontSize: 12 },
  tabBar: { minHeight: Platform.OS === "ios" ? 76 : 64, flexDirection: "row", paddingTop: 4, paddingBottom: Platform.OS === "ios" ? 14 : 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle, backgroundColor: theme.surface1 },
  tab: { flex: 1, minWidth: 44, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 4 },
  tabPressed: { opacity: 0.55 },
  tabLabel: { color: theme.textMuted, fontSize: 9, fontWeight: "600" },
  tabLabelActive: { color: theme.accent },
  taskDot: { position: "absolute", right: -5, top: -2, width: 6, height: 6, borderRadius: 3, backgroundColor: theme.warning, borderWidth: 1, borderColor: theme.surface1 },
});
