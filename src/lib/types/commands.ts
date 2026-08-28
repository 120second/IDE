export interface WorkbenchCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  enabled?: boolean;
  disabledReason?: string;
  run: () => void;
}

export function rankWorkbenchCommands(
  commands: readonly WorkbenchCommand[],
  query: string,
): WorkbenchCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...commands];
  return commands
    .flatMap((command) => {
      const label = command.label.toLocaleLowerCase();
      const haystack = `${label} ${command.category.toLocaleLowerCase()} ${command.id.toLowerCase()}`;
      let score = Number.POSITIVE_INFINITY;
      if (label.startsWith(needle)) score = 0;
      else if (label.includes(needle)) score = 1;
      else if (haystack.includes(needle)) score = 2;
      else if (isSubsequence(needle, haystack)) score = 3;
      return Number.isFinite(score) ? [{ command, score }] : [];
    })
    .sort((left, right) => left.score - right.score || left.command.label.localeCompare(right.command.label, "zh-CN"))
    .map(({ command }) => command);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}
