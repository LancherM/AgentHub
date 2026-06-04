import { Writable } from "node:stream";
import type { TuiCurrentContextModel } from "@agent-hub/core";
import type {
  TuiInkReviewInput,
  TuiInkReviewResult,
  TuiInkSubmitInput,
  TuiInkSubmitResult,
  TuiInkTerminalSize
} from "./App.mjs";
import type { TuiInkState } from "./state.mjs";
import { isJsonModuleExperimentalWarning } from "./json-warning.js";

export interface TuiInkIO {
  stdin?: NodeJS.ReadableStream;
  stdout: Pick<NodeJS.WriteStream, "write"> &
    Partial<Pick<NodeJS.WriteStream, "columns" | "rows" | "isTTY">>;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface RunInkTuiInput {
  model: TuiCurrentContextModel;
  state: TuiInkState;
  terminal: TuiInkTerminalSize;
  io: TuiInkIO;
  interactive: boolean;
  showSplash?: boolean;
  loadModel?: (state: TuiInkState) => Promise<TuiCurrentContextModel>;
  submitPrompt?: (input: TuiInkSubmitInput) => Promise<TuiInkSubmitResult>;
  recordReviewDecision?: (input: TuiInkReviewInput) => Promise<TuiInkReviewResult>;
}

export async function runInkTui(input: RunInkTuiInput): Promise<void> {
  const { React, render, renderToString, TuiInkApp, TuiInkFrame } = await loadInkModules();
  const h = React.createElement;
  if (!input.interactive) {
    const output = renderToString(
      h(TuiInkFrame, {
        model: input.model,
        state: input.state,
        terminal: input.terminal,
        showSplash: input.showSplash === true
      }),
      { columns: input.terminal.columns }
    );
    input.io.stdout.write(`${output}\n`);
    return;
  }

  if (input.showSplash === true) {
    input.io.stdout.write(interactiveSplashPrelude());
  }
  const instance = render(
    h(TuiInkApp, {
      model: input.model,
      state: input.state,
      terminal: input.terminal,
      interactive: true,
      loadModel: input.loadModel,
      submitPrompt: input.submitPrompt,
      recordReviewDecision: input.recordReviewDecision,
      showSplash: false,
      notify: (message) => {
        input.io.stdout.write(terminalNotificationSequence(message));
      }
    }),
    {
      stdin: input.io.stdin as NodeJS.ReadStream | undefined,
      stdout: toWriteStream(input.io.stdout, input.terminal),
      stderr: toWriteStream(input.io.stderr, input.terminal),
      exitOnCtrlC: true,
      patchConsole: false,
      interactive: true
    }
  );
  await instance.waitUntilExit();
  instance.cleanup();
}

function toWriteStream(
  target: Pick<NodeJS.WriteStream, "write"> &
    Partial<Pick<NodeJS.WriteStream, "columns" | "rows" | "isTTY">>,
  terminal: TuiInkTerminalSize
): NodeJS.WriteStream {
  if (
    typeof (target as NodeJS.WriteStream).on === "function" &&
    typeof (target as NodeJS.WriteStream).once === "function"
  ) {
    return target as NodeJS.WriteStream;
  }

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      target.write(typeof chunk === "string" ? chunk : chunk.toString());
      callback();
    }
  }) as NodeJS.WriteStream;
  Object.defineProperty(stream, "columns", {
    get: () => target.columns ?? terminal.columns
  });
  Object.defineProperty(stream, "rows", {
    get: () => target.rows ?? terminal.rows
  });
  Object.defineProperty(stream, "isTTY", {
    get: () => target.isTTY ?? false
  });
  return stream;
}

function terminalNotificationSequence(message: string): string {
  const sanitized = message.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return `\u0007\u001B]9;${sanitized}\u0007`;
}

function interactiveSplashPrelude(): string {
  return "Agent Hub TUI\nlocal-first terminal workbench\n";
}

interface InkModules {
  React: typeof import("react");
  render: typeof import("ink")["render"];
  renderToString: typeof import("ink")["renderToString"];
  TuiInkApp: typeof import("./App.mjs")["TuiInkApp"];
  TuiInkFrame: typeof import("./App.mjs")["TuiInkFrame"];
}

let inkModulesPromise: Promise<InkModules> | undefined;

function loadInkModules(): Promise<InkModules> {
  inkModulesPromise ??= withJsonModuleWarningSuppressed(async () => {
    const [reactModule, inkModule, appModule] = await Promise.all([
      import("react"),
      import("ink"),
      import("./App.mjs")
    ]);
    return {
      React: reactModule,
      render: inkModule.render,
      renderToString: inkModule.renderToString,
      TuiInkApp: appModule.TuiInkApp,
      TuiInkFrame: appModule.TuiInkFrame
    };
  });
  return inkModulesPromise;
}

async function withJsonModuleWarningSuppressed<T>(operation: () => Promise<T>): Promise<T> {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, typeOrOptions?: string | NodeJS.EmitWarningOptions, code?: string, ctor?: Function) => {
    if (isJsonModuleExperimentalWarning(warning, typeOrOptions)) {
      return;
    }
    return Reflect.apply(originalEmitWarning, process, [warning, typeOrOptions, code, ctor].filter((value) => value !== undefined));
  }) as typeof process.emitWarning;
  try {
    return await operation();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}
