import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { Agent, Conversation, Message } from "@noudle-agents/protocol";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";

import { ComputerPanel } from "../components/ComputerOverlay";
import { loadMessageDraft, saveMessageDraft } from "../lib/drafts";
import { exactSlashCommand, matchingSlashCommands, type SlashCommand } from "../lib/slashCommands";
import { setVisibleConversation } from "../lib/pushNotifications";
import type { InstanceConfig, RelayState } from "../model";
import { ConnectorsScreen } from "./ConnectorsScreen";

const palette = {
  black: "#000000",
  header: "#111213",
  rowPressed: "#17191b",
  bubble: "#1b1d1f",
  bubbleOwn: "#2a2d30",
  composer: "#1b1d1f",
  send: "#34383c",
  separator: "#202224",
  text: "#f4f4f5",
  secondary: "#a3a5a8",
  muted: "#717478",
} as const;

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function statusLabel(status: string): string {
  if (status === "working" || status === "planning") return "working";
  if (status === "waiting_user") return "waiting for you";
  if (status === "waiting_agent") return "waiting";
  return status.replaceAll("_", " ");
}

function Initials({ agent, size = 54 }: { agent: Agent; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: agent.color }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.3 }]}>{agent.avatar.slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}

function directConversation(agent: Agent, conversations: Conversation[]): Conversation | null {
  return conversations.find((conversation) => conversation.kind === "direct" && conversation.memberAgentIds.includes(agent.id)) ?? null;
}

function AgentList({ state, onOpen, onOpenConnectors }: { state: RelayState; onOpen: (conversationId: string) => void; onOpenConnectors: () => void }) {
  const rows = useMemo(() => state.agents.map((agent) => {
    const conversation = directConversation(agent, state.conversations);
    const messages = conversation
      ? state.messages.filter((message) => message.conversationId === conversation.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];
    return { agent, conversation, lastMessage: messages[0] ?? null };
  }).sort((a, b) => {
    const aDate = a.lastMessage?.createdAt ?? a.conversation?.updatedAt ?? a.agent.updatedAt;
    const bDate = b.lastMessage?.createdAt ?? b.conversation?.updatedAt ?? b.agent.updatedAt;
    return bDate.localeCompare(aDate);
  }), [state.agents, state.conversations, state.messages]);

  return (
    <View style={styles.screen}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Chats</Text>
        <Pressable accessibilityLabel="Open connectors" accessibilityRole="button" onPress={onOpenConnectors} style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="power-plug-outline" size={22} color={palette.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.listContent}>
        {rows.map(({ agent, conversation, lastMessage }) => (
          <Pressable
            accessibilityLabel={`Chat with ${agent.name}`}
            accessibilityRole="button"
            disabled={!conversation}
            key={agent.id}
            onPress={() => conversation && onOpen(conversation.id)}
            style={({ pressed }) => [styles.agentRow, pressed && styles.agentRowPressed]}
          >
            <Initials agent={agent} />
            <View style={styles.agentCopy}>
              <View style={styles.agentTopLine}>
                <Text numberOfLines={1} style={styles.agentName}>{agent.name}</Text>
                {lastMessage ? <Text style={styles.rowTime}>{timeLabel(lastMessage.createdAt)}</Text> : null}
              </View>
              <Text numberOfLines={1} style={styles.preview}>
                {lastMessage?.content ?? statusLabel(agent.status)}
              </Text>
            </View>
          </Pressable>
        ))}
        {state.connection === "loading" && rows.length === 0 ? <Text style={styles.empty}>Loading…</Text> : null}
        {state.connection !== "loading" && rows.length === 0 ? <Text style={styles.empty}>No agents yet</Text> : null}
      </ScrollView>
    </View>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return <Text style={styles.systemMessage}>{message.content}</Text>;
  }

  const own = message.role === "user";
  return (
    <View style={[styles.messageRow, own && styles.messageRowOwn]}>
      <View style={[styles.messageBubble, own && styles.messageBubbleOwn]}>
        <Text style={styles.messageText}>{message.content}</Text>
        <Text style={styles.messageTime}>{timeLabel(message.createdAt)}</Text>
      </View>
    </View>
  );
}

