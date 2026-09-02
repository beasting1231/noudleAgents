import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { decodeMobilePairingPayload } from "@noudle-agents/protocol";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { InstanceConfig } from "../model";

const colors = {
  black: "#000000",
  surface: "#151617",
  border: "#2b2d30",
  text: "#f4f4f5",
  muted: "#7a7d81",
} as const;

function parsePairingCode(data: string): InstanceConfig {
  try {
    const decoded = decodeMobilePairingPayload(data);
    return { baseUrl: decoded.baseUrl.replace(/\/$/, ""), token: decoded.token.trim() };
  } catch {
    throw new Error("This is not a noudleAgents connection code.");
  }
}

export function ConnectionScreen({ connecting, onConnect }: { connecting: boolean; onConnect: (config: InstanceConfig) => Promise<boolean> }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlingScan = useRef(false);

  const openScanner = async () => {
    setError(null);
    const nextPermission = permission?.granted ? permission : await requestPermission();
    if (!nextPermission.granted) {
      setError("Camera access is required to scan the connection code.");
      return;
    }
    handlingScan.current = false;
    setScannerOpen(true);
  };

  const scan = async ({ data }: BarcodeScanningResult) => {
    if (handlingScan.current) return;
    handlingScan.current = true;
    try {
      const config = parsePairingCode(data);
      const connected = await onConnect(config);
      if (!connected) {
        setScannerOpen(false);
        setError("Could not reach this VPS. Check that it is online and accessible from this phone.");
      }
    } catch (caught) {
      setScannerOpen(false);
      setError(caught instanceof Error ? caught.message : "Could not read the connection code.");
    } finally {
      handlingScan.current = false;
    }
  };

  if (scannerOpen) {
    return (
      <View style={styles.cameraScreen}>
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          facing="back"
          onBarcodeScanned={connecting ? undefined : (result) => void scan(result)}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.cameraShade}>
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>{connecting ? "Connecting…" : "Point at the QR code on your desktop"}</Text>
        </View>
        <Pressable accessibilityLabel="Close QR scanner" accessibilityRole="button" onPress={() => setScannerOpen(false)} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <Pressable accessibilityLabel="Scan QR to connect" accessibilityRole="button" disabled={connecting} onPress={() => void openScanner()} style={({ pressed }) => [styles.scanButton, connecting && styles.disabled, pressed && styles.pressed]}>
          <Ionicons name="qr-code-outline" size={20} color={colors.black} />
          <Text style={styles.scanButtonText}>{connecting ? "Connecting…" : "Scan QR to connect"}</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingBottom: 30 },
  scanButton: { height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 20, borderRadius: 25, backgroundColor: colors.text },
  scanButtonText: { color: colors.black, fontSize: 15, fontWeight: "700" },
  error: { maxWidth: 310, marginTop: 18, color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  cameraScreen: { flex: 1, overflow: "hidden", backgroundColor: colors.black },
  cameraShade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.28)" },
  scanFrame: { width: 260, height: 260, borderRadius: 22, borderWidth: 2, borderColor: colors.text, backgroundColor: "transparent" },
  scanHint: { marginTop: 20, color: colors.text, fontSize: 14, fontWeight: "600" },
  closeButton: { position: "absolute", top: 58, left: 18, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: "rgba(21,22,23,0.9)" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.62 },
});
