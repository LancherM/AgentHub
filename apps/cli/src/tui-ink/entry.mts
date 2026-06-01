import { Writable } from "node:stream";
import React from "react";
import {
  render,
  renderToString
} from "ink";
import type { TuiCurrentContextModel } from "@agent-hub/core";
import {
  TuiInkApp,
  TuiInkFrame,
  type TuiInkReviewInput,
  type TuiInkReviewResult,
  type TuiInkSubmitInput,
  type TuiInkSubmitResult,
  type TuiInkTerminalSize
} from "./App.mjs";
import type { TuiInkState } from "./state.mjs";

const h = React.createElement;

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
  loadModel?: (state: TuiInkState) => Promise<TuiCurrentContextModel>;
  submitPrompt?: (input: TuiInkSubmitInput) => Promise<TuiInkSubmitResult>;
  recordReviewDecision?: (input: TuiInkReviewInput) => Promise<TuiInkReviewResult>;
}

export async function runInkTui(input: RunInkTuiInput): Promise<void> {
  if (!input.interactive) {
    const output = renderToString(
      h(TuiInkFrame, {
        model: input.model,
        state: input.state,
        terminal: input.terminal
      }),
      { columns: input.terminal.columns }
    );
    input.io.stdout.write(`${output}\n`);
    return;
  }

  const instance = render(
    h(TuiInkApp, {
      model: input.model,
      state: input.state,
      terminal: input.terminal,
      interactive: true,
      loadModel: input.loadModel,
      submitPrompt: input.submitPrompt,
      recordReviewDecision: input.recordReviewDecision
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