function ChatThread({
  state,
  conversation,
  agent,
  config,
  connected,
  onBack,
  onClear,
  onSend,
}: {
  state: RelayState;
  conversation: Conversation;
  agent: Agent;
  config: InstanceConfig;
  connected: boolean;
  onBack: () => void;
  onClear: (conversationId: string) => Promise<Conversation>;
  onSend: (conversationId: string, agentId: string, content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [computerOpen, setComputerOpen] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const messages = useMemo(
    () => state.messages.filter((message) => message.conversationId === conversation.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [conversation.id, state.messages],
  );
  const commands = useMemo(() => matchingSlashCommands(draft), [draft]);
  const exactCommand = exactSlashCommand(draft);

  useEffect(() => {
    let disposed = false;
    setLoadedDraftId(null);
    void loadMessageDraft(conversation.id).then((value) => {
      if (!disposed) {
        setDraft(value);
        setLoadedDraftId(conversation.id);
      }
    });
    return () => { disposed = true; };
  }, [conversation.id]);

  useEffect(() => {
    if (loadedDraftId !== conversation.id) return;
    const timer = setTimeout(() => void saveMessageDraft(conversation.id, draft.slice(0, 20_000)), 250);
    return () => clearTimeout(timer);
  }, [conversation.id, draft, loadedDraftId]);

  const runCommand = async (command: SlashCommand) => {
    if (commandBusy) return;
    setDraft("");
    void saveMessageDraft(conversation.id, "");
    setCommandBusy(true);
    try {
      if (command === "/clear") await onClear(conversation.id);
    } finally {
      setCommandBusy(false);
    }
  };

  const submit = () => {
    const content = draft.trim();
    if (!content || commandBusy) return;
    const command = exactSlashCommand(content);
    if (command) {
      void runCommand(command);
      return;
    }
    if (commands.length > 0) return;
    setDraft("");
    void saveMessageDraft(conversation.id, "");
    void onSend(conversation.id, agent.id, content);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.threadHeader}>
        <Pressable accessibilityLabel="Back to chats" accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={palette.text} />
        </Pressable>
        <Initials agent={agent} size={38} />
        <View style={styles.threadCopy}>
          <Text numberOfLines={1} style={styles.threadName}>{agent.name}</Text>
          <Text numberOfLines={1} style={styles.threadStatus}>{statusLabel(agent.status)}</Text>
        </View>
        <Pressable
          accessibilityLabel={computerOpen ? "Close agent computer" : "Open agent computer"}
          accessibilityRole="button"
          accessibilityState={{ expanded: computerOpen }}
          onPress={() => setComputerOpen((value) => !value)}
          style={({ pressed }) => [styles.computerButton, computerOpen && styles.computerButtonActive, pressed && styles.pressed]}
        >
          <Ionicons name="desktop-outline" size={21} color={palette.text} />
        </Pressable>
      </View>

      {computerOpen ? <ComputerPanel agent={agent} config={config} connected={connected} /> : null}

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        {messages.length === 0 ? <Text style={styles.empty}>No messages yet</Text> : null}
      </ScrollView>

      <KeyboardStickyView>
        <View style={styles.composerBar}>
          {commands.length > 0 ? (
            <View accessibilityLabel="Commands" style={styles.slashMenu}>
              {commands.map((command) => (
                <Pressable
                  accessibilityLabel={`${command.value} ${command.label}`}
                  accessibilityRole="button"
                  disabled={commandBusy}
                  key={command.value}
                  onPress={() => void runCommand(command.value)}
                  style={({ pressed }) => [styles.slashCommand, pressed && styles.agentRowPressed]}
                >
                  <Ionicons name={command.icon} size={19} color={palette.secondary} />
                  <Text style={styles.slashValue}>{command.value}</Text>
                  <Text style={styles.slashLabel}>{command.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel={`Message ${agent.name}`}
              multiline
              onChangeText={setDraft}
              onSubmitEditing={submit}
              placeholder="Message"
              placeholderTextColor={palette.muted}
              returnKeyType="send"
              submitBehavior="submit"
              style={styles.input}
              value={draft}
            />
            <Pressable
              accessibilityLabel="Send message"
              accessibilityRole="button"
              disabled={!draft.trim() || commandBusy || (commands.length > 0 && !exactCommand)}
              onPress={submit}
              style={({ pressed }) => [styles.sendButton, (!draft.trim() || commandBusy || (commands.length > 0 && !exactCommand)) && styles.sendDisabled, pressed && styles.pressed]}
            >
              <Ionicons name="arrow-up" size={20} color={palette.text} />
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

export function ChatsScreen({
  config,
  connected,
  state,
  onSelectConversation,
  onSend,
  onClear,
  requestedConversationId,
  onRequestedConversationHandled,
}: {
  config: InstanceConfig;
  connected: boolean;
  state: RelayState;
  onSelectConversation: (id: string | null) => void;
  onSend: (conversationId: string, agentId: string, content: string) => Promise<void>;
  onClear: (conversationId: string) => Promise<Conversation>;
  requestedConversationId: string | null;
  onRequestedConversationHandled: () => void;
}) {
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const conversation = state.conversations.find((item) => item.id === openConversationId) ?? null;
  const agent = state.agents.find((item) => conversation?.memberAgentIds[0] === item.id) ?? null;

  useEffect(() => {
    if (openConversationId && !conversation) setOpenConversationId(null);
  }, [conversation, openConversationId]);

  useEffect(() => {
    if (requestedConversationId && state.conversations.some((item) => item.id === requestedConversationId)) {
      setConnectorsOpen(false);
      setOpenConversationId(requestedConversationId);
      onSelectConversation(requestedConversationId);
      onRequestedConversationHandled();
    }
  }, [onRequestedConversationHandled, onSelectConversation, requestedConversationId, state.conversations]);

  useEffect(() => {
    setVisibleConversation(conversation?.id ?? null);
    return () => setVisibleConversation(null);
  }, [conversation?.id]);

  const open = (conversationId: string) => {
    setOpenConversationId(conversationId);
    onSelectConversation(conversationId);
  };

  const back = () => {
    setOpenConversationId(null);
    onSelectConversation(null);
  };

  const clear = async (conversationId: string) => {
    const replacement = await onClear(conversationId);
    setOpenConversationId(replacement.id);
    onSelectConversation(replacement.id);
    return replacement;
  };

  if (connectorsOpen) {
    return <ConnectorsScreen agents={state.agents} config={config} connected={connected} onBack={() => setConnectorsOpen(false)} />;
  }

  if (conversation && agent) {
    return <ChatThread state={state} conversation={conversation} agent={agent} config={config} connected={connected} onBack={back} onClear={clear} onSend={onSend} />;
  }

  return <AgentList state={state} onOpen={open} onOpenConnectors={() => setConnectorsOpen(true)} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.black },
  listHeader: {
    height: Platform.OS === "ios" ? 102 : 72,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: palette.header,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.separator,
  },
  listTitle: { color: palette.text, fontSize: 30, fontWeight: "700", letterSpacing: -0.8 },
  headerIconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21 },
  listContent: { paddingBottom: 24 },
  agentRow: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingLeft: 16,
    paddingRight: 18,
  },
  agentRowPressed: { backgroundColor: palette.rowPressed },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#0b0c0e", fontWeight: "700", letterSpacing: -0.3 },
  agentCopy: {
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.separator,
  },
  agentTopLine: { flexDirection: "row", alignItems: "center", gap: 12 },
  agentName: { flex: 1, color: palette.text, fontSize: 16, fontWeight: "600" },
  rowTime: { color: palette.muted, fontSize: 12 },
  preview: { marginTop: 5, color: palette.secondary, fontSize: 14 },
  empty: { color: palette.muted, fontSize: 14, textAlign: "center", marginTop: 42 },
  threadHeader: {
    height: Platform.OS === "ios" ? 96 : 66,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingLeft: 4,
    paddingRight: 16,
    paddingBottom: 9,
    backgroundColor: palette.header,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.separator,
  },
  backButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  threadCopy: { flex: 1, height: 40, justifyContent: "center" },
  threadName: { color: palette.text, fontSize: 16, fontWeight: "600" },
  threadStatus: { marginTop: 2, color: palette.muted, fontSize: 12 },
  computerButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21 },
  computerButtonActive: { backgroundColor: palette.bubbleOwn },
  messages: { flex: 1, backgroundColor: palette.black },
  messageContent: { paddingHorizontal: 10, paddingTop: 12, paddingBottom: 12 },
  messageRow: { flexDirection: "row", marginBottom: 5, paddingRight: 54 },
  messageRowOwn: { justifyContent: "flex-end", paddingRight: 0, paddingLeft: 54 },
  messageBubble: {
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderRadius: 16,
    borderBottomLeftRadius: 5,
    backgroundColor: palette.bubble,
  },
  messageBubbleOwn: { borderBottomLeftRadius: 16, borderBottomRightRadius: 5, backgroundColor: palette.bubbleOwn },
  messageText: { color: palette.text, fontSize: 16, lineHeight: 21 },
  messageTime: { alignSelf: "flex-end", marginTop: 3, color: palette.muted, fontSize: 10 },
  systemMessage: { alignSelf: "center", maxWidth: "82%", marginVertical: 10, color: palette.muted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  composerBar: {
    paddingHorizontal: 8,
    paddingTop: 7,
    paddingBottom: Platform.OS === "ios" ? 24 : 8,
    backgroundColor: palette.black,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.separator,
  },
  slashMenu: {
    overflow: "hidden",
    marginBottom: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.separator,
    borderRadius: 12,
    backgroundColor: palette.composer,
  },
  slashCommand: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  slashValue: { color: palette.text, fontSize: 14, fontWeight: "700" },
  slashLabel: { color: palette.muted, fontSize: 13 },
  composer: {
    minHeight: 48,
    maxHeight: 124,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    paddingLeft: 14,
    paddingRight: 5,
    paddingVertical: 5,
    borderRadius: 24,
    backgroundColor: palette.composer,
  },
  input: { flex: 1, minHeight: 38, maxHeight: 110, paddingTop: 9, paddingBottom: 8, color: palette.text, fontSize: 16 },
  sendButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: palette.send },
  sendDisabled: { opacity: 0.28 },
  pressed: { opacity: 0.62 },
});
