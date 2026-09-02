import { Ionicons } from "@expo/vector-icons";
import { RelayApiClient } from "@noudle-agents/api-client";
import type { Agent, ConnectorAuthType, ConnectorProvider, ConnectorSummary, CreateCustomConnectorInput } from "@noudle-agents/protocol";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { InstanceConfig } from "../model";

const colors = {
  black: "#000000",
  header: "#111213",
  card: "#17181b",
  raised: "#242529",
  field: "#0d0e10",
  border: "#2b2d30",
  text: "#f3f3f4",
  secondary: "#a3a5a8",
  muted: "#717478",
  danger: "#e89090",
  dangerQuiet: "#2a1b1d",
  action: "#ededeb",
  actionText: "#101113",
} as const;

const PROVIDERS: ConnectorProvider[] = ["github", "resend", "notion", "stripe", "firebase"];
const META: Record<ConnectorProvider, { name: string; credential: string; placeholder: string; icon: keyof typeof Ionicons.glyphMap }> = {
  github: { name: "GitHub", credential: "Personal access token", placeholder: "github_pat_…", icon: "logo-github" },
  resend: { name: "Resend", credential: "API key", placeholder: "re_…", icon: "mail-outline" },
  notion: { name: "Notion", credential: "Integration token", placeholder: "ntn_…", icon: "document-text-outline" },
  stripe: { name: "Stripe", credential: "Secret or restricted API key", placeholder: "sk_… or rk_…", icon: "card-outline" },
  firebase: { name: "Firebase", credential: "Firebase CLI refresh token", placeholder: "1//…", icon: "flame-outline" },
};

const EMPTY_CUSTOM: CreateCustomConnectorInput = {
  name: "",
  baseUrl: "",
  authType: "bearer",
  headerName: null,
  authPrefix: "",
  secret: "",
};

function creator(connector: ConnectorSummary, agents: Agent[]): string {
  if (!connector.createdById) return "Shared workspace connector";
  if (connector.createdByType === "user") return "Shared · added by you";
  return `Shared · added by ${agents.find((agent) => agent.id === connector.createdById)?.name ?? "an agent"}`;
}

