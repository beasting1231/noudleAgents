export const colors = {
  canvas: "#0B0C0E",
  surface1: "#111317",
  surface2: "#171A1F",
  surfaceHover: "#1D2127",
  borderSubtle: "#272B32",
  borderStrong: "#383E47",
  textPrimary: "#F1F3F5",
  textSecondary: "#A4AAB3",
  textMuted: "#6F7681",
  accent: "#D7FF64",
  accentQuiet: "#263019",
  info: "#74B9FF",
  success: "#72D6A0",
  warning: "#F3C66D",
  danger: "#FF7D84",
  focus: "#C5E1FF",
} as const;

export const spacing = { x1: 4, x2: 8, x3: 12, x4: 16, x6: 24, x8: 32 } as const;
export const radii = { control: 8, card: 10, sheet: 14, pill: 999 } as const;
export const motion = { fast: 140, standard: 180, sheet: 240 } as const;

export const statusColors = {
  idle: colors.textMuted,
  queued: colors.info,
  planning: colors.info,
  working: colors.accent,
  waiting_agent: colors.warning,
  waiting_user: colors.warning,
  blocked: colors.danger,
  paused: colors.textSecondary,
  failed: colors.danger,
  completed: colors.success,
} as const;
