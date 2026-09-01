export type ComposerEnterAction =
  | { type: "submit-command"; value: string }
  | { type: "submit-message" }
  | { type: "ignore" };

export function moveCommandSelection(
  currentIndex: number | null,
  direction: 1 | -1,
  commandCount: number,
): number | null {
  if (commandCount === 0) return null;
  if (currentIndex === null) return direction === 1 ? 0 : commandCount - 1;
  return (currentIndex + direction + commandCount) % commandCount;
}

export function resolveComposerEnter(
  value: string,
  commandMenuOpen: boolean,
  matchingCommands: readonly string[],
  selectedIndex: number | null,
): ComposerEnterAction {
  if (!commandMenuOpen) return { type: "submit-message" };

  if (selectedIndex !== null) {
    const selectedCommand = matchingCommands[selectedIndex];
    return selectedCommand
      ? { type: "submit-command", value: selectedCommand }
      : { type: "ignore" };
  }

  const normalizedValue = value.trim().toLowerCase();
  const exactCommand = matchingCommands.find((command) => command === normalizedValue);
  return exactCommand
    ? { type: "submit-command", value: exactCommand }
    : { type: "ignore" };
}
