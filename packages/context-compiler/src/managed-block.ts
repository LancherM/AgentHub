export const managedBlockStart = "<!-- agent-hub:start -->";
export const managedBlockEnd = "<!-- agent-hub:end -->";

export function buildManagedBlock(content: string): string {
  return [
    managedBlockStart,
    "# Agent Hub Shared Context",
    "",
    "This content is exported from the Agent Hub context store.",
    "Preserve user-authored content outside this managed block.",
    "",
    content.trim() || "_No project context is available yet._",
    managedBlockEnd,
    ""
  ].join("\n");
}

export function replaceManagedBlock(existing: string | undefined, block: string): string {
  if (!existing) {
    return block.endsWith("\n") ? block : `${block}\n`;
  }

  const lines = existing.split(/\n/);
  let inFence = false;
  let start = -1;
  let end = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
    }
    if (inFence) {
      continue;
    }
    if (trimmed === managedBlockStart) {
      start = index;
    }
    if (start !== -1 && trimmed === managedBlockEnd) {
      end = index;
      break;
    }
  }

  const blockLines = block.trimEnd().split(/\n/);
  const nextLines =
    start !== -1 && end !== -1
      ? [...lines.slice(0, start), ...blockLines, ...lines.slice(end + 1)]
      : [...lines, ...(existing.endsWith("\n") ? [] : [""]), ...blockLines];
  return `${nextLines.join("\n").trimEnd()}\n`;
}
