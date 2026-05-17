import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NodeProcessRunner,
  type ProcessRunEvent,
  type ProcessSpawner,
  type SpawnedProcess
} from "../src/process-runner";
import { createTestDirectory } from "./helpers";

describe("NodeProcessRunner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("spawns executable args without a shell, writes stdin, streams output, and closes stdin", async () => {
    const cwd = await createTestDirectory("process-runner");
    const children: MockChildProcess[] = [];
    const calls: Parameters<ProcessSpawner>[] = [];
    const runner = new NodeProcessRunner((executable, args, options) => {
      calls.push([executable, args, options]);
      const child = new MockChildProcess();
      children.push(child);
      queueMicrotask(() => {
        child.stdout.write("out\n");
        child.stderr.write("err\n");
        child.close(0, null);
      });
      return child;
    });

    const events = await collect(
      runner.run({
        executable: "agent",
        args: ["--flag"],
        cwd,
        stdin: "task brief"
      })
    );

    expect(calls[0][0]).toBe("agent");
    expect(calls[0][1]).toEqual(["--flag"]);
    expect(calls[0][2]).toMatchObject({ cwd, shell: false });
    expect(children[0].stdinCapture.text).toBe("task brief");
    expect(children[0].stdinCapture.closed).toBe(true);
    expect(events).toEqual([
      { type: "stdout", data: "out\n" },
      { type: "stderr", data: "err\n" },
      { type: "exit", exitCode: 0, signal: null }
    ]);
  });

  it("captures spawn errors during detection without throwing", async () => {
    const runner = new NodeProcessRunner(() => {
      const child = new MockChildProcess();
      queueMicrotask(() => {
        child.emit("error", new Error("ENOENT"));
      });
      return child;
    });

    await expect(
      runner.detect({ executable: "missing", args: ["--version"] })
    ).resolves.toEqual({
      available: false,
      reason: "ENOENT"
    });
  });

  it("captures non-zero and signal exits", async () => {
    const cwd = await createTestDirectory("process-runner-signal");
    const runner = new NodeProcessRunner(() => {
      const child = new MockChildProcess();
      queueMicrotask(() => {
        child.close(null, "SIGTERM");
      });
      return child;
    });

    await expect(
      collect(runner.run({ executable: "agent", cwd }))
    ).resolves.toEqual([{ type: "exit", exitCode: null, signal: "SIGTERM" }]);
  });

  it("uses an allowlisted child environment plus explicit overrides", async () => {
    const cwd = await createTestDirectory("process-runner-env");
    vi.stubEnv("PATH", "/test/bin");
    vi.stubEnv("HOME", "/home/test-user");
    vi.stubEnv("AGENT_HUB_TEST_SECRET", "do-not-pass");
    const calls: Parameters<ProcessSpawner>[] = [];
    const runner = new NodeProcessRunner((executable, args, options) => {
      calls.push([executable, args, options]);
      const child = new MockChildProcess();
      queueMicrotask(() => {
        child.close(0, null);
      });
      return child;
    });

    await collect(
      runner.run({
        executable: "agent",
        cwd,
        env: {
          CUSTOM_ENV: "explicit",
          HOME: undefined
        }
      })
    );

    expect(calls[0][2].env.PATH).toBe("/test/bin");
    expect(calls[0][2].env.HOME).toBeUndefined();
    expect(calls[0][2].env.CUSTOM_ENV).toBe("explicit");
    expect(calls[0][2].env.AGENT_HUB_TEST_SECRET).toBeUndefined();
  });
});

class MockChildProcess extends EventEmitter implements SpawnedProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdinCapture = new CaptureWritable();
  readonly stdin = this.stdinCapture;

  close(code: number | null, signal: NodeJS.Signals | string | null): void {
    this.emit("close", code, signal);
  }

  kill(signal?: NodeJS.Signals | string | number): boolean {
    this.close(null, signal === undefined ? "SIGTERM" : String(signal));
    return true;
  }
}

class CaptureWritable extends Writable {
  text = "";
  closed = false;

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.text += chunk.toString();
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.closed = true;
    callback();
  }
}

async function collect(events: AsyncIterable<ProcessRunEvent>): Promise<ProcessRunEvent[]> {
  const collected: ProcessRunEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
