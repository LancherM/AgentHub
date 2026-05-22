import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NodeProcessRunner,
  type ProcessRunEvent,
  type ProcessSpawner,
  type SpawnedProcess
} from "@agent-hub/agent-adapters";
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

  it("reports non-zero detection exits as unavailable with process output", async () => {
    const runner = new NodeProcessRunner(() => {
      const child = new MockChildProcess();
      queueMicrotask(() => {
        child.stderr.write("not authenticated\n");
        child.close(2, null);
      });
      return child;
    });

    await expect(
      runner.detect({ executable: "agent", args: ["--version"] })
    ).resolves.toEqual({
      available: false,
      reason: "not authenticated"
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

  it("kills a running child process when the abort signal fires", async () => {
    const cwd = await createTestDirectory("process-runner-abort");
    const controller = new AbortController();
    const children: MockChildProcess[] = [];
    const runner = new NodeProcessRunner(() => {
      const child = new MockChildProcess();
      children.push(child);
      queueMicrotask(() => {
        child.stdout.write("started\n");
        controller.abort();
      });
      return child;
    });

    const events = await collect(
      runner.run({ executable: "agent", cwd, signal: controller.signal })
    );

    expect(events).toEqual([
      { type: "stdout", data: "started\n" },
      { type: "exit", exitCode: null, signal: "SIGTERM" }
    ]);
    expect(children[0].killedWith).toBe("SIGTERM");
  });

  it("preserves abort signal evidence when a child exits with a code after SIGTERM", async () => {
    const cwd = await createTestDirectory("process-runner-abort-code");
    const controller = new AbortController();
    const runner = new NodeProcessRunner(() => {
      const child = new MockChildProcess({
        closeWithCodeOnKill: 143
      });
      queueMicrotask(() => {
        controller.abort();
      });
      return child;
    });

    await expect(
      collect(runner.run({ executable: "agent", cwd, signal: controller.signal }))
    ).resolves.toEqual([{ type: "exit", exitCode: 143, signal: "SIGTERM" }]);
  });

  it("does not report SIGTERM when abort tries to kill an already-exited child", async () => {
    const cwd = await createTestDirectory("process-runner-abort-race");
    const controller = new AbortController();
    const runner = new NodeProcessRunner(() => {
      const child = new MockChildProcess({ killReturnsFalse: true });
      queueMicrotask(() => {
        controller.abort();
        child.close(1, null);
      });
      return child;
    });

    await expect(
      collect(runner.run({ executable: "agent", cwd, signal: controller.signal }))
    ).resolves.toEqual([{ type: "exit", exitCode: 1, signal: null }]);
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

    expect(calls[0][2].env.PATH?.split(path.delimiter)).toContain("/test/bin");
    expect(calls[0][2].env.HOME).toBeUndefined();
    expect(calls[0][2].env.CUSTOM_ENV).toBe("explicit");
    expect(calls[0][2].env.AGENT_HUB_TEST_SECRET).toBeUndefined();
  });

  it("adds common local CLI directories to PATH for GUI-launched processes", async () => {
    const cwd = await createTestDirectory("process-runner-gui-path");
    const home = await createTestDirectory("process-runner-home");
    const localBin = path.join(home, ".local", "bin");
    const nvmBin = path.join(home, ".nvm", "versions", "node", "v20.18.0", "bin");
    await fs.mkdir(localBin, { recursive: true });
    await fs.mkdir(nvmBin, { recursive: true });
    vi.stubEnv("PATH", "/usr/bin");
    vi.stubEnv("HOME", home);
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
        executable: "codex",
        cwd
      })
    );

    const pathEntries = calls[0][2].env.PATH?.split(path.delimiter) ?? [];
    expect(pathEntries).toContain("/usr/bin");
    expect(pathEntries).toContain(localBin);
    expect(pathEntries).toContain(nvmBin);
    expect(pathEntries.indexOf("/usr/bin")).toBeLessThan(pathEntries.indexOf(nvmBin));
  });

  it("does not rebuild PATH when an explicit override removes it", async () => {
    const cwd = await createTestDirectory("process-runner-path-removal");
    const home = await createTestDirectory("process-runner-path-removal-home");
    await fs.mkdir(path.join(home, ".local", "bin"), { recursive: true });
    vi.stubEnv("PATH", "/usr/bin");
    vi.stubEnv("HOME", home);
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
        executable: "/usr/bin/true",
        cwd,
        env: { PATH: undefined }
      })
    );

    expect(calls[0][2].env.PATH).toBeUndefined();
    expect(calls[0][2].env.HOME).toBe(home);
  });
});

class MockChildProcess extends EventEmitter implements SpawnedProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdinCapture = new CaptureWritable();
  readonly stdin = this.stdinCapture;
  killedWith: string | number | NodeJS.Signals | undefined;

  constructor(
    private readonly options: { closeWithCodeOnKill?: number; killReturnsFalse?: boolean } = {}
  ) {
    super();
  }

  close(code: number | null, signal: NodeJS.Signals | string | null): void {
    this.emit("close", code, signal);
  }

  kill(signal?: NodeJS.Signals | string | number): boolean {
    this.killedWith = signal === undefined ? "SIGTERM" : signal;
    if (this.options.killReturnsFalse) {
      return false;
    }
    if (this.options.closeWithCodeOnKill !== undefined) {
      this.close(this.options.closeWithCodeOnKill, null);
    } else {
      this.close(null, signal === undefined ? "SIGTERM" : String(signal));
    }
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
