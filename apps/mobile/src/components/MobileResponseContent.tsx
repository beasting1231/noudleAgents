import { Ionicons } from "@expo/vector-icons";
import type { MessageResponsePart } from "@noudle-agents/protocol";
import * as Clipboard from "expo-clipboard";
import { useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";

const colors = {
  text: "#dedfe1",
  strong: "#f4f4f2",
  secondary: "#a4a9b0",
  muted: "#737982",
  border: "#292d33",
  panel: "#111315",
  code: "#0d0f12",
  panelHead: "#15181c",
  link: "#8fc8ff",
  success: "#70bd91",
  danger: "#ee777d",
  info: "#8fc8ff",
} as const;

const mono = Platform.OS === "ios" ? "Menlo" : "monospace";

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function displayJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function mobileDiffCounts(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" hitSlop={8} onPress={() => void copy()} style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}>
      <Ionicons name={copied ? "checkmark" : "copy-outline"} size={13} color={copied ? colors.success : colors.muted} />
    </Pressable>
  );
}

function InlineMarkdown({ value, style }: { value: string; style?: TextStyle | TextStyle[] }) {
  const pattern = /(\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  const tokens = value.split(pattern).filter(Boolean);
  return (
    <Text selectable style={[styles.bodyText, style]}>
      {tokens.map((token, index) => {
        const link = token.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)$/);
        if (link) return <Text accessibilityRole="link" key={index} onPress={() => void Linking.openURL(link[2]!)} style={styles.link}>{link[1]}</Text>;
        if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) return <Text key={index} style={styles.strong}>{token.slice(2, -2)}</Text>;
        if (token.startsWith("~~") && token.endsWith("~~")) return <Text key={index} style={styles.strike}>{token.slice(2, -2)}</Text>;
        if (token.startsWith("`") && token.endsWith("`")) return <Text key={index} style={styles.inlineCode}>{token.slice(1, -1)}</Text>;
        if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) return <Text key={index} style={styles.emphasis}>{token.slice(1, -1)}</Text>;
        return token;
      })}
    </Text>
  );
}

function Diff({ value }: { value: string }) {
  return (
    <ScrollView horizontal style={styles.diffViewport} showsHorizontalScrollIndicator={false}>
      <View style={styles.diffContent}>{value.split("\n").map((line, index) => {
        const kind = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "delete" : line.startsWith("@@") ? "hunk" : "context";
        return (
          <View key={`${index}-${line}`} style={[styles.diffLine, kind === "add" && styles.diffAdd, kind === "delete" && styles.diffDelete, kind === "hunk" && styles.diffHunk]}>
            <Text style={[styles.diffMark, kind === "add" && styles.diffAddMark, kind === "delete" && styles.diffDeleteMark]}>{kind === "add" ? "+" : kind === "delete" ? "−" : " "}</Text>
            <Text selectable style={[styles.diffText, kind === "add" && styles.diffAddText, kind === "delete" && styles.diffDeleteText, kind === "hunk" && styles.diffHunkText]}>{line || " "}</Text>
          </View>
        );
      })}</View>
    </ScrollView>
  );
}

function CodeBlock({ value, language = "" }: { value: string; language?: string }) {
  const isDiff = language.toLowerCase() === "diff" || /^(diff --git|@@ |--- |\+\+\+ )/m.test(value);
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLanguage}>{language || (isDiff ? "diff" : "code")}</Text>
        <CopyButton value={value} label={isDiff ? "Copy diff" : "Copy code"} />
      </View>
      {isDiff ? <Diff value={value} /> : <ScrollView horizontal showsHorizontalScrollIndicator={false}><Text selectable style={styles.codeText}>{value}</Text></ScrollView>}
    </View>
  );
}

function Table({ rows }: { rows: string[][] }) {
  const columns = Math.max(...rows.map((row) => row.length));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableViewport}>
      <View>{rows.map((row, rowIndex) => (
        <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHead]}>
          {Array.from({ length: columns }, (_, columnIndex) => <View key={columnIndex} style={styles.tableCell}><InlineMarkdown value={row[columnIndex]?.trim() ?? ""} style={rowIndex === 0 ? styles.tableHeadText : styles.tableText} /></View>)}
        </View>
      ))}</View>
    </ScrollView>
  );
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

