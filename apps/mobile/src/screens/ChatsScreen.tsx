import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { Agent, Conversation, Message, MessageResponsePart, Run } from "@noudle-agents/protocol";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  Platform,
  Pressable,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardChatScrollView, KeyboardStickyView } from "react-native-keyboard-controller";

import { ComputerPanel } from "../components/ComputerOverlay";
import { MobileResponseContent } from "../components/MobileResponseContent";
import { ShimmerText } from "../components/ShimmerText";
import { loadMessageDraft, saveMessageDraft } from "../lib/drafts";
import { exactSlashCommand, matchingSlashCommands, type SlashCommand } from "../lib/slashCommands";
import { setVisibleConversation } from "../lib/pushNotifications";
import { type ArtifactRecord, WorkspaceApi, type UploadAsset } from "../lib/workspaceApi";
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

const COMPOSER_LINE_HEIGHT = 22;
const COMPOSER_MAX_HEIGHT = 110;

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function statusLabel(status: string): string {
  if (status === "working" || status === "planning") return "working";
  if (status === "waiting_user") return "waiting for you";
  if (status === "waiting_agent") return "waiting";
  return status.replaceAll("_", " ");
}

function runActivityLabel(run: Run | null, liveParts: MessageResponsePart[] | undefined, agent: Agent): "Thinking" | "Working" | null {
  if (run?.status === "queued" || run?.status === "starting") return "Thinking";
  if (run?.status === "running") return liveParts?.some((part) => part.type === "tool" || part.text.trim()) ? "Working" : "Thinking";
  if (!run && (agent.status === "queued" || agent.status === "planning")) return "Thinking";
  if (!run && agent.status === "working") return "Working";
  return null;
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

function MessageBubble({ message, config, onOpenImage }: { message: Message; config: InstanceConfig; onOpenImage: (image: { uri: string; name: string; headers: Record<string, string> }) => void }) {
  if (message.role === "system") {
    return <Text style={styles.systemMessage}>{message.content}</Text>;
  }

  const own = message.role === "user";
  return (
    <View style={[styles.messageRow, own && styles.messageRowOwn]}>
      <View style={[styles.messageBubble, !own && styles.messageBubbleAgent, own && styles.messageBubbleOwn]}>
        {message.attachments?.map((attachment) => {
          const uri = `${config.baseUrl.replace(/\/$/, "")}/v1/artifacts/${encodeURIComponent(attachment.artifactId)}/download`;
          const headers = { authorization: `Bearer ${config.token}` };
          return attachment.mimeType.startsWith("image/")
            ? <Pressable accessibilityLabel={`Open ${attachment.name} fullscreen`} key={attachment.artifactId} onPress={() => onOpenImage({ uri, name: attachment.name, headers })}><Image source={{ uri, headers }} style={styles.messageImageAttachment} /></Pressable>
            : <View style={styles.messageAttachment} key={attachment.artifactId}><Ionicons name="document-outline" size={17} color={palette.secondary} /><Text numberOfLines={1} style={styles.messageAttachmentName}>{attachment.name}</Text></View>;
        })}
        {message.content ? own ? <Text style={styles.messageText}>{message.content}</Text> : <MobileResponseContent content={message.content} parts={message.responseParts} /> : null}
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
  activeRun,
  liveParts,
  onBack,
  onClear,
  onSend,
  onStop,
}: {
  state: RelayState;
  conversation: Conversation;
  agent: Agent;
  config: InstanceConfig;
  connected: boolean;
  activeRun: Run | null;
  liveParts?: MessageResponsePart[];
  onBack: () => void;
  onClear: (conversationId: string) => Promise<Conversation>;
  onSend: (conversationId: string, agentId: string, content: string, attachmentIds?: string[]) => Promise<void>;
  onStop: (conversationId: string, agentId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [computerOpen, setComputerOpen] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(80);
  const [inputHeight, setInputHeight] = useState(COMPOSER_LINE_HEIGHT);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ artifact: ArtifactRecord; previewUri: string | null }>>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<{ uri: string; name: string; headers?: Record<string, string> } | null>(null);
  const workspaceApi = useMemo(() => new WorkspaceApi(config.baseUrl, config.token), [config.baseUrl, config.token]);
  const scrollRef = useRef<ComponentRef<typeof KeyboardChatScrollView>>(null);
  const messages = useMemo(
    () => state.messages.filter((message) => message.conversationId === conversation.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [conversation.id, state.messages],
  );
  const commands = useMemo(() => matchingSlashCommands(draft), [draft]);
  const exactCommand = exactSlashCommand(draft);
  const activityLabel = runActivityLabel(activeRun, liveParts, agent);

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
    setInputHeight(COMPOSER_LINE_HEIGHT);
    void saveMessageDraft(conversation.id, "");
    setCommandBusy(true);
    try {
      if (command === "/clear") await onClear(conversation.id);
      if (command === "/stop") await onStop(conversation.id, agent.id);
    } finally {
      setCommandBusy(false);
    }
  };

  const submit = async () => {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || commandBusy || attachmentBusy || sending) return;
    const command = exactSlashCommand(content);
    if (command) {
      void runCommand(command);
      return;
    }
    if (commands.length > 0) return;
    const attachmentIds = attachments.map(({ artifact }) => artifact.id);
    setSending(true);
    setAttachmentError(null);
    try {
      await onSend(conversation.id, agent.id, content, attachmentIds);
      setDraft("");
      setInputHeight(COMPOSER_LINE_HEIGHT);
      void saveMessageDraft(conversation.id, "");
      setAttachments([]);
      setAttachmentMenuOpen(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const uploadAssets = async (assets: UploadAsset[]) => {
    const available = assets.slice(0, Math.max(0, 10 - attachments.length));
    if (available.length === 0 || attachmentBusy) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
    setAttachmentMenuOpen(false);
    try {
      for (const asset of available) {
        const artifact = await workspaceApi.uploadArtifact(asset, { agentId: agent.id });
        setAttachments((current) => [...current, { artifact, previewUri: asset.mimeType.startsWith("image/") ? asset.uri : null }]);
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Attachment could not be uploaded.");
    } finally {
      setAttachmentBusy(false);
    }
  };
  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setAttachmentError("Camera access is required to take a photo."); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (!result.canceled) await uploadAssets(result.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName ?? `camera-${Date.now()}-${index + 1}.jpg`, mimeType: asset.mimeType ?? "image/jpeg", size: asset.fileSize })));
  };
  const choosePhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 1 });
    if (!result.canceled) await uploadAssets(result.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}-${index + 1}.jpg`, mimeType: asset.mimeType ?? "image/jpeg", size: asset.fileSize })));
  };
  const chooseFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!result.canceled) await uploadAssets(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? "application/octet-stream", size: asset.size, file: asset.file })));
  };
  const pasteClipboard = async (payload: Clipboard.PasteEventPayload) => {
    if (payload.type === "text") { setDraft((current) => `${current}${payload.text}`); return; }
    const base64 = payload.data.replace(/^data:image\/(?:png|jpeg);base64,/, "");
    const uri = `${FileSystem.cacheDirectory}clipboard-${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    await uploadAssets([{ uri, name: `clipboard-${Date.now()}.png`, mimeType: "image/png" }]);
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

      <KeyboardChatScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        keyboardLiftBehavior="always"
        offset={composerHeight}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.map((message) => <MessageBubble config={config} key={message.id} message={message} onOpenImage={(image) => setFullscreenImage(image)} />)}
        {liveParts?.length ? <View style={styles.liveResponse}><MobileResponseContent content={liveParts.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n\n")} parts={liveParts} /></View> : null}
        {activityLabel ? <View accessibilityLiveRegion="polite" style={styles.runActivity}><ShimmerText>{activityLabel}</ShimmerText></View> : null}
        {messages.length === 0 && !activityLabel ? <Text style={styles.empty}>No messages yet</Text> : null}
      </KeyboardChatScrollView>

      <KeyboardStickyView onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}>
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
          {attachments.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentTray}>{attachments.map(({ artifact, previewUri }) => previewUri ? <View style={styles.imageAttachment} key={artifact.id}><Pressable accessibilityLabel={`Open ${artifact.name} fullscreen`} onPress={() => setFullscreenImage({ uri: previewUri, name: artifact.name })}><Image source={{ uri: previewUri }} style={styles.attachmentPreview} /></Pressable><Pressable accessibilityLabel={`Remove ${artifact.name}`} onPress={() => setAttachments((current) => current.filter(({ artifact: item }) => item.id !== artifact.id))} style={styles.imageAttachmentRemove}><Ionicons name="close" size={14} color={palette.text} /></Pressable></View> : <View style={styles.attachmentChip} key={artifact.id}><Ionicons name="document-outline" size={20} color={palette.secondary} /><Text numberOfLines={1} style={styles.attachmentName}>{artifact.name}</Text><Pressable accessibilityLabel={`Remove ${artifact.name}`} onPress={() => setAttachments((current) => current.filter(({ artifact: item }) => item.id !== artifact.id))} style={styles.attachmentRemove}><Ionicons name="close" size={14} color={palette.text} /></Pressable></View>)}</ScrollView> : null}
          {attachmentError ? <Text style={styles.attachmentError}>{attachmentError}</Text> : null}
          <View style={styles.composerRow}>
            <View style={styles.attachmentButtonWrap}>
              {attachmentMenuOpen ? <View style={styles.attachmentMenu}>
                <Pressable onPress={() => void takePhoto()} style={styles.attachmentMenuItem}><Ionicons name="camera-outline" size={21} color={palette.text} /><Text style={styles.attachmentMenuText}>Camera</Text></Pressable>
                <Pressable onPress={() => void choosePhotos()} style={styles.attachmentMenuItem}><Ionicons name="images-outline" size={21} color={palette.text} /><Text style={styles.attachmentMenuText}>Photos</Text></Pressable>
                <Pressable onPress={() => void chooseFiles()} style={styles.attachmentMenuItem}><Ionicons name="folder-outline" size={21} color={palette.text} /><Text style={styles.attachmentMenuText}>Files</Text></Pressable>
                {Platform.OS === "ios" && Clipboard.isPasteButtonAvailable ? <Clipboard.ClipboardPasteButton acceptedContentTypes={["image"]} backgroundColor={palette.composer} foregroundColor={palette.text} cornerStyle="medium" onPress={(payload) => void pasteClipboard(payload)} style={styles.clipboardPasteButton} /> : null}
              </View> : null}
              <Pressable accessibilityLabel="Add attachment" accessibilityRole="button" disabled={attachmentBusy || attachments.length >= 10} onPress={() => setAttachmentMenuOpen((open) => !open)} style={({ pressed }) => [styles.attachmentButton, pressed && styles.pressed, (attachmentBusy || attachments.length >= 10) && styles.sendDisabled]}><Ionicons name={attachmentMenuOpen ? "close" : "add"} size={25} color={palette.text} /></Pressable>
            </View>
            <View style={styles.composer}>
              <View style={[styles.inputShell, { height: Math.max(38, inputHeight) }]}>
                <Text
                  accessible={false}
                  onTextLayout={(event) => setInputHeight(Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_LINE_HEIGHT, event.nativeEvent.lines.length * COMPOSER_LINE_HEIGHT)))}
                  pointerEvents="none"
                  style={styles.inputMeasure}
                >
                  {`${draft}\u200b`}
                </Text>
                <TextInput
                  accessibilityLabel={`Message ${agent.name}`}
                  blurOnSubmit={false}
                  multiline
                  onChangeText={(value) => {
                    setDraft(value);
                    if (!value) setInputHeight(COMPOSER_LINE_HEIGHT);
                  }}
                  placeholder="Message"
                  placeholderTextColor={palette.muted}
                  returnKeyType="default"
                  scrollEnabled={inputHeight >= COMPOSER_MAX_HEIGHT}
                  style={[styles.input, { height: inputHeight }]}
                  value={draft}
                />
              </View>
              <Pressable
                accessibilityLabel="Send message"
                accessibilityRole="button"
                disabled={(!draft.trim() && attachments.length === 0) || commandBusy || attachmentBusy || sending || (commands.length > 0 && !exactCommand)}
                onPress={() => void submit()}
                style={({ pressed }) => [styles.sendButton, ((!draft.trim() && attachments.length === 0) || commandBusy || attachmentBusy || sending || (commands.length > 0 && !exactCommand)) && styles.sendDisabled, pressed && styles.pressed]}
              >
                <Ionicons name="arrow-up" size={20} color={palette.text} />
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardStickyView>
      <Modal animationType="fade" onRequestClose={() => setFullscreenImage(null)} presentationStyle="fullScreen" statusBarTranslucent transparent visible={Boolean(fullscreenImage)}>
        <Pressable accessibilityLabel="Close fullscreen image" accessibilityRole="button" onPress={() => setFullscreenImage(null)} style={styles.imageLightbox}>
          {fullscreenImage ? <Image accessibilityLabel={fullscreenImage.name} resizeMode="contain" source={{ uri: fullscreenImage.uri, headers: fullscreenImage.headers }} style={styles.imageLightboxImage} /> : null}
          <View style={styles.imageLightboxClose}><Ionicons name="close" size={25} color={palette.text} /></View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function ChatsScreen({
  config,
  connected,
  state,
  runs,
  liveResponses,
  onSelectConversation,
  onSend,
  onClear,
  onStop,
  requestedConversationId,
  onRequestedConversationHandled,
}: {
  config: InstanceConfig;
  connected: boolean;
  state: RelayState;
  runs: Run[];
  liveResponses: Record<string, MessageResponsePart[]>;
  onSelectConversation: (id: string | null) => void;
  onSend: (conversationId: string, agentId: string, content: string, attachmentIds?: string[]) => Promise<void>;
  onClear: (conversationId: string) => Promise<Conversation>;
  onStop: (conversationId: string, agentId: string) => Promise<void>;
  requestedConversationId: string | null;
  onRequestedConversationHandled: () => void;
}) {
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const conversation = state.conversations.find((item) => item.id === openConversationId) ?? null;
  const agent = state.agents.find((item) => conversation?.memberAgentIds[0] === item.id) ?? null;
  const activeRun = conversation && agent ? [...runs].reverse().find((run) => run.conversationId === conversation.id && run.agentId === agent.id && ["queued", "starting", "running", "waiting_approval", "waiting_user"].includes(run.status)) ?? null : null;

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
    return <ChatThread state={state} conversation={conversation} agent={agent} config={config} connected={connected} activeRun={activeRun} liveParts={activeRun ? liveResponses[activeRun.id] : undefined} onBack={back} onClear={clear} onSend={onSend} onStop={onStop} />;
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
  messageRow: { flexDirection: "row", marginBottom: 5 },
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
  messageBubbleAgent: { width: "100%", paddingHorizontal: 7, paddingTop: 9, paddingBottom: 9, borderRadius: 0, backgroundColor: "transparent" },
  messageText: { color: palette.text, fontSize: 16, lineHeight: 21 },
  liveResponse: { width: "100%", marginTop: 6, marginBottom: 12, paddingHorizontal: 7 },
  runActivity: { width: "100%", minHeight: 30, justifyContent: "center", marginBottom: 10, paddingHorizontal: 7 },
  messageAttachment: { minWidth: 160, maxWidth: 260, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)" },
  messageImageAttachment: { width: 180, height: 180, marginBottom: 6, borderRadius: 12 },
  messageAttachmentName: { flex: 1, color: palette.text, fontSize: 13 },
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
  attachmentTray: { gap: 7, paddingBottom: 7 },
  imageAttachment: { position: "relative", width: 64, height: 64 },
  attachmentChip: { width: 148, height: 48, flexDirection: "row", alignItems: "center", gap: 7, padding: 5, borderRadius: 12, backgroundColor: palette.composer },
  attachmentPreview: { width: 64, height: 64, borderRadius: 11 },
  imageAttachmentRemove: { position: "absolute", top: 3, right: 3, width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "rgba(8,8,9,0.76)" },
  attachmentName: { flex: 1, color: palette.text, fontSize: 11 },
  attachmentRemove: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: palette.send },
  attachmentError: { marginBottom: 6, paddingHorizontal: 6, color: "#ff969b", fontSize: 12 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 7 },
  attachmentButtonWrap: { position: "relative" },
  attachmentButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: palette.composer },
  attachmentMenu: { position: "absolute", zIndex: 20, bottom: 56, left: 0, width: 178, overflow: "hidden", padding: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: "#383a3d", borderRadius: 16, backgroundColor: "#242629", shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  attachmentMenuItem: { height: 44, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 10, borderRadius: 10 },
  attachmentMenuText: { color: palette.text, fontSize: 15, fontWeight: "500" },
  clipboardPasteButton: { width: 166, height: 42 },
  imageLightbox: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.96)" },
  imageLightboxImage: { width: "100%", height: "100%" },
  imageLightboxClose: { position: "absolute", top: Platform.OS === "ios" ? 54 : 20, right: 18, width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "rgba(255,255,255,0.14)" },
  composer: {
    flex: 1,
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
  inputShell: { position: "relative", flex: 1, minHeight: 38, maxHeight: COMPOSER_MAX_HEIGHT, justifyContent: "center" },
  inputMeasure: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0, fontSize: 16, lineHeight: COMPOSER_LINE_HEIGHT },
  input: { width: "100%", minHeight: COMPOSER_LINE_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT, paddingTop: 0, paddingBottom: 0, color: palette.text, fontSize: 16, lineHeight: COMPOSER_LINE_HEIGHT, textAlignVertical: "top" },
  sendButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: palette.send },
  sendDisabled: { opacity: 0.28 },
  pressed: { opacity: 0.62 },
});
