import path from "node:path";
import {
  createId,
  nowIso,
  validateProject,
  type ProjectRepository
} from "@agent-hub/core";
import {
  createSqliteRepositories,
  type SqliteRepositories
} from "@agent-hub/db";
import type { ProjectSummary } from "../../src/lib/types";

export interface DesktopServiceContext {
  repositories: SqliteRepositories;
  agentHubHome?: string;
  now(): string;
  nextId(prefix: string): string;
}

export interface DesktopServiceContextOptions {
  agentHubHome?: string;
}

export interface ProjectService {
  list(): Promise<ProjectSummary[]>;
  open(projectPath: string): Promise<ProjectSummary>;
}

export function createDesktopServiceContext(
  repositories: SqliteRepositories = createSqliteRepositories(),
  options: DesktopServiceContextOptions = {}
): DesktopServiceContext {
  return {
    repositories,
    agentHubHome: options.agentHubHome,
    now: nowIso,
    nextId: createId
  };
}

export function createProjectService(
  context: DesktopServiceContext = createDesktopServiceContext()
): ProjectService {
  return new SqliteProjectService(context.repositories.projectRepository, context);
}

class SqliteProjectService implements ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly context: DesktopServiceContext
  ) {}

  async list(): Promise<ProjectSummary[]> {
    const projects = await this.projects.list();
    return projects
      .map(toProjectSummary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async open(projectPath: string): Promise<ProjectSummary> {
    const rootPath = normalizeProjectPath(projectPath);
    const existing = await this.projects.getByRootPath(rootPath);
    if (existing) {
      return toProjectSummary(existing);
    }

    const now = this.context.now();
    const project = validateProject({
      id: this.context.nextId("project"),
      name: path.basename(rootPath) || "Local Project",
      rootPath,
      createdAt: now,
      updatedAt: now
    });
    return toProjectSummary(await this.projects.create(project));
  }
}

function normalizeProjectPath(projectPath: string): string {
  if (typeof projectPath !== "string" || projectPath.trim().length === 0) {
    throw new Error("project path is required");
  }
  return path.resolve(projectPath.trim());
}

function toProjectSummary(project: {
  id: string;
  name: string;
  rootPath: string;
  updatedAt: string;
}): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    updatedAt: project.updatedAt
  };
}
