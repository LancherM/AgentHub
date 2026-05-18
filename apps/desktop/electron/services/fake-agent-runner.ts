import type {
  ContextMode,
  RunEventPayload,
  RunEventType
} from "../../src/lib/types";

export interface FakeAgentRunInput {
  prompt: string;
  contextMode: ContextMode;
  signal: AbortSignal;
  delayMs?: number;
}

export interface FakeAgentRunnerEvent {
  type: RunEventType;
  payload: RunEventPayload;
}

export type FakeAgentEventListener = (
  event: FakeAgentRunnerEvent
) => void | Promise<void>;

const defaultDelayMs = 350;

export async function runFakeAgent(
  input: FakeAgentRunInput,
  emit: FakeAgentEventListener
): Promise<void> {
  const delayMs = input.delayMs ?? defaultDelayMs;

  try {
    throwIfAborted(input.signal);
    await emit({
      type: "run_started",
      payload: {
        phase: "lifecycle",
        status: "running",
        message: "Fake run started."
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "context_compiled",
      payload: {
        phase: "context",
        message: `Using ${input.contextMode} context mode with runtime injection.`
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "agent_step",
      payload: {
        phase: "agent",
        message: "Inspecting project"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "agent_output",
      payload: {
        phase: "logs",
        stream: "stdout",
        message: "Found package.json"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "agent_step",
      payload: {
        phase: "agent",
        message: "Planning implementation"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "agent_output",
      payload: {
        phase: "logs",
        stream: "stdout",
        message: "Will update desktop run lifecycle"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "agent_step",
      payload: {
        phase: "agent",
        message: "Applying simulated changes"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "agent_output",
      payload: {
        phase: "logs",
        stream: "stdout",
        message: "No real files were modified in fake mode"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "verification_started",
      payload: {
        phase: "verification",
        status: "verifying",
        command: "pnpm test -- simulated",
        message: "Running simulated verification"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "agent_output",
      payload: {
        phase: "logs",
        stream: "stdout",
        message: "pnpm test -- simulated"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "verification_finished",
      payload: {
        phase: "verification",
        command: "pnpm test -- simulated",
        passed: true,
        message: "Simulated verification passed"
      }
    });

    await delay(delayMs, input.signal);
    await emit({
      type: "run_completed",
      payload: {
        phase: "final",
        status: "completed",
        summary: "Fake run completed successfully",
        message: "Fake run completed successfully"
      }
    });
  } catch (error) {
    if (isAbortError(error) || input.signal.aborted) {
      await emit({
        type: "run_cancelled",
        payload: {
          phase: "final",
          status: "cancelled",
          message: "Fake run cancelled by user."
        }
      });
      return;
    }

    await emit({
      type: "run_failed",
      payload: {
        phase: "final",
        status: "failed",
        message:
          error instanceof Error ? error.message : "Fake run failed unexpectedly."
      }
    });
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortError());
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;
    let abort = (): void => undefined;
    const cleanup = (): void => {
      signal.removeEventListener("abort", abort);
    };
    abort = (): void => {
      clearTimeout(timeout);
      cleanup();
      reject(new AbortError());
    };
    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, Math.max(0, ms));
    signal.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortError();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof AbortError;
}

class AbortError extends Error {
  constructor() {
    super("run aborted");
    this.name = "AbortError";
  }
}
