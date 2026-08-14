# Agent Hub

[English](README.md)

**面向 Coding Agent 的本地运行时与控制层。**

Agent Hub 位于软件任务与 Codex、Claude Code 等 Coding Agent 之间，为每次
运行提供精准上下文、独立 Git Worktree、统一执行协议和可审查的证据链。

它试图回答一个实际的工程问题：

> 如何让 Coding Agent 真正参与代码库开发，同时不失去对上下文、代码变更、
> 验证结果、长期记忆和多 Agent 委派的控制？

Agent Hub 坚持 local-first，项目的核心不是聊天界面，而是 Agent 运行时。
它不依赖云端后端、账号系统、远程执行，也不要求在代码库根目录预先维护一套
Agent 配置文件。

> 当前状态：Agent Hub 仍在积极开发中。Agent 执行、隔离、上下文、证据、
> 结果比较、记忆和安全链路已经可以运行，但它还不是稳定的生产工具。

## 它解决什么问题

调用一次 Coding Agent 很容易，让 Agent 在真实项目里持续、可靠地工作则更难：

- Agent 可能收到过多、过少或已经过期的上下文；
- Agent 可能在开发者当前工作目录中直接修改尚未审查的代码；
- Codex 与 Claude Code 暴露的进程和事件行为并不一致；
- 日志、测试、Diff、产物和风险信息散落在不同工具中；
- 多 Agent 委派可能产生循环、重复工作或越权执行；
- 未经验证的模型结论可能被错误地沉淀为长期记忆。

Agent Hub 将这些问题拆成明确的本地运行阶段，并为每个阶段保留持久化证据。

## 一次 Agent 运行如何完成

```mermaid
flowchart LR
    Task["任务或角色请求"] --> Context["上下文规划与任务 Brief"]
    Context --> Worktree["独立 Git Worktree"]
    Worktree --> Adapter["Codex 或 Claude 适配器"]
    Adapter --> Verify["验证、Diff、产物与风险扫描"]
    Verify --> Evidence["本地 SQLite 证据"]
    Evidence --> Review["审查、比较、继续或丢弃"]
```

Agent 不会以原始项目目录作为工作目录。无论选择哪一种已支持的 Agent，真实运行
都会经过同一条本地 `TaskRunner` 执行路径。

## Agent 核心能力

### 1. 用同一套协议接入不同 Coding Agent

Agent Hub 为能力检测和执行定义了统一适配器边界：

```ts
export interface AgentAdapter {
  kind: AgentKind;
  displayName: string;

  detect(): Promise<AgentDetectionResult>;
  run(input: AgentRunInput): AsyncIterable<AgentRunEvent>;
}
```

当前实现包括：

- `CodexAdapter`：在任务 Worktree 内以非交互方式运行 `codex exec`；
- `ClaudeCodeAdapter`：在任务 Worktree 内以非交互方式运行
  `claude --print`；
- `FakeAgentAdapter`：为测试和内部调试提供确定性执行。

适配器统一处理运行前检测、运行时输入、stdout/stderr 流、生命周期事件、失败状态
和退出码，同时避免把编排逻辑写进某个特定 Agent 的集成代码。

### 2. 选择上下文，而不是把整个项目塞进 Prompt

Agent Hub 将项目上下文、已审批记忆和可复用技能保存在 Agent Hub 自己管理的
存储中。每次运行时，上下文编译器会使用以下信号构建任务级上下文计划和 Brief：

- 任务与角色的显式引用；
- BM25 文本检索；
- 时效性信号；
- 代码依赖图关系；
- 可选的本地语义检索与重排扩展；
- 确定性的选择、遗漏记录和上下文压缩。

默认交付模式是 `runtime_injection`：选中的 Brief 和上下文直接传给适配器，
不会向目标代码库写入 Agent 文件。可选的 `worktree_overlay` 只会在隔离
Worktree 中生成文件；导出到原始代码库则是另一个需要预览和明确确认的操作。

### 3. 基于 Worktree 的隔离执行

每个任务运行都有独立的 Git 分支和 Worktree。随后运行器会：

1. 准备任务级运行时上下文；
2. 以 Worktree 为 `cwd` 启动选中的 Agent；
3. 记录流式事件和最终状态；
4. 执行项目配置的验证命令；
5. 收集 Git Diff 和运行产物；
6. 生成安全与风险报告；
7. 将完整运行摘要保存到本地。

即使一次运行失败或质量不佳，也可以完整检查和复现，而不会污染开发者原始
工作目录。

### 4. 有边界的多 Agent 委派

Agent Hub 使用本地工作组角色和 `RoleCall` 描述 Agent 间的任务委派。只有当
角色策略允许对应目标和能力时，一个角色才能将有边界的子任务交给另一个角色。

委派前会检查：

- 调用方与被调用方权限；
- 调用图深度和 fan-out 上限；
- 重复工作；
- Todo 容量；
- 执行器是否可用；
- 危险命令文本。

被接受并可执行的 RoleCall 会复用普通运行的隔离 `TaskRunner` 路径。RoleCall、
Todo、生命周期事件以及关联的运行证据都会被持久化，而不是隐藏在一次模型回复里。

### 5. 证据、比较、记忆与安全

Agent Hub 会保存判断 Agent 结果所需的工程证据：

