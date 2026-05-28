export function roleResultSummaryFromText(value: string): string | undefined {
  const exact = roleResultSummaryFromJson(value);
  if (exact) {
    return exact;
  }
  for (const candidate of jsonObjectCandidates(value).reverse()) {
    const summary = roleResultSummaryFromJson(candidate);
    if (summary) {
      return summary;
    }
  }
  return undefined;
}

function roleResultSummaryFromJson(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const summary = (parsed as Record<string, unknown>).summary;
    return typeof summary === "string" && summary.trim().length > 0
      ? summary.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function jsonObjectCandidates(value: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char !== "}") {
      continue;
    }
    depth -= 1;
    if (depth === 0 && start >= 0) {
      candidates.push(value.slice(start, index + 1));
      start = -1;
    }
  }
  return candidates;
}
