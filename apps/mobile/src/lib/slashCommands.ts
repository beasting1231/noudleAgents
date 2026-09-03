export const slashCommands = [
  { value: "/clear", label: "Clear chat", icon: "refresh-outline" },
  { value: "/stop", label: "Stop agent", icon: "stop-circle-outline" },
] as const;

export type SlashCommand = (typeof slashCommands)[number]["value"];

export function matchingSlashCommands(value: string) {
  if (!value.startsWith("/") || value.slice(1).includes(" ") || value.includes("\n")) return [];
  const query = value.slice(1).toLowerCase();
  return slashCommands.filter(({ value: command }) => command.slice(1).startsWith(query));
}

export function exactSlashCommand(value: string): SlashCommand | null {
  const normalized = value.trim().toLowerCase();
  return slashCommands.find(({ value: command }) => command === normalized)?.value ?? null;
}
