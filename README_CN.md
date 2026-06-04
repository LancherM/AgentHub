# Agent Hub

[English](README.md)

Agent Hub 是一个本地优先、CLI 优先的编码代理工作台。它把 Codex、Claude Code
等代理放进隔离的 Git worktree 中运行，并把每次运行的上下文、日志、验证、
diff、风险和评审记录留在本地，方便你审查、比较和继续推进。

> 状态说明：Agent Hub 仍处于早期开发阶段，适合本地试用和小范围工作流验证，
> 还不建议作为稳定生产工具依赖。

## 它解决什么问题

直接在主仓库里运行编码代理，常见问题是上下文难复用、运行过程难追踪、工作区
容易被污染、结果缺少审查依据。Agent Hub 的目标是把这些环节变成清晰、可审计
的本地流程：

- 为每个任务生成专用 context pack 和 task brief。
- 默认通过 runtime injection 传递上下文，不主动改写你的仓库。
- 在隔离 worktree 中运行 Codex 或 Claude Code。
- 捕获日志、运行事件、验证结果、Git diff、artifact 和风险报告。
- 对比同一任务的多个代理结果。
- 用 propose、approve、reject 流程管理长期 memory。
- 让 CLI、终端 TUI、桌面 shell 复用同一套本地核心能力。

Agent Hub 不是 SaaS 产品。它不引入登录、云同步、远程执行队列、托管看板、自
动 merge、自动 push 或自动创建 PR。

## 当前可以做什么

| 模块 | 当前能力 |
| --- | --- |
| 项目和任务 | 注册本地项目、创建任务、查看历史，并把证据保存在本地 SQLite。 |
| 上下文 | 构建 Agent Hub 自有的 context pack 和 task brief；默认运行时注入。 |
| 代理运行 | 通过适配器运行 Codex 和 Claude Code；调试和测试时可启用确定性的 Fake 适配器。 |
| 隔离 | 为每次运行创建独立 Git worktree，不在原项目目录直接执行代理。 |
| 审查 | 查看 run summary、日志、artifact、验证结果、风险报告和有界 diff。 |
| 会话 | 支持持久化 chat thread、room、role mention、继续运行和只记录审计的 review decision。 |
| TUI | `agent-hub tui` 提供 conversation-first 的终端工作台，展示当前项目证据。 |
| 桌面 GUI | Electron + React shell 支持 room、内联 run card、检查器、Team/Knowledge 工作区、memory 审批、生命周期控制和显式本地 apply。GUI 已可用，但当前日常主交互面更推荐 TUI。 |
| Memory 和技能 | 提议、审批、拒绝并注入 approved memory；创建并选择 global skill。 |

仍在推进的方向：

- 更丰富的 Codex 和 Claude Code 结构化事件映射。
- 为保留的 role executor 类型增加更多本地执行后端。
- 当 metadata-backed 存储不够用时，再引入一等本地 schema 拆分。
- 显式 merge、push、PR 和分支删除工作流。
- 专门的桌面 skills 管理界面。

## 快速开始

### 环境要求

- Node.js 22 或更高版本。
- pnpm 10.10.0，仓库已在 `packageManager` 中声明。
- Git。
- 如果要运行真实代理，需要本机已安装并登录 Codex CLI 或 Claude Code CLI。

### 从源码运行

```sh
git clone https://github.com/LancherM/AgentHub.git
cd AgentHub
corepack enable
pnpm install
pnpm build
```

当前仓库的源码使用方式是直接调用构建后的 CLI 入口：

```sh
agent-hub-dev() {
  node "$PWD/apps/cli/dist/cli.js" "$@"
}

agent-hub-dev --help
```

### 注册一个项目

```sh
agent-hub-dev project add --name my-app --root /path/to/my-app
agent-hub-dev project list
```

记下返回的 `project_id`，很多命令会显式使用它。

### 初始化上下文

```sh
agent-hub-dev context init \
  --project-root /path/to/my-app \
  --project-id <project-id>

agent-hub-dev context show \
  --project-root /path/to/my-app \
  --project-id <project-id>
```

默认情况下，上下文保存在 Agent Hub 应用数据目录，并在运行时注入到代理。Agent
Hub 不会默认把 `AGENTS.md`、`CLAUDE.md`、`.claude/skills` 或
`.agents/skills` 写进你的仓库；只有你显式执行带 preview/write 的 export 命令
才会进行仓库导出。

### 运行代理

```sh
agent-hub-dev run --repo /path/to/my-app "@codex add the focused change"
agent-hub-dev runs list
agent-hub-dev runs show <run-id>
agent-hub-dev runs diff <run-id> --stat
```

运行 Claude Code：

```sh
agent-hub-dev run --repo /path/to/my-app "@claude-code investigate the failing test"
```

调试用确定性 Fake 适配器：

```sh
agent-hub-dev --debug run --repo /path/to/my-app "@fake create a safe sample output"
```

### 使用 Chat 或 TUI

```sh
agent-hub-dev chat
agent-hub-dev tui
agent-hub-dev tui --once
```

