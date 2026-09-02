import path from "node:path";

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export function requireSafeKey(value: string, label: string): string {
  if (!SAFE_KEY.test(value)) throw new Error(`${label} contains unsupported characters`);
  return value;
}

export function resolveWorkspace(root: string, key: string): string {
  const segments = key.split("/");
  if (segments.length === 0 || segments.length > 8) throw new Error("workspaceKey contains too many path segments");
  for (const segment of segments) requireSafeKey(segment, "workspaceKey segment");
  const candidate = path.resolve(root, ...segments);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Workspace escaped the configured root");
  return candidate;
}

export function containerName(id: string): string {
  return `relay-agent-${requireSafeKey(id, "sandbox id").toLowerCase()}`;
}
