> ⚠️ 注意：Agent Hub 仍处于早期开发阶段，暂时不可用于生产或稳定日常工作流。

# Agent Hub

Agent Hub 是一个 **local-first、CLI-first** 的开发者工具，用于在隔离的 git worktree 中编排和对比编码代理（例如 Codex、Claude Code、Fake Agent）的任务执行结果。

当前仓库已经具备可运行的基础能力，但整体仍在快速演进中。

## 这个项目解决什么问题

在多代理协作场景里，常见问题是：

- 任务上下文分散，提示词难复用
- 代理执行过程不可追踪，结果难比较
- 直接在主仓库运行代理容易污染工作区
- 风险变更（敏感文件、危险命令）缺乏统一扫描

Agent Hub 的目标是通过本地化能力解决这些问题：

- 为任务生成结构化上下文包（context pack）和任务简报（brief）
- 在隔离 worktree 中运行代理并收集事件、验证结果、diff、风险
- 对同一任务的不同运行结果进行本地对比
- 通过“提议 -> 审批”流程管理长期记忆

## 核心原则

- **Local-first**：默认本地存储（SQLite + 本地文件）
- **CLI-first**：CLI 是第一入口；桌面端是本地核心能力的图形壳层
- **无侵入上下文注入**：默认 runtime injection，而不是改写用户仓库
- **安全边界清晰**：任务运行在独立 worktree，不自动 merge / push / 开 PR

## 仓库结构

```text
apps/cli                  CLI 入口与交互命令
apps/desktop              Electron + React 桌面壳层
packages/shared           共享类型与工具
packages/core             领域模型与服务接口
packages/db               SQLite schema 与仓储
packages/context-compiler 上下文编译、任务简报、导出逻辑
packages/task-runner      worktree、任务执行、验证、diff 汇总
packages/agent-adapters   Fake/Codex/Claude Code 适配器
packages/safety           风险扫描与安全检查
tests                     跨包测试
```

## 当前已实现能力（概要）

- CLI 工作流：项目、任务、运行、事件、风险、记忆、对比等命令
- 本地 SQLite 持久化：项目/任务/运行/事件/风险/记忆/对比等数据
- 上下文构建：从 Agent Hub 自有上下文存储生成 brief/context pack
- 运行模式：支持 Fake、Codex、Claude Code 适配器（在隔离 worktree 中运行）
- 工件产出：运行日志、verification 结果、git diff、风险报告
- 记忆机制：memory proposal + approve/reject + approved memory 写回
- 桌面端初版：对话线程、运行卡片、检查器抽屉（日志/diff/风险/记忆）

## 仍在完善中的部分

- 桌面端对真实任务运行的完整流式体验与取消控制
- 更完整的 verification 配置与可视化
- 更丰富的跨代理评审/对比维度

## 快速开始

### 1) 安装依赖

```sh
pnpm install
```

### 2) 常用检查

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

如果全局没有 `pnpm`，可使用仓库本地二进制：

```sh
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm lint
```

### 3) 启动桌面端（开发模式）

```sh
./node_modules/.bin/pnpm --filter desktop dev
```

## CLI 命令参考

```sh
agent-hub [--project <path>] [--agent fake|codex|claude-code]
agent-hub [--db <path>] project add --name <name> --root <path>
agent-hub [--db <path>] project list
agent-hub [--db <path>] task create --project-id <project-id> --title <title> [--description <text>]
agent-hub [--db <path>] task list [--project-id <project-id>]
agent-hub [--db <path>] task history --task-id <task-id>
agent-hub context init --project-root <path> --project-id <project-id>
agent-hub context show --project-root <path> --project-id <project-id>
agent-hub context build --project-root <path> --project-id <project-id> --task-id <task-id> --title <title> --prompt <prompt>
agent-hub context export --project-root <path> --project-id <project-id> --dry-run|--write
agent-hub [--db <path>] run --task <task-id> --agent fake|codex|claude-code
agent-hub run [--repo <path>] [--workspace-base <path>] [--retain-on-failure] "@fake|@codex|@claude-code <task>"
agent-hub [--db <path>] run event add --run-id <run-id> --type <type> --message <message>
agent-hub tasks list
agent-hub runs list
agent-hub runs events <run-id>
agent-hub runs diff <run-id> [--stat|--patch] [--full]
agent-hub runs show <run-id>
agent-hub risks show <run-id>
agent-hub [--db <path>] memory list --project-id <project-id>
agent-hub [--db <path>] memory propose --project-id <project-id> --category <category> --content <text>
agent-hub [--db <path>] memory approve --memory-id <memory-id>
agent-hub [--db <path>] memory reject --memory-id <memory-id>
agent-hub [--db <path>] compare --task-id <task-id> --baseline <run-id> --candidate <run-id>
```