`chat` 会持久化本地 thread。`tui` 是一个当前上下文终端工作台，包含 Work、Runs、
Review、Graph、Tasks、Memory、Team 和 Help 等视图。

## TUI 工作台

由于桌面 GUI 还不完善，`agent-hub tui` 目前更能代表 Agent Hub 的主交互方向。
它是键盘优先的终端工作台，读取和 CLI、桌面端相同的本地证据。

TUI 不是项目浏览器、原始日志倾倒器，也不是 apply/merge 界面。它聚焦当前项目、
thread 或 room：展示代理对话、运行状态和审查线索，并把 review 操作限定为本地
审计记录。

### 启动方式

```sh
agent-hub-dev tui
agent-hub-dev tui --room <handle-or-thread-id>
agent-hub-dev tui --thread <thread-id>
agent-hub-dev tui --agent codex
agent-hub-dev tui --once
agent-hub-dev tui --submit "review the current failure" --dry-run
```

常用参数：

| 参数 | 用途 |
| --- | --- |
| `--thread <id>` | 打开指定持久化 chat thread。 |
| `--room <handle-or-id>` | 打开当前注册项目中的 room。 |
| `--agent codex|claude-code|fake` | 选择默认 prompt 目标；`fake` 用于调试和测试工作流。 |
| `--submit <prompt>` | 通过 TUI composer 路径提交一次 prompt，然后渲染结果。 |
| `--dry-run` | 创建 submitted run，但不执行适配器。 |
| `--workspace-base <path>` | 指定 submitted run 的 worktree 创建位置。 |
| `--retain-on-failure` | 保留失败 run 的 worktree，方便检查。 |
| `--accept-run <id>` / `--reject-run <id>` | 记录 audit-only 的 review decision。 |
| `--once` | 渲染一次后退出，适合 smoke check 或脚本。 |

### 视图说明

| 视图 | 适合查看 |
| --- | --- |
| Work | 主对话终端。展示用户 prompt、完整的已完成代理回复、active run box、验证和风险摘要、小型内联 diff、quick reply 和 next-action hint。 |
| Runs | 当前上下文的运行视图。展示 active/recent run、stage、检查、风险、diff 数量、retained-worktree 状态和等价 CLI 命令。 |
| Review | 聚焦审查视图。可以展开有界 diff、查看对比摘要，并记录本地 accept/reject，不会 apply 代码。 |
| Graph | RoleCall 和 delegation 状态，包括 waiting、active、completed、blocked、迭代次数、收敛原因和 linked run evidence。 |
| Tasks | Task 和 RoleTodo 状态、分配、deferred/rejected follow-up 信号，以及下一步本地动作。 |
| Memory | Memory 治理状态：proposed、approved、rejected 计数，选中的 skill、可用 skill id 和上下文传递模式。 |
| Team | 项目 role 配置、executor 标签、enabled/runnable 计数、默认 room、选中 skill，以及等价 team-role CLI 命令。 |
| Help | 视图快捷键、palette、search、timeline、notify 和 review 快捷键提示。 |

### 键盘模型

TUI 默认优先输入 prompt。可打印字符会进入 composer；切换视图的快捷键在 composer
为空时使用大写字母，避免抢走正常输入。

| 快捷键或命令 | 行为 |
| --- | --- |
| 输入文本 | 编辑 composer 中的 prompt。 |
| `@` | 编辑时显示 agent 和 role mention 补全。 |
| `Enter` | composer 有文本时提交 prompt；空 `Enter` 不会切换面板。 |
| `Ctrl+J` | 提交当前 prompt。 |
| `Ctrl+O` | 在 composer 中插入换行。 |
| `Esc` | 清空 composer、关闭 search/palette，或从聚焦面板返回。 |
| `Up` / `Down` | 选择行；编辑时可切换 composer 历史。 |
| `Tab` / `Shift+Tab` | 在 focus mode 之间移动。 |
| `W`, `R`, `V`, `G`, `T`, `M`, `E`, `?` | 打开 Work、Runs、Review、Graph、Tasks、Memory、Team 或 Help。 |
| `:` | 打开 command palette，里面有安全 focus action 和等价 CLI 命令。 |
| `Ctrl+F` 或 `/search` | 搜索已渲染的对话文本。 |
| `L` 或 `/timeline` | 打开或关闭当前 conversation/run event 的 mini timeline。 |
| `/notify` | 开关本次终端会话内的完成通知。 |
| `C` | 在 Work 中准备 continuation prompt。 |
| Review 中的 `a` / `R` | 对选中 run 记录 audit-only accept 或 reject。 |
| Review 中的 `Enter` / `Space` | 展开或收起选中 run 的 diff。 |
| Review 中的 `s` | 有可对比 run 时切换 compare mode。 |
| 聚焦面板中的 `p` | 打印等价本地 CLI 命令提示。 |
| `x`、`q` 或 `Ctrl+C` | composer 为空时退出。 |

### TUI 边界

- 它读取持久化本地证据和 shared read model。
- 它通过同一条本地 CLI chat/run 路径提交 prompt。
- 它默认保留完整的已完成代理输出，不折叠答案。
- Memory approval、apply、merge、push、PR 创建、context export、cleanup 和后台
  continuation 都不会自动发生。
