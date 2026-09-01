import { Ionicons } from "@expo/vector-icons";
import { radii, spacing } from "@noudle-agents/design-tokens";
import type { Agent, Approval, Conversation, Message } from "@noudle-agents/protocol";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { RelayState } from "../model";
import { loadMessageDraft, saveMessageDraft } from "../lib/drafts";
import { AgentAvatar, Button, SectionHeader, StateNotice, StatusLabel, theme, uiStyles } from "../ui";

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function ConversationStrip({ agents, conversations, activeId, onSelect }: { agents: Agent[]; conversations: Conversation[]; activeId: string | null; onSelect: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripScroll} contentContainerStyle={styles.strip}>
      {conversations.map((conversation) => {
        const agent = agents.find((candidate) => candidate.id === conversation.memberAgentIds[0]);
        const active = conversation.id === activeId;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={conversation.id}
            onPress={() => onSelect(conversation.id)}
            style={({ pressed }) => [styles.conversationChip, active && styles.conversationChipActive, pressed && styles.pressed]}
          >
            {agent ? <AgentAvatar agent={agent} size={29} /> : <View style={styles.groupAvatar}><Ionicons name="people" size={14} color={theme.textSecondary} /></View>}
            <View>
              <Text numberOfLines={1} style={[styles.chipTitle, active && styles.chipTitleActive]}>{conversation.title}</Text>
              <Text style={styles.chipKind}>{conversation.kind === "group" ? `${conversation.memberAgentIds.length} agents` : agent?.status.replaceAll("_", " ")}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ApprovalCard({ approval, agent, onResolve }: { approval: Approval; agent?: Agent; onResolve: (decision: "approve" | "deny") => void }) {
  return (
    <View style={styles.approvalCard}>
      <View style={styles.approvalTop}>
        <View style={styles.shield}><Ionicons name="shield-checkmark-outline" size={18} color={theme.warning} /></View>
        <View style={styles.flex}>
          <Text style={styles.approvalTitle}>{approval.title}</Text>
          <Text style={styles.approvalMeta}>{agent?.name ?? "Agent"} · {approval.risk.replaceAll("_", " ")}</Text>
        </View>
      </View>
      <Text style={styles.approvalDescription}>{approval.description}</Text>
      <View style={styles.approvalActions}>
        <Button label="Deny" variant="danger" onPress={() => onResolve("deny")} style={styles.flex} />
        <Button label="Approve" variant="primary" onPress={() => onResolve("approve")} style={styles.flex} />
      </View>
    </View>
  );
}

function MessageBubble({ message, agent }: { message: Message; agent?: Agent }) {
  if (message.role === "system") {
    return (
      <View style={styles.systemMessage}>
        <View style={styles.systemLine} />
        <Text style={styles.systemText}>{message.content}</Text>
        <View style={styles.systemLine} />
      </View>
    );
  }
  const own = message.role === "user";
  return (
    <View style={[styles.messageRow, own && styles.messageRowOwn]}>
      {!own && agent ? <AgentAvatar agent={agent} size={27} /> : null}
      <View style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleAgent]}>
        {!own && agent ? <Text style={[styles.author, { color: agent.color }]}>{agent.name}</Text> : null}
        <Text style={styles.messageText}>{message.content}</Text>
        <Text style={styles.messageTime}>{timeLabel(message.createdAt)}</Text>
      </View>
    </View>
  );
}

export function ChatsScreen({
  state,
  onSelectConversation,
  onSend,
  onResolveApproval,
}: {
  state: RelayState;
  onSelectConversation: (id: string) => void;
  onSend: (conversationId: string, agentId: string, content: string) => Promise<void>;
  onResolveApproval: (approvalId: string, decision: "approve" | "deny") => void;
}) {
  const [draft, setDraft] = useState("");
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const conversation = state.conversations.find((item) => item.id === state.activeConversationId) ?? null;
  const conversationMessages = useMemo(
    () => state.messages.filter((message) => message.conversationId === conversation?.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [conversation?.id, state.messages],
  );
  const primaryAgent = state.agents.find((agent) => agent.id === conversation?.memberAgentIds[0]);
  const pendingApprovals = state.approvals.filter((approval) => approval.status === "pending" && (!conversation?.taskId || approval.taskId === conversation.taskId));

  useEffect(() => {
    const conversationId = conversation?.id;
    if (!conversationId) return;
    let disposed = false;
    setLoadedDraftId(null);
    void loadMessageDraft(conversationId).then((value) => {
      if (!disposed) { setDraft(value); setLoadedDraftId(conversationId); }
    });
    return () => { disposed = true; };
  }, [conversation?.id]);

  useEffect(() => {
    const conversationId = conversation?.id;
    if (!conversationId || loadedDraftId !== conversationId) return;
    const timer = setTimeout(() => void saveMessageDraft(conversationId, draft.slice(0, 20_000)), 250);
    return () => clearTimeout(timer);
  }, [conversation?.id, draft, loadedDraftId]);

  const submit = () => {
    const content = draft.trim();
    if (!content || !conversation || !primaryAgent) return;
    setDraft("");
    void saveMessageDraft(conversation.id, "");
    void onSend(conversation.id, primaryAgent.id, content);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  if (state.conversations.length === 0) {
    return <StateNotice icon="chatbubbles-outline" title="No conversations" detail="Create an agent on desktop, then return here to continue the same conversation." />;
  }

  return (
    <KeyboardAvoidingView style={uiStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={4}>
      <ConversationStrip agents={state.agents} conversations={state.conversations} activeId={conversation?.id ?? null} onSelect={onSelectConversation} />
      {conversation ? (
        <>
          <View style={styles.threadHeader}>
            <View style={styles.threadIdentity}>
              {primaryAgent ? <AgentAvatar agent={primaryAgent} size={38} /> : <View style={styles.groupAvatarLarge}><Ionicons name="people" size={17} color={theme.textSecondary} /></View>}
              <View style={styles.flex}>
                <Text style={styles.threadTitle}>{conversation.title}</Text>
                {primaryAgent ? <StatusLabel status={primaryAgent.status} /> : <Text style={styles.groupLabel}>Shared room · {conversation.memberAgentIds.length} agents</Text>}
              </View>
            </View>
            <Pressable accessibilityRole="button" style={styles.detailsButton}>
              <Ionicons name="ellipsis-horizontal" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            ref={scrollRef}
            style={styles.messageList}
            contentContainerStyle={styles.messageContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {pendingApprovals.length > 0 ? (
              <View>
                <SectionHeader title="Needs your approval" detail={`${pendingApprovals.length}`} />
                {pendingApprovals.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} agent={state.agents.find((agent) => agent.id === approval.agentId)} onResolve={(decision) => onResolveApproval(approval.id, decision)} />
                ))}
              </View>
            ) : null}
            {conversationMessages.length > 0 ? conversationMessages.map((message) => (
              <MessageBubble key={message.id} message={message} agent={state.agents.find((agent) => agent.id === message.authorId)} />
            )) : <StateNotice icon="sparkles-outline" title="Start the conversation" detail="Messages sent here continue this agent’s persistent Codex thread on every device." />}
          </ScrollView>
          <View style={styles.composerWrap}>
            <View style={styles.composer}>
              <Pressable accessibilityLabel="Attach file" accessibilityRole="button" style={styles.attachButton}>
                <Ionicons name="add" size={22} color={theme.textSecondary} />
              </Pressable>
              <TextInput
                accessibilityLabel={`Message ${conversation.title}`}
                multiline
                onChangeText={setDraft}
                onSubmitEditing={submit}
                placeholder={`Message ${conversation.title}`}
                placeholderTextColor={theme.textMuted}
                returnKeyType="send"
                style={styles.input}
                value={draft}
              />
              <Pressable accessibilityLabel="Send message" accessibilityRole="button" disabled={!draft.trim()} onPress={submit} style={({ pressed }) => [styles.sendButton, !draft.trim() && styles.sendDisabled, pressed && styles.pressed]}>
                <Ionicons name="arrow-up" size={19} color={theme.canvas} />
              </Pressable>
            </View>
            <Text style={styles.composerHint}>Agents may delegate this work. You’ll see every handoff.</Text>
          </View>
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stripScroll: { flexGrow: 0, minHeight: 74, maxHeight: 74 },
  strip: { gap: spacing.x2, paddingHorizontal: spacing.x4, paddingTop: spacing.x2, paddingBottom: spacing.x3 },
  conversationChip: { minWidth: 132, maxWidth: 170, minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle, backgroundColor: theme.surface1 },
  conversationChipActive: { borderColor: theme.borderStrong, backgroundColor: theme.surface2 },
  pressed: { opacity: 0.72 },
  groupAvatar: { width: 29, height: 29, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceHover },
  chipTitle: { maxWidth: 92, color: theme.textSecondary, fontSize: 13, fontWeight: "700" },
  chipTitleActive: { color: theme.textPrimary },
  chipKind: { maxWidth: 92, marginTop: 2, color: theme.textMuted, fontSize: 10, textTransform: "capitalize" },
  threadHeader: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.x4, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  threadIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.x3 },
  threadTitle: { color: theme.textPrimary, fontSize: 15, fontWeight: "700", marginBottom: 3 },
  groupAvatarLarge: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 },
  groupLabel: { color: theme.textMuted, fontSize: 11 },
  detailsButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  messageList: { flex: 1 },
  messageContent: { paddingHorizontal: spacing.x4, paddingTop: spacing.x2, paddingBottom: spacing.x6 },
  messageRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.x2, marginTop: spacing.x4, maxWidth: "88%" },
  messageRowOwn: { alignSelf: "flex-end", justifyContent: "flex-end" },
  bubble: { flexShrink: 1, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 15 },
  bubbleAgent: { flexShrink: 1, backgroundColor: theme.surface2, borderBottomLeftRadius: 4 },
  bubbleOwn: { backgroundColor: theme.accentQuiet, borderColor: "rgba(215,255,100,0.14)", borderWidth: StyleSheet.hairlineWidth, borderBottomRightRadius: 4 },
  author: { fontSize: 11, fontWeight: "800", marginBottom: 5 },
  messageText: { color: theme.textPrimary, fontSize: 14, lineHeight: 20 },
  messageTime: { alignSelf: "flex-end", color: theme.textMuted, fontSize: 9, marginTop: 5 },
  systemMessage: { flexDirection: "row", alignItems: "center", gap: spacing.x2, marginVertical: spacing.x4 },
  systemLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.borderSubtle },
  systemText: { maxWidth: "72%", color: theme.textMuted, fontSize: 10, textAlign: "center" },
  approvalCard: { padding: spacing.x4, marginBottom: spacing.x3, borderRadius: radii.card, backgroundColor: "rgba(243,198,109,0.055)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(243,198,109,0.24)" },
  approvalTop: { flexDirection: "row", alignItems: "center", gap: spacing.x3 },
  shield: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(243,198,109,0.10)" },
  approvalTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: "700" },
  approvalMeta: { marginTop: 3, color: theme.warning, fontSize: 10, textTransform: "capitalize" },
  approvalDescription: { color: theme.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.x3 },
  approvalActions: { flexDirection: "row", gap: spacing.x2, marginTop: spacing.x4 },
  composerWrap: { paddingHorizontal: spacing.x3, paddingTop: spacing.x2, paddingBottom: spacing.x2, backgroundColor: theme.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle },
  composer: { minHeight: 50, maxHeight: 126, flexDirection: "row", alignItems: "flex-end", gap: spacing.x2, padding: 5, borderRadius: 14, backgroundColor: theme.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderStrong },
  attachButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 40, maxHeight: 112, paddingTop: 10, paddingBottom: 9, color: theme.textPrimary, fontSize: 14 },
  sendButton: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent },
  sendDisabled: { opacity: 0.24 },
  composerHint: { color: theme.textMuted, fontSize: 9, textAlign: "center", marginTop: 5 },
});
