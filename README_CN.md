# Agent Hub

[English](README.md)

Agent Hub 是一个本地优先、CLI 优先的开发者工具，用于在隔离的 Git
worktree 中编排 Codex、Claude Code 等编码代理。当前实现采用导入规格中的
workspace 形态：`apps/cli` 是薄 CLI，底层复用 `packages/` 中的本地核心包；
`apps/desktop` 是第一版 Electron + React 桌面 shell，复用同一套本地存储和
review 服务。

## 仓库结构

```text
apps/cli                 CLI 解析、交互式 shell、命令输出渲染
apps/desktop             Electron + React 桌面 shell
packages/shared          共享类型、枚举和工具契约
packages/core            领域校验和仓储接口
packages/db              SQLite schema、迁移和仓储实现
packages/context-compiler 上下文存储、上下文包、任务 brief 和导出
packages/task-runner     worktree、验证、diff、风险报告编排
packages/agent-adapters  Fake、Codex、Claude Code 适配器
packages/safety          危险命令、敏感路径和风险扫描
tests                    跨包 Vitest 覆盖
```

桌面应用保持本地优先。renderer 只能调用安全的 `window.agentHub` preload API；
所有有权限的本地操作都必须经过 Electron main process IPC。桌面端不引入 Web
服务器、登录、云同步、远程执行、自动 merge、自动 push 或自动 PR。

## 命令

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

## 当前能力

- 提供第一版桌面 shell，包括 project/run 导航、run timeline、New Run modal，
  以及 Summary/Diff/Tests/Risk/Memory review tabs。
- 默认使用 SQLite 在本地持久化 project、task、run、event、artifact、
  verification、risk、memory、comparison、skill 和 settings。
- 保留内存仓储，便于注入式测试和聚焦的 runner 验证。
- 从 Agent Hub 自有上下文存储构建非侵入式任务上下文和任务 brief。
- 支持显式仓库上下文导出，包含 dry-run 预览和 managed block。
- 在隔离 worktree 内运行 Fake、Codex 和 Claude Code 适配器。
- 默认通过 runtime injection 注入任务 brief 和上下文；可选 worktree overlay
  只写入隔离 worktree。
- 捕获运行事件、验证结果、Git diff、运行 artifact 和风险报告。
- 支持通过 `run event add` 手动记录事件；追加事件会使用目标 run 的下一个
  sequence number。
- 支持显式 memory proposal、approve、reject，以及 approved-memory writeback。
- 为同一 task 的两个 run 生成持久化 comparison report。
- 不引入 cloud sync、账号、远程执行、自动 merge、自动 push 或自动 PR。

## 当前缺口

- 桌面端接入真实 TaskRunner、Codex/Claude/fake 执行、流式事件、取消、
  验证配置、保留 worktree 的 diff review，以及 approved-memory 写回确认。
- 从已完成 run 自动生成 memory proposal。
- 比当前持久化文本 summary 更丰富的 comparison scoring。

## 验证

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

如果全局 `pnpm` 不可用，可以使用仓库本地二进制：

```sh
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm lint
```

本地运行桌面 shell：

```sh
./node_modules/.bin/pnpm --filter desktop dev
```
