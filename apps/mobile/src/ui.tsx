import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing, statusColors } from "@noudle-agents/design-tokens";
import type { Agent, AgentStatus } from "@noudle-agents/protocol";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

export const theme = {
  ...colors,
  overlay: "rgba(5, 6, 7, 0.88)",
  white08: "rgba(255,255,255,0.08)",
  white04: "rgba(255,255,255,0.04)",
};

export function IconButton({
  icon,
  label,
  onPress,
  tone = "quiet",
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  tone?: "quiet" | "accent" | "danger";
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, tone === "accent" && styles.iconAccent, tone === "danger" && styles.iconDanger, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={20} color={tone === "accent" ? theme.canvas : tone === "danger" ? theme.danger : theme.textPrimary} />
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  variant = "secondary",
  icon,
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  icon?: ComponentProps<typeof Ionicons>["name"];
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const foreground = variant === "primary" ? theme.canvas : variant === "danger" ? theme.danger : theme.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[`button_${variant}`], style, pressed && styles.pressed, (disabled || loading) && styles.disabled]}
    >
      {loading ? <ActivityIndicator color={foreground} size="small" /> : icon ? <Ionicons name={icon} size={17} color={foreground} /> : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function AgentAvatar({ agent, size = 40, showStatus = true }: { agent: Agent; size?: number; showStatus?: boolean }) {
  const statusColor = statusColors[agent.status];
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, borderColor: `${agent.color}55` }]}>
        <Text style={[styles.avatarText, { color: agent.color, fontSize: Math.max(10, size * 0.27) }]}>{agent.avatar.slice(0, 2).toUpperCase()}</Text>
      </View>
      {showStatus ? <View style={[styles.avatarStatus, { backgroundColor: statusColor, borderColor: theme.surface1 }]} /> : null}
    </View>
  );
}

export function StatusLabel({ status }: { status: AgentStatus | string }) {
  const readable = status.replaceAll("_", " ");
  const color = status in statusColors ? statusColors[status as AgentStatus] : theme.textMuted;
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{readable}</Text>
    </View>
  );
}

export function StateNotice({ icon, title, detail, action }: { icon: ComponentProps<typeof Ionicons>["name"]; title: string; detail: string; action?: ReactNode }) {
  return (
    <View style={styles.stateNotice}>
      <View style={styles.noticeIcon}><Ionicons name={icon} size={21} color={theme.textSecondary} /></View>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeDetail}>{detail}</Text>
      {action ? <View style={styles.noticeAction}>{action}</View> : null}
    </View>
  );
}

export function ConnectionPill({ connection, source }: { connection: "loading" | "live" | "offline" | "error"; source: "server" | "demo" }) {
  const live = connection === "live";
  return (
    <View accessibilityLabel={live ? "Connected live" : "Offline demo mode"} style={[styles.connection, live && styles.connectionLive]}>
      <View style={[styles.connectionDot, { backgroundColor: live ? theme.success : theme.warning }]} />
      <Text style={[styles.connectionText, live && styles.connectionTextLive]}>{live ? "Live" : source === "demo" ? "Demo" : "Offline"}</Text>
    </View>
  );
}

export function PressableRow({ children, onPress, accessibilityLabel, style, ...props }: Omit<PressableProps, "style" | "onPress" | "accessibilityLabel"> & { children: ReactNode; accessibilityLabel: string; onPress: PressableProps["onPress"]; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" onPress={onPress} {...props} style={({ pressed }) => [styles.pressableRow, style, pressed && styles.rowPressed]}>
      {children}
    </Pressable>
  );
}

export const uiStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  screenContent: { paddingHorizontal: spacing.x4, paddingBottom: 120 },
  eyebrow: { color: theme.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { color: theme.textPrimary, fontSize: 27, fontWeight: "700", letterSpacing: -0.8 },
  body: { color: theme.textSecondary, fontSize: 15, lineHeight: 22 },
  muted: { color: theme.textMuted, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: theme.surface1, borderColor: theme.borderSubtle, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.borderSubtle },
});

const styles = StyleSheet.create({
  iconButton: { alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: radii.control, backgroundColor: theme.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle },
  iconAccent: { backgroundColor: theme.accent, borderColor: theme.accent },
  iconDanger: { backgroundColor: "rgba(255,125,132,0.08)", borderColor: "rgba(255,125,132,0.26)" },
  button: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.x2, paddingHorizontal: spacing.x4, borderRadius: radii.control, borderWidth: StyleSheet.hairlineWidth },
  button_primary: { backgroundColor: theme.accent, borderColor: theme.accent },
  button_secondary: { backgroundColor: theme.surface2, borderColor: theme.borderStrong },
  button_danger: { backgroundColor: "rgba(255,125,132,0.08)", borderColor: "rgba(255,125,132,0.28)" },
  button_ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  buttonText: { fontSize: 14, fontWeight: "700", letterSpacing: -0.1 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.4 },
  sectionHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.x6, marginBottom: spacing.x3 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.x2 },
  sectionTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: "700" },
  sectionDetail: { color: theme.textMuted, fontSize: 12 },
  avatar: { alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2, borderWidth: 1 },
  avatarText: { fontWeight: "800", letterSpacing: 0.4 },
  avatarStatus: { position: "absolute", width: 10, height: 10, borderRadius: 5, right: -1, bottom: 0, borderWidth: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
  stateNotice: { minHeight: 260, alignItems: "center", justifyContent: "center", padding: spacing.x8 },
  noticeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2, marginBottom: spacing.x4 },
  noticeTitle: { color: theme.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 6 },
  noticeDetail: { maxWidth: 280, color: theme.textMuted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  noticeAction: { marginTop: spacing.x4 },
  connection: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: "rgba(243,198,109,0.08)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(243,198,109,0.22)" },
  connectionLive: { backgroundColor: "rgba(114,214,160,0.07)", borderColor: "rgba(114,214,160,0.18)" },
  connectionDot: { width: 6, height: 6, borderRadius: 3 },
  connectionText: { color: theme.warning, fontSize: 11, fontWeight: "700" },
  connectionTextLive: { color: theme.success },
  pressableRow: { minHeight: 54 },
  rowPressed: { backgroundColor: theme.surfaceHover },
});