export function ConnectorsScreen({ agents, config, connected, onBack }: { agents: Agent[]; config: InstanceConfig; connected: boolean; onBack: () => void }) {
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [editing, setEditing] = useState<ConnectorProvider | "custom" | null>(null);
  const [secret, setSecret] = useState("");
  const [custom, setCustom] = useState<CreateCustomConnectorInput>(EMPTY_CUSTOM);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ConnectorSummary | null>(null);
  const api = useMemo(
    () => connected && config.baseUrl && config.token ? new RelayApiClient(config.baseUrl, config.token) : null,
    [config.baseUrl, config.token, connected],
  );

  useEffect(() => {
    if (!api) {
      setConnectors([]);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const items = await api.listConnectors();
        if (active) {
          setConnectors(items);
          setError(null);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load connectors.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api]);

  const update = (connector: ConnectorSummary) => {
    setConnectors((items) => items.some((item) => item.id === connector.id)
      ? items.map((item) => item.id === connector.id ? connector : item)
      : [...items, connector]);
  };

  const connectProvider = async (provider: ConnectorProvider) => {
    if (!api || !secret.trim() || busy) return;
    setBusy(provider);
    setError(null);
    try {
      update(await api.connectConnector(provider, secret));
      setEditing(null);
      setSecret("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connection failed.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (connector: ConnectorSummary) => {
    if (!api || busy) return false;
    setBusy(connector.id);
    setError(null);
    try {
      await api.deleteConnector(connector.id);
      setConnectors(await api.listConnectors());
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove connector.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const requestRemoval = (connector: ConnectorSummary) => {
    setError(null);
    setPendingRemoval(connector);
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    if (await remove(pendingRemoval)) setPendingRemoval(null);
  };

  const createCustom = async () => {
    if (!api || !custom.name.trim() || !custom.baseUrl.trim() || !custom.secret.trim() || busy) return;
    setBusy("custom");
    setError(null);
    try {
      update(await api.createConnector(custom));
      setCustom(EMPTY_CUSTOM);
      setEditing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create connector.");
    } finally {
      setBusy(null);
    }
  };

  const builtins = connectors.filter((connector) => connector.kind === "builtin");
  const customConnectors = connectors.filter((connector) => connector.kind === "custom");
  const canSaveCustom = Boolean(api && custom.name.trim() && custom.baseUrl.trim() && custom.secret.trim() && !busy);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back to chats" accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Connectors</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.toolbar}>
          <Pressable
            accessibilityLabel="New connector"
            accessibilityRole="button"
            onPress={() => {
              setEditing((current) => current === "custom" ? null : "custom");
              setError(null);
            }}
            style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
          >
            <Ionicons name="add" size={16} color={colors.actionText} />
            <Text style={styles.newButtonText}>New connector</Text>
          </Pressable>
        </View>

        {editing === "custom" ? (
          <View style={styles.formCard}>
            <TextInput autoCapitalize="words" autoFocus onChangeText={(name) => setCustom({ ...custom, name })} placeholder="Name" placeholderTextColor={colors.muted} style={styles.field} value={custom.name} />
            <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={(baseUrl) => setCustom({ ...custom, baseUrl })} placeholder="HTTPS base URL" placeholderTextColor={colors.muted} style={styles.field} value={custom.baseUrl} />
            <View style={styles.authChoices}>
              {(["bearer", "header", "basic"] as ConnectorAuthType[]).map((authType) => (
                <Pressable key={authType} onPress={() => setCustom({ ...custom, authType })} style={[styles.authChoice, custom.authType === authType && styles.authChoiceActive]}>
                  <Text style={[styles.authChoiceText, custom.authType === authType && styles.authChoiceTextActive]}>{authType === "header" ? "API header" : authType}</Text>
                </Pressable>
              ))}
            </View>
            {custom.authType === "header" ? <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={(headerName) => setCustom({ ...custom, headerName })} placeholder="Header name" placeholderTextColor={colors.muted} style={styles.field} value={custom.headerName ?? ""} /> : null}
            <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={(secretValue) => setCustom({ ...custom, secret: secretValue })} placeholder="Secret · encrypted after saving" placeholderTextColor={colors.muted} secureTextEntry style={styles.field} value={custom.secret} />
            <View style={styles.formActions}>
              <Pressable onPress={() => setEditing(null)} style={({ pressed }) => [styles.mutedButton, pressed && styles.pressed]}><Text style={styles.mutedButtonText}>Cancel</Text></Pressable>
              <Pressable disabled={!canSaveCustom} onPress={() => void createCustom()} style={({ pressed }) => [styles.saveButton, !canSaveCustom && styles.disabled, pressed && styles.pressed]}><Text style={styles.saveButtonText}>{busy === "custom" ? "Saving…" : "Save for team"}</Text></Pressable>
            </View>
          </View>
        ) : null}

        {PROVIDERS.map((provider) => {
          const meta = META[provider];
          const connector = builtins.find((item) => item.provider === provider);
          const isConnected = Boolean(connector?.connected);
          const isEditing = editing === provider && !isConnected;
          return (
            <View key={provider} style={styles.connectorCard}>
              <View style={styles.connectorMain}>
                <View style={styles.connectorMark}><Ionicons name={meta.icon} size={20} color={colors.text} /></View>
                <View style={styles.connectorCopy}>
                  <Text style={styles.connectorName}>{meta.name}</Text>
                  <Text numberOfLines={1} style={styles.connectorDetail}>{isConnected && connector ? `${connector.accountLabel ?? "Connected"} · ${creator(connector, agents)}` : "Built-in connector"}</Text>
                </View>
                {isConnected ? (
                  <Pressable disabled={busy === connector?.id} onPress={() => connector && requestRemoval(connector)} style={({ pressed }) => [styles.mutedButton, pressed && styles.pressed]}><Text style={styles.mutedButtonText}>{busy === connector?.id ? "…" : "Disconnect"}</Text></Pressable>
                ) : (
                  <Pressable disabled={!api} onPress={() => { setEditing(provider); setSecret(""); setError(null); }} style={({ pressed }) => [styles.connectButton, !api && styles.disabled, pressed && styles.pressed]}><Text style={styles.connectButtonText}>Connect</Text></Pressable>
                )}
              </View>
              {isEditing ? (
                <View style={styles.providerForm}>
                  <TextInput autoCapitalize="none" autoCorrect={false} autoFocus onChangeText={setSecret} placeholder={meta.placeholder} placeholderTextColor={colors.muted} secureTextEntry style={[styles.field, styles.providerField]} value={secret} />
                  <Pressable onPress={() => { setEditing(null); setSecret(""); }} style={({ pressed }) => [styles.mutedButton, pressed && styles.pressed]}><Text style={styles.mutedButtonText}>Cancel</Text></Pressable>
                  <Pressable disabled={!secret.trim() || busy === provider} onPress={() => void connectProvider(provider)} style={({ pressed }) => [styles.saveButton, (!secret.trim() || busy === provider) && styles.disabled, pressed && styles.pressed]}><Text style={styles.saveButtonText}>{busy === provider ? "Connecting…" : "Save"}</Text></Pressable>
                </View>
              ) : null}
            </View>
          );
        })}

        {customConnectors.map((connector) => (
          <View key={connector.id} style={styles.connectorCard}>
            <View style={styles.connectorMain}>
              <View style={[styles.connectorMark, styles.customMark]}><Ionicons name="globe-outline" size={20} color={colors.text} /></View>
              <View style={styles.connectorCopy}><Text style={styles.connectorName}>{connector.name}</Text><Text numberOfLines={1} style={styles.connectorDetail}>{connector.accountLabel} · {creator(connector, agents)}</Text></View>
              <Pressable disabled={busy === connector.id} onPress={() => requestRemoval(connector)} style={({ pressed }) => [styles.mutedButton, pressed && styles.pressed]}><Text style={styles.mutedButtonText}>{busy === connector.id ? "…" : "Remove"}</Text></Pressable>
            </View>
          </View>
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!connected ? <Text style={styles.offline}>Connect the app to your instance to manage connectors.</Text> : null}
      </ScrollView>

      <Modal animationType="fade" transparent visible={Boolean(pendingRemoval)} onRequestClose={() => { if (!busy) setPendingRemoval(null); }}>
        <Pressable
          accessibilityLabel="Close connector confirmation"
          onPress={() => { if (!busy) setPendingRemoval(null); }}
          style={styles.confirmBackdrop}
        >
          <Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()} style={styles.confirmDialog}>
            <View style={styles.confirmIcon}>
              <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
            </View>
            <Text style={styles.confirmTitle}>
              {pendingRemoval?.kind === "custom" ? `Remove ${pendingRemoval.name}?` : `Disconnect ${pendingRemoval?.name ?? "connector"}?`}
            </Text>
            <Text style={styles.confirmBody}>
              {pendingRemoval?.kind === "custom"
                ? "Are you sure you want to remove this connector? It will no longer be available to the workspace."
                : "Are you sure you want to disconnect this connector? It can be connected again later."}
            </Text>
            {error ? <Text style={styles.confirmError}>{error}</Text> : null}
            <View style={styles.confirmActions}>
              <Pressable disabled={Boolean(busy)} onPress={() => setPendingRemoval(null)} style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressed]}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable disabled={Boolean(busy)} onPress={() => void confirmRemoval()} style={({ pressed }) => [styles.confirmDestructive, busy && styles.disabled, pressed && styles.pressed]}>
                <Text style={styles.confirmDestructiveText}>
                  {busy ? (pendingRemoval?.kind === "custom" ? "Removing…" : "Disconnecting…") : (pendingRemoval?.kind === "custom" ? "Remove" : "Disconnect")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  header: { height: Platform.OS === "ios" ? 102 : 72, flexDirection: "row", alignItems: "flex-end", gap: 4, paddingLeft: 4, paddingRight: 18, paddingBottom: 12, backgroundColor: colors.header, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 28, fontWeight: "700", letterSpacing: -0.7, lineHeight: 40 },
  content: { gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 44 },
  toolbar: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 4 },
  newButton: { height: 34, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, borderRadius: 9, backgroundColor: colors.action },
  newButtonText: { color: colors.actionText, fontSize: 12, fontWeight: "700" },
  connectorCard: { overflow: "hidden", borderRadius: 12, backgroundColor: colors.card },
  connectorMain: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  connectorMark: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.raised },
  customMark: { backgroundColor: "#202225" },
  connectorCopy: { flex: 1, minWidth: 0 },
  connectorName: { color: colors.text, fontSize: 14, fontWeight: "600" },
  connectorDetail: { marginTop: 3, color: colors.muted, fontSize: 11 },
  connectButton: { height: 32, minWidth: 70, alignItems: "center", justifyContent: "center", paddingHorizontal: 11, borderRadius: 9, backgroundColor: colors.action },
  connectButtonText: { color: colors.actionText, fontSize: 11, fontWeight: "700" },
  mutedButton: { height: 32, alignItems: "center", justifyContent: "center", paddingHorizontal: 11, borderRadius: 9, backgroundColor: colors.raised },
  mutedButtonText: { color: colors.secondary, fontSize: 11, fontWeight: "600" },
  formCard: { gap: 8, padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  field: { height: 42, paddingHorizontal: 12, borderRadius: 9, color: colors.text, fontSize: 13, backgroundColor: colors.field, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  authChoices: { flexDirection: "row", gap: 6 },
  authChoice: { flex: 1, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.field },
  authChoiceActive: { backgroundColor: colors.raised },
  authChoiceText: { color: colors.muted, fontSize: 11, textTransform: "capitalize" },
  authChoiceTextActive: { color: colors.text, fontWeight: "600" },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 7 },
  saveButton: { height: 32, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: 9, backgroundColor: colors.action },
  saveButtonText: { color: colors.actionText, fontSize: 11, fontWeight: "700" },
  providerForm: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 60, paddingRight: 10, paddingBottom: 10 },
  providerField: { flex: 1, minWidth: 0, height: 36 },
  error: { paddingHorizontal: 5, paddingTop: 4, color: "#e49b9b", fontSize: 12, lineHeight: 17 },
  offline: { paddingHorizontal: 5, paddingTop: 10, color: colors.muted, fontSize: 12, textAlign: "center" },
  confirmBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, backgroundColor: "rgba(0,0,0,0.72)" },
  confirmDialog: { width: "100%", maxWidth: 360, padding: 20, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  confirmIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", marginBottom: 16, borderRadius: 12, backgroundColor: colors.dangerQuiet },
  confirmTitle: { color: colors.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  confirmBody: { marginTop: 8, color: colors.muted, fontSize: 13, lineHeight: 19 },
  confirmError: { marginTop: 12, color: colors.danger, fontSize: 12, lineHeight: 17 },
  confirmActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 22 },
  confirmCancel: { height: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.raised },
  confirmCancelText: { color: colors.secondary, fontSize: 13, fontWeight: "600" },
  confirmDestructive: { height: 40, alignItems: "center", justifyContent: "center", minWidth: 104, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.dangerQuiet },
  confirmDestructiveText: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.62 },
});
