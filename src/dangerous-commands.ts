import path from "node:path";

export interface DangerousCommandMatch {
  command: string;
  summary: string;
}

const dangerousCommandRules: Array<{ pattern: RegExp; summary: string }> = [
  {
    pattern: /(?:^|[\s;&|(){}"'`])sudo(?=$|[\s;&|(){}"'`])/i,
    summary: "Privileged command detected."
  },
  {
    pattern:
      /\brm\b(?=[^\n;&|]*?(?:\s-[^\s;&|]*r[^\s;&|]*|--recursive\b))(?=[^\n;&|]*?(?:\s-[^\s;&|]*f[^\s;&|]*|--force\b))[^\n;&|]*?(?:\s--)?\s\/(?=$|[\s;&|"'`])/i,
    summary: "Recursive root deletion command detected."
  },
  {
    pattern:
      /\bchmod\b(?=[^\n;&|]*?(?:\s-[^\s;&|]*r[^\s;&|]*|--recursive\b))(?=[^\n;&|]*?\s777(?=$|[\s;&|"'`]))[^\n;&|]*/i,
    summary: "Unsafe recursive permission broadening detected."
  },
  {
    pattern: /\bcurl\b[^\n;]*\|\s*(?:sudo\s+)?(?:(?:\/usr)?\/bin\/)?(?:sh|bash)\b/i,
    summary: "curl pipe-to-shell installer detected."
  },
  {
    pattern: /\bwget\b[^\n;]*\|\s*(?:sudo\s+)?(?:(?:\/usr)?\/bin\/)?(?:sh|bash)\b/i,
    summary: "wget pipe-to-shell installer detected."
  },
  {
    pattern:
      /\bgit\b[^\n;&|]*?\bpush\b[^\n;&|]*?(?:--force(?:-with-lease)?|-f)(?=$|[\s;&|"'`])/i,
    summary: "Force push command detected."
  },
  {
    pattern:
      /\bgit\b[^\n;&|]*?\bclean\b(?=[^\n;&|]*?(?:-[a-z]*f[a-z]*|--force\b))(?=[^\n;&|]*?(?:-[a-z]*d[a-z]*|(?:^|\s)-d(?=$|\s)))(?=[^\n;&|]*?(?:-[a-z]*x[a-z]*|(?:^|\s)-x(?=$|\s)))[^\n;&|]*/i,
    summary: "Destructive git clean command detected."
  }
];

export function detectDangerousCommandText(text: string): DangerousCommandMatch[] {
  if (text.trim().length === 0) {
    return [];
  }

  const matches: DangerousCommandMatch[] = [];
  for (const rule of dangerousCommandRules) {
    const match = text.match(rule.pattern);
    if (!match) {
      continue;
    }
    matches.push({
      command: match[0].trim(),
      summary: rule.summary
    });
  }
  return matches;
}

export function hasDangerousCommandText(text: string): boolean {
  return detectDangerousCommandText(text).length > 0;
}

export function shellCommandSearchText(
  executable: string,
  args: string[] = []
): string {
  const executableName = path.basename(executable);
  const parts = [executableName, ...args];
  if (executableName !== executable) {
    parts.push(executable);
  }
  return parts.join(" ");
}
