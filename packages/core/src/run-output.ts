import type { JsonObject } from "@agent-hub/shared";

export interface AgentOutputEvent {
  type: string;
  message: string;
  metadata?: JsonObject;
}

export interface ExtractAgentFacingOutputInput {
  events: AgentOutputEvent[];
}

export interface ExtractAgentFacingOutputOptions {
  includeRawStreams?: boolean;
  includeTerminalSummaries?: boolean;
  preferExplicitOutput?: boolean;
}

export function extractAgentFacingOutput(
  input: ExtractAgentFacingOutputInput,
  options: ExtractAgentFacingOutputOptions = {}
): string {
  const includeRawStreams = options.includeRawStreams ?? true;
  const includeTerminalSummaries = options.includeTerminalSummaries ?? false;
  const explicitOutput = explicitOutputFromEvents(input.events);

  if (options.preferExplicitOutput === true && explicitOutput) {
    return explicitOutput.trim();
  }

  const structuredOutput = input.events
    .filter((event) =>
      isStructuredOutputEvent(event, { includeTerminalSummaries })
    )
    .map(eventText)
    .filter(Boolean);
  if (structuredOutput.length > 0) {
    return structuredOutput.join("\n");
  }

  if (explicitOutput) {
    return explicitOutput.trim();
  }

  if (!includeRawStreams) {
    return "";
  }

  return input.events
    .filter((event) =>
      !isPlannerEvent(event) &&
      (event.type === "stdout" || event.type === "stderr")
    )
    .flatMap((event) => humanReadableRawLines(event.message))
    .join("\n");
}

function explicitOutputFromEvents(events: AgentOutputEvent[]): string | undefined {
  return events
    .filter((event) => !isPlannerEvent(event))
    .map((event) => event.metadata?.output)
    .find((output): output is string =>
      typeof output === "string" && output.trim().length > 0
    );
}

function isStructuredOutputEvent(
  event: AgentOutputEvent,
  options: { includeTerminalSummaries: boolean }
): boolean {
  if (isPlannerEvent(event)) {
    return false;
  }
  if (event.metadata?.assistantOutput === false) {
    return false;
  }
  if (event.metadata?.assistantOutput === true) {
    return true;
  }

  if (event.type === "message" || event.type === "error") {
    return true;
  }

  if (!options.includeTerminalSummaries) {
    return false;
  }

  const desktopType =
    typeof event.metadata?.desktopEventType === "string"
      ? event.metadata.desktopEventType
      : event.type;
  return (
    desktopType === "run_completed" ||
    desktopType === "run_failed" ||
    desktopType === "run_cancelled"
  );
}

function isPlannerEvent(event: AgentOutputEvent): boolean {
  return event.metadata?.plannerEvent === true;
}

function eventText(event: AgentOutputEvent): string {
  const metadataMessage = event.metadata?.message;
  const metadataSummary = event.metadata?.summary;
  if (typeof metadataMessage === "string" && metadataMessage.trim().length > 0) {
    return metadataMessage.trim();
  }
  if (typeof metadataSummary === "string" && metadataSummary.trim().length > 0) {
    return metadataSummary.trim();
  }
  return event.message.trim();
}

function humanReadableRawLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isJsonObjectLine(line));
}

function isJsonObjectLine(value: string): boolean {
  if (!value.startsWith("{") || !value.endsWith("}")) {
    return false;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
