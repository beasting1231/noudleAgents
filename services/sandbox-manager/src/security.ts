import path from "node:path";

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export function requireSafeKey(value: string, label: string): string {
  if (!SAFE_KEY.test(value)) throw new Error(`${label} contains unsupported characters`);
  return value;
}

export function resolveWorkspace(root: string, key: string): string {
  requireSafeKey(key, "workspaceKey");
  const candidate = path.resolve(root, key);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Workspace escaped the configured root");
  return candidate;
}

export function containerName(id: string): string {
  return `relay-agent-${requireSafeKey(id, "sandbox id").toLowerCase()}`;
}
