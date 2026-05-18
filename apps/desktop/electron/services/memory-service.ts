import fs from "node:fs/promises";
import path from "node:path";
import {
  validateMemoryItem,
  type MemoryItem,
  type MemoryItemRepository,
  type ProjectRepository,
  type Task,
  type TaskRepository,
  type TaskRun,
  type TaskRunRepository,
  type VerificationResultRepository
} from "@agent-hub/core";
import type {
  MemoryProposal,
  MemoryProposalSource
} from "../../src/lib/types";
import type { DesktopServiceContext } from "./project-service";

const MAX_GENERATED_PROPOSALS = 2;

export interface MemoryService {
  listProposals(runId: string): Promise<MemoryProposal[]>;
  generateProposalsForRun(runId: string): Promise<MemoryProposal[]>;
  approve(ids: string[]): Promise<void>;
  ignore(ids: string[]): Promise<void>;
}

export function createMemoryService(context: DesktopServiceContext): MemoryService {
  return new RepositoryMemoryService(
    context.repositories.taskRunRepository,
    context.repositories.taskRepository,
    context.repositories.projectRepository,
    context.repositories.verificationResultRepository,
    context.repositories.memoryItemRepository,
    context
  );
}

class RepositoryMemoryService implements MemoryService {
  constructor(
    private readonly runs: TaskRunRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
    private readonly verification: VerificationResultRepository,
    private readonly memory: MemoryItemRepository,
    private readonly context: DesktopServiceContext
  ) {}

  async listProposals(runId: string): Promise<MemoryProposal[]> {
    await this.generateProposalsForRun(runId);
    const { task } = await this.requireRunAndTask(runId);
    const items = await this.memory.listByProjectId(task.projectId);
    return items
      .filter((item) => item.taskId === task.id)
      .map((item) => toMemoryProposal(runId, item));
  }

  async generateProposalsForRun(runId: string): Promise<MemoryProposal[]> {
    const { run, task } = await this.requireRunAndTask(runId);
    const project = await this.projects.get(task.projectId);
    if (!project) {
      throw new Error(`project ${task.projectId} not found`);
    }
    const existing = await this.memory.listByProjectId(project.id);
    const existingContent = new Set(
      existing.map((item) => normalizeMemoryContent(item.content))
    );
    if (run.status === "queued" || run.status === "running") {
      return existing
        .filter((item) => item.taskId === task.id)
        .map((item) => toMemoryProposal(runId, item));
    }
    const candidates = await this.buildCandidates(run, task, project.rootPath);
    const created: MemoryItem[] = [];
    for (const candidate of candidates) {
      if (created.length >= MAX_GENERATED_PROPOSALS) {
        break;
      }
      if (existingContent.has(normalizeMemoryContent(candidate.content))) {
        continue;
      }
      const now = this.context.now();
      const item = await this.memory.create(
        validateMemoryItem({
          id: this.context.nextId("memory"),
          projectId: project.id,
          taskId: task.id,
          category: "workflow_rule",
          status: "proposed",
          content: candidate.content,
          createdAt: now,
          updatedAt: now
        })
      );
      existingContent.add(normalizeMemoryContent(candidate.content));
      created.push(item);
    }
    const items = await this.memory.listByProjectId(project.id);
    return items
      .filter((item) => item.taskId === task.id)
      .map((item) => toMemoryProposal(runId, item));
  }

  async approve(ids: string[]): Promise<void> {
    for (const id of ids) {
      const item = await this.memory.get(id);
      if (item?.status === "proposed") {
        await this.memory.updateStatus(id, "approved", this.context.now());
      }
    }
  }

  async ignore(ids: string[]): Promise<void> {
    for (const id of ids) {
      const item = await this.memory.get(id);
      if (item?.status === "proposed") {
        await this.memory.updateStatus(id, "rejected", this.context.now());
      }
    }
  }

  private async requireRunAndTask(
    runId: string
  ): Promise<{ run: TaskRun; task: Task }> {
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`run ${runId} not found`);
    }
    const task = await this.tasks.get(run.taskId);
    if (!task) {
      throw new Error(`task ${run.taskId} not found`);
    }
    return { run, task };
  }

  private async buildCandidates(
    run: TaskRun,
    task: Task,
    projectRoot: string
  ): Promise<Array<{ content: string; source: MemoryProposalSource }>> {
    const candidates: Array<{ content: string; source: MemoryProposalSource }> = [];
    if (await usesPnpm(projectRoot)) {
      candidates.push({
        content: "This project uses pnpm rather than npm.",
        source: "run"
      });
    }

    const verificationRows = await this.verification.listByRunId(run.id);
    const realCommand = verificationRows
      .map((row) => row.command)
      .find((command) => !/simulated/i.test(command));
    if (realCommand) {
      candidates.push({
        content: `Verification command for this project is ${realCommand}.`,
        source: "verification"
      });
    }

    if (/desktop|renderer|electron/i.test(task.title) || run.agentKind === "fake") {
      candidates.push({
        content: "Desktop renderer must not access Node APIs directly.",
        source: "run"
      });
    }

    candidates.push({
      content:
        "Agent Hub does not write AGENTS.md or CLAUDE.md into target repositories by default.",
      source: "run"
    });

    return candidates;
  }
}

function toMemoryProposal(runId: string, item: MemoryItem): MemoryProposal {
  const status =
    item.status === "approved"
      ? "approved"
      : item.status === "rejected"
        ? "ignored"
        : "pending";
  return {
    id: item.id,
    runId,
    content: item.content,
    rationale: rationaleFor(item.content),
    source: sourceFor(item.content),
    status,
    createdAt: item.createdAt,
    decidedAt: status === "pending" ? undefined : item.updatedAt
  };
}

async function usesPnpm(projectRoot: string): Promise<boolean> {
  if (await pathExists(path.join(projectRoot, "pnpm-lock.yaml"))) {
    return true;
  }
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(projectRoot, "package.json"), "utf8")
    ) as { packageManager?: unknown };
    return typeof packageJson.packageManager === "string" &&
      packageJson.packageManager.startsWith("pnpm@");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function rationaleFor(content: string): string {
  if (/pnpm/.test(content)) {
    return "Detected from the registered project's package manager files.";
  }
  if (/Verification command/.test(content)) {
    return "Detected from verification results captured for the run.";
  }
  if (/renderer/.test(content)) {
    return "Matches the desktop sandbox boundary enforced for this phase.";
  }
  return "Matches Agent Hub's local-first context delivery constraints.";
}

function sourceFor(content: string): MemoryProposalSource {
  if (/Verification command/.test(content)) {
    return "verification";
  }
  return "run";
}

function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}