- Review 快捷键只创建本地 `review_decision` artifact。

### 启动桌面 GUI

```sh
pnpm --filter desktop dev
```

桌面 GUI 可用于查看 room、run card、review panel、memory proposal、生命周期
控制以及 Team/Knowledge 表面，但当前完整度和打磨程度还不如 TUI。桌面端
renderer 只通过安全的 `window.agentHub` preload API 工作；文件系统、SQLite、
shell、Git 和代理执行等有权限操作，都在 Electron main process IPC 或共享本地
包里完成，不直接放在 React renderer 中。

## 常用流程

| 目标 | 命令 |
| --- | --- |
| 添加项目 | `agent-hub-dev project add --name <name> --root <path>` |
| 创建任务 | `agent-hub-dev task create --project-id <id> --title <title>` |
| 运行已保存任务 | `agent-hub-dev run --task <task-id> --agent codex` |
| 运行临时 prompt | `agent-hub-dev run --repo <path> "@codex <task>"` |
| 基于已有证据继续 | `agent-hub-dev run --continue-from-run <run-id> --repo <path> "@codex <task>"` |
| 查看运行 | `agent-hub-dev runs show <run-id>` 和 `agent-hub-dev reviews show <run-id>` |
| 查看输出 | `agent-hub-dev runs events <run-id>` 和 `agent-hub-dev runs diff <run-id> --patch` |
| 记录评审结论 | `agent-hub-dev reviews accept <run-id>` 或 `agent-hub-dev reviews reject <run-id>` |
| 对比两个结果 | `agent-hub-dev compare --task-id <task-id> --baseline <run-id> --candidate <run-id>` |
| 管理 memory | `agent-hub-dev memory list/propose/approve/reject ...` |
| 管理角色 | `agent-hub-dev team roles list --project-id <id>` |
| 管理 room | `agent-hub-dev rooms list --project-id <id>` |
| 使用 global skill | `agent-hub-dev skills global create ...` 和 `agent-hub-dev run --skill global:<id> ...` |

完整命令可以通过下面命令查看：

```sh
agent-hub-dev --help
```

## 安全边界

Agent Hub 的设计重点是本地、显式、可审计：

- 真实代理运行发生在隔离 Git worktree 中，不在原项目目录直接执行。
- 默认使用 runtime injection 传递上下文；仓库导出必须显式 preview/write。
- 验证命令采用结构化 executable-plus-args，并经过危险命令检查。
- 敏感路径和高风险 diff 会进入 risk report；敏感 patch 文本在审查界面渲染前会被隐藏。
- Review decision 只是本地审计记录，不会 merge、push、批准 memory 或创建 PR。
- 桌面端 local apply 需要显式确认；它不会 commit、merge、push、创建 PR、批准
  memory，也不会导出仓库上下文。

## 本地数据位置

Agent Hub 的数据保存在本机：

- SQLite 数据库：默认在 Agent Hub 应用数据目录。
- Context store：默认在 Agent Hub 应用数据目录。
- 运行 worktree：使用配置的 workspace base，或 task-runner 的本地默认目录，
  并且不在原项目目录内。

常用覆盖方式：

```sh
AGENT_HUB_HOME=/path/to/agent-hub-home agent-hub-dev project list
AGENT_HUB_DB_PATH=/path/to/agent-hub.sqlite agent-hub-dev project list
agent-hub-dev --db /path/to/agent-hub.sqlite project list
agent-hub-dev run --workspace-base /path/to/worktrees --repo /path/to/my-app "@codex <task>"
```

## 仓库结构

```text
apps/cli                  CLI、chat、TUI 命令边界和输出渲染
apps/desktop              Electron + React 桌面 shell
packages/shared           共享类型、agent kind、role 和 DTO
packages/core             领域模型、仓储契约、read model
packages/db               SQLite 迁移和仓储实现
packages/context-compiler context store、context pack、brief、memory、skill
packages/agent-adapters   Fake、Codex、Claude Code 进程适配器
packages/task-runner      worktree、适配器执行、验证、diff
packages/safety           危险命令、敏感路径和风险扫描
tests                     跨包 Vitest 覆盖
docs                      产品、架构和设计说明
```

## 开发验证

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

如果全局 `pnpm` 不可用，安装依赖后通常可以使用仓库本地二进制：

```sh
./node_modules/.bin/pnpm typecheck
./node_modules/.bin/pnpm test
./node_modules/.bin/pnpm lint
./node_modules/.bin/pnpm build
```

构建或预览桌面端：

```sh
pnpm desktop:build
pnpm --filter desktop preview
```

## 一屏看懂架构

```text
CLI
  -> local package APIs
  -> TaskRunner
  -> Agent adapters
  -> isolated git worktree
  -> local SQLite evidence

Desktop renderer
  -> sandboxed preload window.agentHub
  -> Electron IPC handlers
  -> main-process services
  -> local package APIs / TaskRunner
  -> isolated git worktree
  -> local SQLite evidence
```

CLI 和桌面端共享同一套本地核心。桌面应用只是图形 shell，不是另一套编排后端。
