import { Ionicons } from "@expo/vector-icons";
import type { Agent } from "@noudle-agents/protocol";
import { StatusBar } from "expo-status-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { type ComputerSession, WorkspaceApi } from "../lib/workspaceApi";
import type { InstanceConfig } from "../model";

const colors = {
  black: "#000000",
  surface: "#141516",
  raised: "#1d1f21",
  border: "#2b2d30",
  text: "#f3f3f4",
  muted: "#797c80",
} as const;

function ComputerFrame({ session, config, controlled }: { session: ComputerSession | null; config: InstanceConfig; controlled: boolean }) {
  const streamUrl = useMemo(
    () => session?.computerUrl ? new WorkspaceApi(config.baseUrl, config.token).computerViewUrl(session.id) : null,
    [config.baseUrl, config.token, session?.computerUrl, session?.id],
  );

  if (!streamUrl) {
    return (
      <View style={styles.empty}>
        <Ionicons name="desktop-outline" size={25} color={colors.muted} />
        <Text style={styles.emptyText}>{session ? "Computer is starting" : "No active computer"}</Text>
      </View>
    );
  }

  return (
    <WebView
      key={streamUrl}
      accessibilityLabel="Live agent computer"
      allowFileAccess={false}
      allowsLinkPreview={false}
      domStorageEnabled
      javaScriptEnabled
      originWhitelist={["http://*", "https://*"]}
      sharedCookiesEnabled={false}
      source={{ uri: streamUrl, headers: { authorization: `Bearer ${config.token}` } }}
      pointerEvents={controlled ? "auto" : "none"}
      style={styles.webView}
    />
  );
}

export function ComputerPanel({ agent, config, connected }: { agent: Agent; config: InstanceConfig; connected: boolean }) {
  const [sessions, setSessions] = useState<ComputerSession[]>([]);
  const [fullScreen, setFullScreen] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const api = useMemo(
    () => connected && config.baseUrl && config.token ? new WorkspaceApi(config.baseUrl, config.token) : null,
    [config.baseUrl, config.token, connected],
  );
  const session = sessions.find((item) => item.agentId === agent.id && item.status === "running")
    ?? sessions.find((item) => item.status === "running")
    ?? sessions[0]
    ?? null;
  const controlled = session?.controlMode === "user";

  useEffect(() => {
    if (!api) {
      setSessions([]);
      return;
    }
    let disposed = false;
    const load = async () => {
      try {
        const next = await api.listComputers();
        if (!disposed) setSessions(next);
      } catch {
        if (!disposed) setSessions([]);
      }
    };
    void load();
    const interval = setInterval(() => void load(), 5_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [api]);

  useEffect(() => () => {
    if (fullScreen) void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, [fullScreen]);

  const expand = async () => {
    setFullScreen(true);
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch {
      // The full-screen viewer still works when a platform refuses orientation locking.
    }
  };

  const collapse = async () => {
    setFullScreen(false);
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch {
      // Returning to the compact viewer is independent of orientation support.
    }
  };

  const toggleControl = async () => {
    if (!api || !session || controlBusy) return;
    setControlBusy(true);
    try {
      const updated = controlled
        ? await api.returnComputer(session.id)
        : await api.takeoverComputer(session.id, 300);
      setSessions((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch {
      // The next session refresh keeps the displayed control state authoritative.
    } finally {
      setControlBusy(false);
    }
  };

  const controlLabel = controlled ? "Give back control" : "Take control";
  const controlButton = (floating: boolean) => (
    <Pressable
      accessibilityLabel={controlLabel}
      accessibilityRole="button"
      disabled={!session || !api || controlBusy}
      onPress={() => void toggleControl()}
      style={({ pressed }) => [
        floating ? styles.floatingControlButton : styles.controlButton,
        controlled && styles.controlButtonActive,
        pressed && styles.pressed,
        (!session || !api || controlBusy) && styles.disabled,
      ]}
    >
      <Ionicons name={controlled ? "return-down-back-outline" : "hand-left-outline"} size={17} color={colors.text} />
      <Text style={styles.controlButtonText}>{controlBusy ? "Updating…" : controlLabel}</Text>
    </Pressable>
  );

  return (
    <>
      <View style={styles.panel}>
        <View style={styles.compactFrame}>
          <ComputerFrame session={session} config={config} controlled={controlled} />
          <Pressable accessibilityLabel="Open computer full screen" accessibilityRole="button" onPress={() => void expand()} style={({ pressed }) => [styles.expandButton, pressed && styles.pressed]}>
            <Ionicons name="expand-outline" size={19} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.compactControls}>{controlButton(false)}</View>
      </View>

      <Modal animationType="fade" onRequestClose={() => void collapse()} presentationStyle="fullScreen" supportedOrientations={["landscape-left", "landscape-right"]} visible={fullScreen}>
        <StatusBar hidden />
        <View style={styles.fullScreen}>
          <ComputerFrame session={session} config={config} controlled={controlled} />
          {controlButton(true)}
          <Pressable accessibilityLabel="Exit computer full screen" accessibilityRole="button" onPress={() => void collapse()} style={({ pressed }) => [styles.collapseButton, pressed && styles.pressed]}>
            <Ionicons name="contract-outline" size={21} color={colors.text} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactFrame: { width: "100%", aspectRatio: 16 / 9, overflow: "hidden", backgroundColor: colors.black },
  compactControls: { padding: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  webView: { flex: 1, backgroundColor: colors.black },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: colors.black },
  emptyText: { color: colors.muted, fontSize: 12 },
  fullScreen: { flex: 1, backgroundColor: colors.black },
  expandButton: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: "rgba(29,31,33,0.92)",
  },
  controlButton: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 9,
    backgroundColor: colors.raised,
  },
  floatingControlButton: {
    position: "absolute",
    top: 14,
    left: 16,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: "rgba(29,31,33,0.92)",
  },
  controlButtonActive: { backgroundColor: "#303235" },
  controlButtonText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  collapseButton: {
    position: "absolute",
    top: 14,
    right: 16,
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.55 },
});
