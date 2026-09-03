import type { MessageResponsePart } from "@noudle-agents/protocol";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Eye,
  FileCode2,
  Globe2,
  LoaderCircle,
  Search,
  Sparkles,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function displayJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function diffCounts(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="response-copy" aria-label={label} title={label} onClick={() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>;
}

function Diff({ value }: { value: string }) {
  return <div className="response-diff" role="table" aria-label="File changes">{value.split("\n").map((line, index) => {
    const kind = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "delete" : line.startsWith("@@") ? "hunk" : "context";
    return <div className={`diff-line diff-line--${kind}`} role="row" key={`${index}-${line}`}><span className="diff-mark" aria-hidden="true">{kind === "add" ? "+" : kind === "delete" ? "−" : ""}</span><code>{line}</code></div>;
  })}</div>;
}

function CodeBlock({ value, language }: { value: string; language: string }) {
  const isDiff = language === "diff" || /^(diff --git|@@ |--- |\+\+\+ )/m.test(value);
  if (isDiff) return <div className="response-code response-code--diff"><div className="response-code-head"><span>{language || "diff"}</span><CopyButton value={value} label="Copy diff" /></div><Diff value={value} /></div>;
  return <div className="response-code"><div className="response-code-head"><span>{language || "code"}</span><CopyButton value={value} label="Copy code" /></div><pre><code>{value}</code></pre></div>;
}

export function RichText({ children }: { children: string }) {
  return <div className="response-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer">{label}</a>,
    pre: ({ children: content }) => <>{content}</>,
    code: ({ className, children: content, ...props }) => {
      const value = String(content).replace(/\n$/, "");
      const language = className?.replace("language-", "") ?? "";
      return className || value.includes("\n") ? <CodeBlock value={value} language={language} /> : <code className="response-inline-code" {...props}>{content}</code>;
    },
  }}>{children}</Markdown></div>;
}

type ToolPresentation = { icon: typeof Terminal; title: string; subtitle?: string; body?: ReactNode; open?: boolean };

function toolPresentation(part: Extract<MessageResponsePart, { type: "tool" }>): ToolPresentation {
  const data = part.data;
  if (part.toolType === "commandExecution") {
    const command = text(data.command);
    const output = text(data.output);
    return { icon: Terminal, title: `Ran ${command.split("\n")[0] || "command"}`, subtitle: text(data.cwd), body: output ? <pre className="tool-output"><code>{output}</code></pre> : undefined };
  }
  if (part.toolType === "fileChange") {
    const changes = Array.isArray(data.changes) ? data.changes as Array<Record<string, unknown>> : [];
    const additions = changes.reduce((sum, change) => sum + diffCounts(text(change.diff)).additions, 0);
    const deletions = changes.reduce((sum, change) => sum + diffCounts(text(change.diff)).deletions, 0);
    return {
      icon: FileCode2,
      title: `${part.status === "failed" ? "Could not edit" : "Edited"} ${changes.length || 1} ${changes.length === 1 ? "file" : "files"}`,
      subtitle: changes.map((change) => text(change.path)).filter(Boolean).join(", "),
      open: true,
      body: <div className="tool-file-changes">{changes.map((change, index) => {
        const diff = text(change.diff);
        const counts = diffCounts(diff);
        return <section className="tool-file" key={`${text(change.path)}-${index}`}><header><FileCode2 size={13} /><span>{text(change.path) || "File change"}</span><em className="diff-added">+{counts.additions}</em><em className="diff-deleted">−{counts.deletions}</em><CopyButton value={diff} label="Copy patch" /></header>{diff ? <Diff value={diff} /> : null}</section>;
      })}</div>,
    };
  }
  if (part.toolType === "webSearch") return { icon: Search, title: "Searched the web", subtitle: text(data.query) || text((data.action as Record<string, unknown> | undefined)?.query) };
  if (part.toolType === "imageView") return { icon: Eye, title: "Viewed image", subtitle: text(data.path) };
  if (part.toolType === "reasoning") return { icon: Sparkles, title: "Thought through the request", body: text(data.text) || displayJson(data.summary) ? <pre className="tool-output tool-output--prose">{text(data.text) || displayJson(data.summary)}</pre> : undefined };
  if (part.toolType === "plan") return { icon: Check, title: "Updated the plan", body: text(data.text) ? <pre className="tool-output tool-output--prose">{text(data.text)}</pre> : undefined };
  if (part.toolType === "collabAgentToolCall" || part.toolType === "subAgentActivity") return { icon: Users, title: "Coordinated with an agent", subtitle: text(data.tool) || text(data.agentPath) };
  if (part.toolType === "mcpToolCall" || part.toolType === "dynamicToolCall") {
    const server = text(data.server);
    const tool = text(data.tool);
    const app = data.appContext && typeof data.appContext === "object" ? text((data.appContext as Record<string, unknown>).appName) : "";
    const detail = displayJson(data.result || data.error || data.arguments);
    return { icon: Wrench, title: `Used ${app || tool || server || "tool"}`, subtitle: app ? [server, tool].filter(Boolean).join(" · ") : server, body: detail ? <pre className="tool-output"><code>{detail}</code></pre> : undefined };
  }
  if (part.toolType === "imageGeneration") return { icon: Globe2, title: "Generated an image" };
  return { icon: Wrench, title: text(data.tool) ? `Used ${text(data.tool)}` : part.toolType.replace(/([a-z])([A-Z])/g, "$1 $2"), body: Object.keys(data).length ? <pre className="tool-output"><code>{displayJson(data)}</code></pre> : undefined };
}

function ToolPart({ part }: { part: Extract<MessageResponsePart, { type: "tool" }> }) {
  const presentation = toolPresentation(part);
  const Icon = presentation.icon;
  const statusIcon = part.status === "running" ? <LoaderCircle className="spin" size={13} /> : part.status === "failed" ? <CircleAlert size={13} /> : <Check size={13} />;
  const summary = <><span className="tool-icon"><Icon size={15} /></span><span className="tool-copy"><strong>{presentation.title}</strong>{presentation.subtitle ? <small>{presentation.subtitle}</small> : null}</span><span className={`tool-status tool-status--${part.status}`}>{statusIcon}</span>{presentation.body ? <ChevronRight className="tool-chevron" size={14} /> : null}</>;
  return presentation.body
    ? <details className={`response-tool response-tool--${part.toolType}`} open={presentation.open}><summary>{summary}</summary><div className="tool-detail">{presentation.body}</div></details>
    : <div className={`response-tool response-tool--${part.toolType}`}><div className="tool-summary">{summary}</div></div>;
}

export function ResponseContent({ content, parts }: { content: string; parts?: MessageResponsePart[] | undefined }) {
  const visibleParts = parts?.filter((part) => part.type !== "text" || part.text.trim()) ?? [];
  if (!visibleParts.length) return <RichText>{content}</RichText>;
  return <div className="response-parts">{visibleParts.map((part, index) => part.type === "text"
    ? <RichText key={`text-${index}`}>{part.text}</RichText>
    : <ToolPart key={`${part.id}-${index}`} part={part} />)}</div>;
}