- 结构化运行事件和日志；
- 验证命令与结果；
- 有边界的 Git Diff 和产物；
- 敏感路径和危险命令发现；
- 持久化风险报告；
- 人工审查决定；
- 同一任务两次运行之间的比较报告。

长期记忆遵循明确的生命周期：

```text
proposed -> approved -> 可以进入未来任务上下文
proposed -> rejected -> 忽略
```

Agent 输出不能静默变成长期记忆。审批通过后，记忆才会写入 Agent Hub 管理的
上下文存储；待审批和已拒绝的条目则继续作为本地 SQLite 证据保留。

## 当前已经实现

| 领域 | 已实现行为 |
| --- | --- |
| Agent 执行 | Codex、Claude Code 和确定性 Fake Agent 共用统一接口。 |
| 运行隔离 | 每次运行使用位于原始工作目录之外的独立 Git Worktree。 |
| 上下文 | 任务 Brief、检索计划、上下文选择、遗漏记录、压缩与本地评估证据。 |
| 验证 | 项目验证命令、输出采集、结构化结果和持久化运行摘要。 |
| 审查证据 | 日志、事件、Diff、产物、风险报告、审查决定和运行结果比较。 |
| 多 Agent 委派 | 策略校验的 RoleCall、角色 Todo、有界 fan-out 和隔离委派运行。 |
| 记忆 | 记忆提议、审批、拒绝以及已审批记忆注入。 |
| 安全 | 敏感路径、危险命令、高风险 Diff 和 blocking 风险检测。 |

## 运行一次 Agent 任务

### 环境要求

- Node.js 22 或更高版本
- pnpm 10.10.0
- Git
- 如需真实运行，安装并登录 Codex CLI 和/或 Claude Code CLI

### 从源码构建

```sh
git clone https://github.com/LancherM/AgentHub.git
cd AgentHub
corepack enable
pnpm install
pnpm build
```

在源码目录中，可以为构建后的 CLI 定义一个简单辅助函数：

```sh
agent-hub-dev() {
  node "$PWD/apps/cli/dist/cli.js" "$@"
}
```

### 注册项目并初始化上下文

```sh
agent-hub-dev project add --name my-app --root /path/to/my-app

agent-hub-dev context init \
  --project-root /path/to/my-app \
  --project-id <project-id>
```

默认情况下，这会在被注册代码库之外创建由 Agent Hub 管理的上下文存储。

### 运行 Codex 或 Claude Code

```sh
agent-hub-dev run --repo /path/to/my-app "@codex add the focused change"

agent-hub-dev run --repo /path/to/my-app \
  "@claude-code investigate the failing test"
```

### 检查运行证据

```sh
agent-hub-dev runs list
agent-hub-dev runs show <run-id>
agent-hub-dev runs events <run-id>
agent-hub-dev runs diff <run-id> --stat
agent-hub-dev risks show <run-id>
```

使用两个 Agent 运行同一个任务后，可以比较持久化结果：

```sh
agent-hub-dev compare \
  --task-id <task-id> \
  --baseline <codex-run-id> \
  --candidate <claude-run-id>
```

## 安全边界

Agent Hub 明确不会：

- 在原始项目目录中运行 Agent；
- 自动合并 Agent 生成的代码；
- 自动推送分支或创建 Pull Request；
- 自动批准模型生成的长期记忆；
- 在 SQLite 中保存 API Key 或密钥；
- 未经用户预览和明确导出，就向代码库写入 `AGENTS.md`、`CLAUDE.md`、
  `.claude/skills` 或 `.agents/skills`；
- 添加云同步、账号系统或远程任务执行。

`.env`、私钥、凭据和 Token 文件等敏感路径会被标记。危险命令模式和高风险
Diff 可以生成 blocking 风险报告，从而阻止自动接受结果。

## 架构

```text
Task 或 RoleCall
  -> Local Core
     -> Context Compiler
        -> 上下文计划
        -> 任务 Brief
        -> 运行时注入
     -> Task Runner
        -> Git Worktree
        -> Agent Adapter
           -> Codex / Claude Code / Fake Agent
        -> 验证命令
        -> Diff 与产物
        -> 风险报告
     -> 本地 SQLite 证据
        -> 人工审查
        -> 运行比较
        -> 记忆提议
```

Workspace 将 Agent 编排能力放在可复用的本地包中：

```text
packages/
  core/                领域模型与应用服务
  db/                  SQLite migration 与 repository
  agent-adapters/      Codex、Claude Code 与 Fake Agent 适配器
  context-compiler/    检索、任务 Brief 与运行时载荷
  task-runner/         Worktree、执行、验证与证据收集
  safety/              命令、路径、Diff 与 RoleCall 策略检查
  shared/              共享协议与工具
```

Agent 编排、上下文选择、执行策略和证据持久化属于共享本地核心，而不是某个
界面层。

更深入的产品和实现说明见 [`docs/product.md`](docs/product.md) 与
[`docs/architecture.md`](docs/architecture.md)。

## 开发验证

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

项目使用 pnpm TypeScript workspace、Vitest、Zod 运行时校验、
`better-sqlite3` 和 Git Worktree。

## 当前限制

- Codex 和 Claude Code 的事件映射仍可以进一步结构化；
- 部分预留的本地执行器类型尚未实现；
- 某些委派和执行证据仍使用 metadata-backed 存储，未来可能拆为一等表结构；
- 合并、推送、创建 Pull Request 和删除分支仍是 Agent 自动执行的明确非目标。