export function RichMobileText({ value }: { value: string }) {
  const blocks = value.split(/(```[^\n]*\n?[\s\S]*?```)/g).filter((block) => block.length > 0);
  return (
    <View style={styles.richContent}>{blocks.map((block, blockIndex) => {
      if (block.startsWith("```")) {
        const firstBreak = block.indexOf("\n");
        const language = firstBreak >= 0 ? block.slice(3, firstBreak).trim() : "";
        const body = (firstBreak >= 0 ? block.slice(firstBreak + 1) : block.slice(3)).replace(/```$/, "").trimEnd();
        return <CodeBlock key={blockIndex} language={language} value={body} />;
      }

      const lines = block.split("\n");
      const rendered: ReactNode[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        const next = lines[index + 1] ?? "";
        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
        const unordered = line.match(/^(\s*)[-*+]\s+(.+)$/);
        const ordered = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
        const quote = line.match(/^>\s?(.*)$/);
        if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(next)) {
          const rows = [splitTableRow(line)];
          index += 2;
          while (index < lines.length && lines[index]!.includes("|")) { rows.push(splitTableRow(lines[index]!)); index += 1; }
          index -= 1;
          rendered.push(<Table key={`table-${index}`} rows={rows} />);
        } else if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
          rendered.push(<View key={index} style={styles.rule} />);
        } else if (!line.trim()) {
          rendered.push(<View key={index} style={styles.spacer} />);
        } else if (heading) {
          const headingStyle = [styles.h1, styles.h2, styles.h3, styles.h4][heading[1]!.length - 1];
          rendered.push(<InlineMarkdown key={index} value={heading[2]!} style={headingStyle} />);
        } else if (task) {
          const checked = task[1]!.toLowerCase() === "x";
          rendered.push(<View key={index} style={styles.listRow}><Ionicons name={checked ? "checkbox" : "square-outline"} size={15} color={checked ? colors.success : colors.muted} style={styles.taskIcon} /><InlineMarkdown value={task[2]!} style={checked ? styles.checkedText : undefined} /></View>);
        } else if (unordered || ordered) {
          const match = unordered ?? ordered!;
          rendered.push(<View key={index} style={[styles.listRow, { paddingLeft: Math.min(match[1]!.length * 7, 21) }]}><Text style={styles.listMarker}>{ordered ? `${line.trim().match(/^\d+/)?.[0]}.` : "•"}</Text><InlineMarkdown value={match[2]!} /></View>);
        } else if (quote) {
          rendered.push(<View key={index} style={styles.quote}><InlineMarkdown value={quote[1]!} style={styles.quoteText} /></View>);
        } else {
          rendered.push(<InlineMarkdown key={index} value={line} />);
        }
      }
      return <View key={blockIndex}>{rendered}</View>;
    })}</View>
  );
}

type ToolBody = { kind: "code" | "prose"; value: string } | { kind: "files"; changes: Array<Record<string, unknown>> };
type ToolPresentation = { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; body?: ToolBody; open?: boolean };

function toolPresentation(part: Extract<MessageResponsePart, { type: "tool" }>): ToolPresentation {
  const data = part.data;
  if (part.toolType === "commandExecution") {
    const command = stringValue(data.command);
    const output = stringValue(data.output);
    return { icon: "terminal-outline", title: `Ran ${command.split("\n")[0] || "command"}`, subtitle: stringValue(data.cwd), body: output ? { kind: "code", value: output } : undefined };
  }
  if (part.toolType === "fileChange") {
    const changes = Array.isArray(data.changes) ? data.changes as Array<Record<string, unknown>> : [];
    return { icon: "code-slash-outline", title: `${part.status === "failed" ? "Could not edit" : "Edited"} ${changes.length || 1} ${changes.length === 1 ? "file" : "files"}`, subtitle: changes.map((change) => stringValue(change.path)).filter(Boolean).join(", "), body: { kind: "files", changes }, open: true };
  }
  if (part.toolType === "webSearch") {
    const action = data.action && typeof data.action === "object" ? data.action as Record<string, unknown> : {};
    return { icon: "search-outline", title: "Searched the web", subtitle: stringValue(data.query) || stringValue(action.query) };
  }
  if (part.toolType === "imageView") return { icon: "eye-outline", title: "Viewed image", subtitle: stringValue(data.path) };
  if (part.toolType === "reasoning") {
    const detail = stringValue(data.text) || displayJson(data.summary);
    return { icon: "sparkles-outline", title: "Thought through the request", body: detail ? { kind: "prose", value: detail } : undefined };
  }
  if (part.toolType === "plan") {
    const detail = stringValue(data.text) || displayJson(data.summary);
    return { icon: "checkmark-circle-outline", title: "Updated the plan", body: detail ? { kind: "prose", value: detail } : undefined };
  }
  if (part.toolType === "collabAgentToolCall" || part.toolType === "subAgentActivity") return { icon: "people-outline", title: "Coordinated with an agent", subtitle: stringValue(data.tool) || stringValue(data.agentPath) };
  if (part.toolType === "mcpToolCall" || part.toolType === "dynamicToolCall") {
    const context = data.appContext && typeof data.appContext === "object" ? data.appContext as Record<string, unknown> : {};
    const app = stringValue(context.appName);
    const server = stringValue(data.server);
    const tool = stringValue(data.tool);
    const detail = displayJson(data.result ?? data.error ?? data.arguments);
    return { icon: "construct-outline", title: `Used ${app || tool || server || "tool"}`, subtitle: app ? [server, tool].filter(Boolean).join(" · ") : server, body: detail ? { kind: "code", value: detail } : undefined };
  }
  if (part.toolType === "imageGeneration") return { icon: "image-outline", title: "Generated an image" };
  const detail = Object.keys(data).length ? displayJson(data) : "";
  return { icon: "construct-outline", title: stringValue(data.tool) ? `Used ${stringValue(data.tool)}` : part.toolType.replace(/([a-z])([A-Z])/g, "$1 $2"), body: detail ? { kind: "code", value: detail } : undefined };
}

function FileChanges({ changes }: { changes: Array<Record<string, unknown>> }) {
  return <View style={styles.files}>{changes.map((change, index) => {
    const path = stringValue(change.path) || "File change";
    const diff = stringValue(change.diff);
    const counts = mobileDiffCounts(diff);
    return (
      <View key={`${path}-${index}`} style={[styles.file, index > 0 && styles.fileBorder]}>
        <View style={styles.fileHeader}>
          <Ionicons name="document-text-outline" size={13} color={colors.muted} />
          <Text numberOfLines={1} style={styles.filePath}>{path}</Text>
          <Text style={styles.addedCount}>+{counts.additions}</Text>
          <Text style={styles.deletedCount}>−{counts.deletions}</Text>
          <CopyButton value={diff} label={`Copy changes for ${path}`} />
        </View>
        {diff ? <Diff value={diff} /> : null}
      </View>
    );
  })}</View>;
}

function ToolPart({ part }: { part: Extract<MessageResponsePart, { type: "tool" }> }) {
  const presentation = toolPresentation(part);
  const [open, setOpen] = useState(Boolean(presentation.open));
  const statusName = part.status === "failed" ? "alert-circle-outline" : part.status === "running" ? "ellipsis-horizontal-circle" : "checkmark";
  const statusColor = part.status === "failed" ? colors.danger : part.status === "running" ? colors.info : colors.success;
  return (
    <View style={[styles.tool, open && styles.toolOpen]}>
      <Pressable accessibilityRole={presentation.body ? "button" : undefined} accessibilityState={presentation.body ? { expanded: open } : undefined} disabled={!presentation.body} onPress={() => setOpen((value) => !value)} style={({ pressed }) => [styles.toolHeader, pressed && styles.pressed]}>
        <View style={styles.toolIcon}><Ionicons name={presentation.icon} size={16} color="#9298a0" /></View>
        <View style={styles.toolCopy}>
          <Text numberOfLines={1} style={styles.toolTitle}>{presentation.title}</Text>
          {presentation.subtitle ? <Text numberOfLines={1} style={styles.toolSubtitle}>{presentation.subtitle}</Text> : null}
        </View>
        <Ionicons name={statusName} size={15} color={statusColor} />
        {presentation.body ? <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={13} color={colors.muted} /> : null}
      </Pressable>
      {open && presentation.body ? <View style={styles.toolDetail}>
        {presentation.body.kind === "files" ? <FileChanges changes={presentation.body.changes} /> : presentation.body.kind === "prose" ? <View style={styles.proseDetail}><RichMobileText value={presentation.body.value} /></View> : <View style={styles.outputWrap}><View style={styles.outputCopy}><CopyButton value={presentation.body.value} label="Copy tool output" /></View><ScrollView horizontal showsHorizontalScrollIndicator={false}><Text selectable style={styles.outputText}>{presentation.body.value}</Text></ScrollView></View>}
      </View> : null}
    </View>
  );
}

export function MobileResponseContent({ content, parts }: { content: string; parts?: MessageResponsePart[] }) {
  const visibleParts = parts?.filter((part) => part.type !== "text" || part.text.trim()) ?? [];
  if (!visibleParts.length) return <RichMobileText value={content} />;
  return <View style={styles.responseParts}>{visibleParts.map((part, index) => part.type === "text" ? <RichMobileText key={`text-${index}`} value={part.text} /> : <ToolPart key={`${part.id}-${index}`} part={part} />)}</View>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  responseParts: { gap: 13 },
  richContent: { gap: 1 },
  bodyText: { color: colors.text, fontSize: 15, lineHeight: 23 },
  strong: { color: colors.strong, fontWeight: "700" },
  emphasis: { color: "#c4c7cb", fontStyle: "italic" },
  strike: { color: colors.secondary, textDecorationLine: "line-through" },
  inlineCode: { paddingHorizontal: 4, color: "#e6e8df", backgroundColor: "rgba(255,255,255,0.07)", fontFamily: mono, fontSize: 13 },
  link: { color: colors.link, textDecorationLine: "underline", textDecorationColor: "rgba(143,200,255,0.35)" },
  h1: { marginTop: 15, marginBottom: 7, color: colors.strong, fontSize: 22, lineHeight: 28, fontWeight: "700" },
  h2: { marginTop: 14, marginBottom: 6, color: colors.strong, fontSize: 19, lineHeight: 25, fontWeight: "700" },
  h3: { marginTop: 12, marginBottom: 5, color: colors.strong, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  h4: { marginTop: 10, marginBottom: 4, color: colors.strong, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  spacer: { height: 10 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingRight: 4 },
  listMarker: { width: 20, color: "#8e939a", fontSize: 14, lineHeight: 23, textAlign: "right" },
  taskIcon: { width: 20, marginTop: 4, textAlign: "right" },
  checkedText: { color: colors.muted, textDecorationLine: "line-through" },
  quote: { marginVertical: 8, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: "#454a51" },
  quoteText: { color: "#aeb2b7" },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 17, backgroundColor: colors.border },
  copyButton: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  codeBlock: { overflow: "hidden", marginVertical: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#30343a", borderRadius: 9, backgroundColor: colors.code },
  codeHeader: { height: 33, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 11, paddingRight: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.panelHead },
  codeLanguage: { color: "#868c94", fontFamily: mono, fontSize: 10, textTransform: "lowercase" },
  codeText: { paddingHorizontal: 13, paddingVertical: 12, color: "#d7d9dc", fontFamily: mono, fontSize: 11, lineHeight: 17 },
  tableViewport: { marginVertical: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 8 },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tableHead: { backgroundColor: "rgba(255,255,255,0.035)" },
  tableCell: { width: 145, minHeight: 36, justifyContent: "center", paddingHorizontal: 9, paddingVertical: 7, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  tableText: { fontSize: 12, lineHeight: 17 },
  tableHeadText: { color: colors.strong, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  tool: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent", borderRadius: 9, backgroundColor: "rgba(255,255,255,0.018)" },
  toolOpen: { borderColor: "rgba(255,255,255,0.07)", backgroundColor: "rgba(255,255,255,0.028)" },
  toolHeader: { minHeight: 43, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 5 },
  toolIcon: { width: 23, height: 23, alignItems: "center", justifyContent: "center" },
  toolCopy: { flex: 1, minWidth: 0, gap: 1 },
  toolTitle: { color: "#cfd2d5", fontSize: 12, lineHeight: 17, fontWeight: "600" },
  toolSubtitle: { color: colors.muted, fontFamily: mono, fontSize: 9.5, lineHeight: 13 },
  toolDetail: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.06)" },
  outputWrap: { maxHeight: 270, backgroundColor: colors.code },
  outputCopy: { position: "absolute", zIndex: 2, top: 2, right: 3, borderRadius: 6, backgroundColor: "rgba(13,15,18,0.85)" },
  outputText: { paddingHorizontal: 13, paddingVertical: 12, paddingRight: 42, color: "#aaafb5", fontFamily: mono, fontSize: 10, lineHeight: 16 },
  proseDetail: { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.code },
  files: { backgroundColor: "#0c0e10" },
  file: { backgroundColor: colors.code },
  fileBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#2a2e34" },
  fileHeader: { minHeight: 35, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 10, paddingRight: 3, backgroundColor: "#14171a" },
  filePath: { flex: 1, color: "#bec2c6", fontFamily: mono, fontSize: 9.5 },
  addedCount: { color: colors.success, fontSize: 10, fontWeight: "700" },
  deletedCount: { color: colors.danger, fontSize: 10, fontWeight: "700" },
  diffViewport: { maxHeight: 430, paddingVertical: 7, backgroundColor: "#0d0f11" },
  diffContent: { minWidth: "100%" },
  diffLine: { minHeight: 17, flexDirection: "row", paddingRight: 12 },
  diffMark: { width: 24, color: colors.muted, fontFamily: mono, fontSize: 10.5, lineHeight: 17, textAlign: "center" },
  diffText: { color: "#b9bdc2", fontFamily: mono, fontSize: 10.5, lineHeight: 17 },
  diffAdd: { backgroundColor: "rgba(53,154,92,0.16)" },
  diffDelete: { backgroundColor: "rgba(190,62,68,0.16)" },
  diffHunk: { marginVertical: 3, backgroundColor: "rgba(71,113,163,0.12)" },
  diffAddMark: { color: "#70d093" },
  diffDeleteMark: { color: colors.danger },
  diffAddText: { color: "#bde8ca" },
  diffDeleteText: { color: "#f2b9bc" },
  diffHunkText: { color: "#9ebee6" },
});
