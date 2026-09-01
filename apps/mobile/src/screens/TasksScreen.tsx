import { Ionicons } from "@expo/vector-icons";
import { radii, spacing } from "@noudle-agents/design-tokens";
import type { Agent, Task, TaskStatus } from "@noudle-agents/protocol";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AgentAvatar, Button, PressableRow, SectionHeader, StateNotice, theme, uiStyles } from "../ui";

const taskColor: Record<TaskStatus, string> = {
  draft: theme.textMuted,
  queued: theme.info,
  accepted: theme.info,
  running: theme.accent,
  waiting_agent: theme.warning,
  waiting_user: theme.warning,
  blocked: theme.danger,
  paused: theme.textSecondary,
  completed: theme.success,
  failed: theme.danger,
  cancelled: theme.textMuted,
};

function TaskStatusPill({ status }: { status: TaskStatus }) {
  const color = taskColor[status];
  return (
    <View style={[styles.statusPill, { borderColor: `${color}35`, backgroundColor: `${color}0D` }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{status.replaceAll("_", " ")}</Text>
    </View>
  );
}

function TaskRow({ task, owner, childCount, selected, onPress }: { task: Task; owner?: Agent; childCount: number; selected: boolean; onPress: () => void }) {
  return (
    <View style={[styles.treeRow, { paddingLeft: spacing.x4 + task.depth * 17 }]}>
      {task.depth > 0 ? <View style={[styles.treeStem, { left: spacing.x4 + task.depth * 17 - 11 }]} /> : null}
      <PressableRow accessibilityLabel={`Open task ${task.title}`} onPress={onPress} style={[styles.taskRow, selected ? styles.taskRowSelected : undefined]}>
        <View style={styles.taskBody}>
          <View style={styles.taskTopLine}>
            <Text numberOfLines={1} style={styles.taskTitle}>{task.title}</Text>
            <TaskStatusPill status={task.status} />
          </View>
          <View style={styles.taskMeta}>
            {owner ? (
              <View style={styles.owner}>
                <AgentAvatar agent={owner} size={20} showStatus={false} />
                <Text style={styles.ownerText}>{owner.name}</Text>
              </View>
            ) : <Text style={styles.unassigned}>Unassigned</Text>}
            {childCount > 0 ? <Text style={styles.childCount}>{childCount} subtask{childCount === 1 ? "" : "s"}</Text> : null}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
      </PressableRow>
    </View>
  );
}

function DelegateModal({ visible, agents, currentOwnerId, onClose, onSelect }: { visible: boolean; agents: Agent[]; currentOwnerId: string | null; onClose: () => void; onSelect: (agentId: string) => void }) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close delegation menu" onPress={onClose} style={styles.modalOverlay}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Delegate task</Text>
          <Text style={styles.sheetDescription}>Ownership changes immediately. The agent receives the objective, constraints, and linked context.</Text>
          <View style={styles.agentList}>
            {agents.map((agent) => (
              <PressableRow key={agent.id} accessibilityLabel={`Delegate to ${agent.name}`} onPress={() => onSelect(agent.id)} style={styles.agentRow}>
                <AgentAvatar agent={agent} size={40} />
                <View style={styles.flex}>
                  <Text style={styles.agentName}>{agent.name}</Text>
                  <Text style={styles.agentRole}>{agent.role}</Text>
                </View>
                {currentOwnerId === agent.id ? <Text style={styles.currentOwner}>CURRENT</Text> : <Ionicons name="arrow-forward" size={17} color={theme.textMuted} />}
              </PressableRow>
            ))}
          </View>
          <Button label="Cancel" onPress={onClose} variant="secondary" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TaskDetail({ task, owner, onDelegate, onClose }: { task: Task; owner?: Agent; onDelegate: () => void; onClose: () => void }) {
  const usedTokens = task.status === "completed" ? task.budget.maxTokens : Math.round(task.budget.maxTokens * 0.38);
  const percentage = Math.min(100, Math.round((usedTokens / task.budget.maxTokens) * 100));
  return (
    <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <View style={styles.flex}>
          <Text style={styles.detailEyebrow}>TASK DETAIL</Text>
          <Text style={styles.detailTitle}>{task.title}</Text>
        </View>
        <Pressable accessibilityLabel="Close task details" onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={21} color={theme.textSecondary} /></Pressable>
      </View>
      <TaskStatusPill status={task.status} />
      <Text style={styles.objective}>{task.objective}</Text>
      {task.blocker ? (
        <View style={styles.blocker}>
          <Ionicons name="pause-circle-outline" size={17} color={theme.warning} />
          <Text style={styles.blockerText}>{task.blocker}</Text>
        </View>
      ) : null}
      <SectionHeader title="Owner" />
      <View style={styles.ownerCard}>
        {owner ? <><AgentAvatar agent={owner} size={38} /><View style={styles.flex}><Text style={styles.agentName}>{owner.name}</Text><Text style={styles.agentRole}>{owner.role}</Text></View></> : <Text style={styles.unassigned}>No agent assigned</Text>}
        <Button label="Delegate" icon="git-branch-outline" variant="secondary" onPress={onDelegate} />
      </View>
      <SectionHeader title="Acceptance" detail={`${task.acceptanceCriteria.length}`} />
      {task.acceptanceCriteria.map((criterion) => (
        <View key={criterion} style={styles.criterion}>
          <Ionicons name={task.status === "completed" ? "checkmark-circle" : "ellipse-outline"} size={17} color={task.status === "completed" ? theme.success : theme.textMuted} />
          <Text style={styles.criterionText}>{criterion}</Text>
        </View>
      ))}
      <SectionHeader title="Token budget" detail={`${usedTokens.toLocaleString()} / ${task.budget.maxTokens.toLocaleString()}`} />
      <View style={styles.budgetTrack}><View style={[styles.budgetFill, { width: `${percentage}%` }]} /></View>
    </View>
  );
}

function orderedTasks(tasks: Task[]): Task[] {
  const result: Task[] = [];
  const visit = (parentId: string | null) => {
    tasks.filter((task) => task.parentTaskId === parentId).forEach((task) => {
      result.push(task);
      visit(task.id);
    });
  };
  visit(null);
  tasks.filter((task) => !result.includes(task)).forEach((task) => result.push(task));
  return result;
}

export function TasksScreen({ tasks, agents, onDelegate }: { tasks: Task[]; agents: Agent[]; onDelegate: (taskId: string, agentId: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [delegateVisible, setDelegateVisible] = useState(false);
  const ordered = useMemo(() => orderedTasks(tasks), [tasks]);
  const selected = tasks.find((task) => task.id === selectedId);
  const active = tasks.filter((task) => !["completed", "cancelled", "failed"].includes(task.status)).length;

  if (tasks.length === 0) return <StateNotice icon="git-branch-outline" title="No tasks yet" detail="Ask an agent to plan work or create a task from desktop. The full delegation tree will appear here." />;

  return (
    <ScrollView style={uiStyles.screen} contentContainerStyle={styles.content}>
      <View style={styles.summary}>
        <View><Text style={styles.summaryValue}>{active}</Text><Text style={styles.summaryLabel}>ACTIVE</Text></View>
        <View style={styles.summaryRule} />
        <View><Text style={styles.summaryValue}>{tasks.filter((task) => task.status === "completed").length}</Text><Text style={styles.summaryLabel}>DONE</Text></View>
        <View style={styles.summaryRule} />
        <View><Text style={styles.summaryValue}>{tasks.filter((task) => task.status === "blocked").length}</Text><Text style={styles.summaryLabel}>BLOCKED</Text></View>
      </View>
      <SectionHeader title="Task graph" detail={`${tasks.length} total`} />
      <View style={styles.taskList}>
        {ordered.map((task) => <TaskRow key={task.id} task={task} owner={agents.find((agent) => agent.id === task.ownerAgentId)} childCount={tasks.filter((candidate) => candidate.parentTaskId === task.id).length} selected={task.id === selectedId} onPress={() => setSelectedId(task.id)} />)}
      </View>
      {selected ? <TaskDetail task={selected} owner={agents.find((agent) => agent.id === selected.ownerAgentId)} onDelegate={() => setDelegateVisible(true)} onClose={() => setSelectedId(null)} /> : null}
      {selected ? (
        <DelegateModal visible={delegateVisible} agents={agents} currentOwnerId={selected.ownerAgentId} onClose={() => setDelegateVisible(false)} onSelect={(agentId) => { onDelegate(selected.id, agentId); setDelegateVisible(false); }} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.x4, paddingBottom: 130 },
  summary: { minHeight: 82, flexDirection: "row", alignItems: "center", justifyContent: "space-around", marginTop: spacing.x3, borderRadius: radii.card, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  summaryValue: { color: theme.textPrimary, fontSize: 22, fontWeight: "700", textAlign: "center" },
  summaryLabel: { marginTop: 3, color: theme.textMuted, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  summaryRule: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: theme.borderSubtle },
  taskList: { overflow: "hidden", borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle, backgroundColor: theme.surface1 },
  treeRow: { position: "relative" },
  treeStem: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: theme.borderStrong },
  taskRow: { flexDirection: "row", alignItems: "center", paddingRight: spacing.x4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  taskRowSelected: { backgroundColor: theme.surface2 },
  taskBody: { flex: 1, paddingVertical: spacing.x3 },
  taskTopLine: { flexDirection: "row", alignItems: "center", gap: spacing.x2 },
  taskTitle: { flex: 1, color: theme.textPrimary, fontSize: 13, fontWeight: "700" },
  taskMeta: { flexDirection: "row", alignItems: "center", gap: spacing.x3, marginTop: spacing.x2 },
  owner: { flexDirection: "row", alignItems: "center", gap: 6 },
  ownerText: { color: theme.textSecondary, fontSize: 11 },
  childCount: { color: theme.textMuted, fontSize: 10 },
  unassigned: { color: theme.textMuted, fontSize: 11, fontStyle: "italic" },
  statusPill: { alignSelf: "flex-start", height: 24, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  detailCard: { marginTop: spacing.x4, padding: spacing.x4, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderStrong, backgroundColor: theme.surface1 },
  detailHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.x3 },
  detailEyebrow: { color: theme.textMuted, fontSize: 9, fontWeight: "800", letterSpacing: 1.2, marginBottom: 5 },
  detailTitle: { color: theme.textPrimary, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  closeButton: { width: 44, height: 44, marginTop: -10, marginRight: -10, alignItems: "center", justifyContent: "center" },
  objective: { color: theme.textSecondary, fontSize: 13, lineHeight: 20, marginTop: spacing.x3 },
  blocker: { flexDirection: "row", gap: spacing.x2, padding: spacing.x3, marginTop: spacing.x3, borderRadius: radii.control, backgroundColor: "rgba(243,198,109,0.07)" },
  blockerText: { flex: 1, color: theme.warning, fontSize: 12, lineHeight: 17 },
  ownerCard: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.x3 },
  agentName: { color: theme.textPrimary, fontSize: 14, fontWeight: "700" },
  agentRole: { marginTop: 2, color: theme.textMuted, fontSize: 11 },
  criterion: { flexDirection: "row", alignItems: "flex-start", gap: spacing.x2, marginBottom: 10 },
  criterionText: { flex: 1, color: theme.textSecondary, fontSize: 12, lineHeight: 17 },
  budgetTrack: { height: 5, overflow: "hidden", borderRadius: 3, backgroundColor: theme.surfaceHover },
  budgetFill: { height: "100%", borderRadius: 3, backgroundColor: theme.accent },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: theme.overlay },
  sheet: { paddingHorizontal: spacing.x4, paddingTop: spacing.x3, paddingBottom: 34, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderStrong, backgroundColor: theme.surface1 },
  sheetHandle: { alignSelf: "center", width: 34, height: 4, borderRadius: 2, backgroundColor: theme.borderStrong, marginBottom: spacing.x6 },
  sheetTitle: { color: theme.textPrimary, fontSize: 20, fontWeight: "700" },
  sheetDescription: { color: theme.textMuted, fontSize: 12, lineHeight: 18, marginTop: spacing.x2 },
  agentList: { marginVertical: spacing.x4, overflow: "hidden", borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  agentRow: { flexDirection: "row", alignItems: "center", gap: spacing.x3, paddingHorizontal: spacing.x3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  currentOwner: { color: theme.accent, fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
});
