# Adaptive Role Calls 产品规格

## 产品定位

Adaptive Role Calls 是 Agent Hub 的本地优先角色协作机制。它让
`@analyst`、`@operator`、`@reviewer`、`@engineer` 等角色可以动态提出协作请求、
分配工作、拒绝或搁置不合适的请求，并在同一个本地任务图里合作完成用户目标。

这个能力不是自由多智能体群聊，也不是固定步骤的工作流引擎。角色可以自由表达
协作意图，但所有现实执行都必须由 Agent Hub 的 Orchestrator 统一解析、校验、
调度、持久化和审计。

核心原则：

- Role 自由提出意图，Orchestrator 负责执行现实。
- 角色之间不能直接调用彼此；它们只能发出结构化意图。
- 每次协作请求都是可审计的 `RoleCall`。
- 每个角色都有自己的 `RoleTodo` 列表，用来跟踪正在做、搁置、拒绝、阻塞或完成的工作。
- 拒绝和搁置是正常协作事件，不是异常失败。
- 调用方必须感知被调用方的接受、拒绝、搁置、补充上下文请求和执行结果。
- 系统动态生成协作图，而不是套用固定的阶段模板。

## 非目标

- 不做自由 form 的 role-to-role 聊天。
- 不把 Orchestrator 做成一个可被 `@orchestrator` 提及的角色。
- 不默认自动合并、推送、创建 PR、批准内存或写入用户仓库根目录。
- 不做云端任务执行、登录系统、远程队列或团队 SaaS。
- 不要求用户手工配置固定 workflow 才能使用角色协作。

## 用户体验

用户仍然面对一个简单目标输入：

```text
帮我找出这次桌面运行失败的原因，修复它，并评估风险。
```

分析角色可以生成计划，并提出结构化协作意图：

```text
@operator 检查最近失败的桌面运行日志，定位失败点并给出可验证修复方案。
@reviewer 审查 operator 的修复方案，重点关注本地优先边界、测试覆盖和回归风险。
```

界面上不应把这渲染成多个角色在聊天。它应显示为一个动态协作任务图：

```text
User goal
└─ analyst
   ├─ operator: inspect desktop run failure
   │  ├─ accepted
   │  ├─ running
   │  └─ succeeded: root cause and patch summary
   └─ reviewer: review fix risk
      ├─ deferred: waiting for operator patch
      └─ todo: review patch after tests complete
```

当 reviewer 在 operator 正在改代码时提出新的 bug，operator 可以接受，也可以搁置
或拒绝：

```json
{
  "disposition": "deferred",
  "reason": "I am currently applying the persistence patch. Interrupting now risks mixing unrelated changes.",
  "suggestedResumeCondition": "after current patch is written and focused tests are run",
  "todo": {
    "title": "Investigate reviewer finding after current patch",
    "priority": "normal"
  }
}
```

调用方随后能在上下文里看到：

```text
Role call to @operator was deferred.
Reason: operator is completing the current patch and queued the reviewer finding as a todo.
```

## 核心对象

### RoleDefinition

角色定义描述角色能做什么、默认上下文、默认权限、执行器和输出要求。

```ts
type RoleTrustLevel = "preset" | "user_defined" | "restricted";

interface DelegationPolicy {
  canInitiateRoleCalls: boolean;
  allowedIntentTypes: RoleIntentType[];
  allowedTargetRoles?: string[];
  allowedTargetCapabilities?: string[];
  requiresApprovalForTargets?: string[];
}

interface IntakePolicy {
  acceptsRoleCalls: boolean;
  acceptedCallerRoles?: string[];
  acceptedCallerCapabilities?: string[];
  acceptedIntentTypes: RoleIntentType[];
  canReject: boolean;
  canDefer: boolean;
}

interface RoleDefinition {
  id: string;
  handle: string;
  displayName: string;
  purpose: string;
  defaultInstructions: string;
  capabilities: RoleCapability[];
  permissions: PermissionSet;
  contextPolicy: RoleContextPolicy;
  approvalPolicy: RoleApprovalPolicy;
  delegationPolicy: DelegationPolicy;
  intakePolicy: IntakePolicy;
  executor: RoleExecutor;
  trustLevel: RoleTrustLevel;
  enabled: boolean;
}
```

预设角色可以带有较完整的默认策略。用户自定义角色必须使用保守默认值：默认不允许
发起 RoleCall，或只允许请求低风险的 review/analysis；涉及 operator、engineer、
文件写入、shell、网络或外部副作用的目标必须由用户显式配置或审批。

### RoleIntent

角色输出的协作意图。它不是执行记录；只有 Orchestrator 接受后才会变成
`RoleCall`、`RoleApprovalRequest`、`RoleTodo` 或风险事件。

```ts
type RoleIntent =
  | {
      type: "delegate";
      targetRole: string;
      task: string;
      reason: string;
      expectedOutput: ExpectedOutputSpec;
      priority?: RolePriority;
    }
  | {
      type: "request_review";
      targetRole: string;
      artifactId?: string;
      task: string;
      reason: string;
    }
  | {
      type: "request_evidence";
      targetRole: string;
      question: string;
      requiredEvidence?: string[];
    }
  | {
      type: "request_approval";
      approvalType: string;
      reason: string;
      requestedAction: string;
    }
  | {
      type: "report_result";
      result: RoleResult;
    }
  | {
      type: "raise_risk";
      risk: string;
      evidence: string[];
    }
  | {
      type: "update_todo";
      todoId?: string;
      status: RoleTodoStatus;
      note: string;
    };
```

### RoleCall

RoleCall 是 Orchestrator 接受某个协作意图后的工作请求记录。它是请求，不是命令。
被调用角色有权接受、拒绝、搁置、请求更多上下文或请求用户审批。

```ts
type RoleCallStatus =
  | "proposed"
  | "assessing"
  | "accepted"
  | "queued"
  | "running"
  | "deferred"
  | "rejected"
  | "waiting_context"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

interface RoleCall {
  id: string;
  threadId: string;
  parentMessageId?: string;
  parentRoleCallId?: string;
  callerRole: string;
  calleeRole: string;
  task: string;
  reason?: string;
  context: RoleCallContext;
  permissions: PermissionSet;
  expectedOutput: ExpectedOutputSpec;
  priority: RolePriority;
  depth: number;
  status: RoleCallStatus;
  decision?: RoleCallDecision;
  result?: RoleResult;
  taskRunId?: string;
  todoId?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

### RoleCallDecision

被调用角色必须先做接单判断。拒绝和搁置都应被持久化并回传给调用方。

```ts
type RoleCallDisposition =
  | "accepted"
  | "rejected"
  | "deferred"
  | "needs_context"
  | "needs_approval";

interface RoleCallDecision {
  disposition: RoleCallDisposition;
  reason: string;
  evidence?: string[];
  requiredContext?: string[];
  suggestedResumeCondition?: string;
  alternativeTask?: string;
  risk?: string;
  todo?: {
    title: string;
    priority?: RolePriority;
    dueHint?: string;
  };
}
```

### RoleTodo

每个角色都有自己的 todo 列表。它不是普通用户任务列表，而是角色运行时工作账本。
搁置的 RoleCall 必须进入被调用角色的 todo 列表，调用方也能看到关联事件。

```ts
type RoleTodoStatus =
  | "open"
  | "in_progress"
  | "deferred"
  | "blocked"
  | "done"
  | "rejected"
  | "cancelled";

interface RoleTodo {
  id: string;
  threadId: string;
  role: string;
  sourceRoleCallId?: string;
  parentTodoId?: string;
  title: string;
  description?: string;
  status: RoleTodoStatus;
  priority: RolePriority;
  reason?: string;
  blockedBy?: string[];
  relatedRoleCallIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

Todo 行为要求：

- accepted 的 RoleCall 可以创建或更新 `in_progress` todo。
- deferred 的 RoleCall 必须创建或更新 `deferred` todo。
- rejected 的 RoleCall 可以创建 `rejected` todo，用于记录拒绝原因和审计。
- succeeded 的 RoleCall 应将关联 todo 标记为 `done`。
- cancelled 的 RoleCall 应将关联 todo 标记为 `cancelled`，除非用户选择保留为 open。
- caller 的后续上下文必须包含 callee 的 todo/decision 事件摘要。

### RoleCallEvent

RoleCallEvent 是调用方感知和 UI 时间线的基础。

```ts
type RoleCallEventType =
  | "created"
  | "assessment_started"
  | "accepted"
  | "deferred"
  | "rejected"
  | "context_requested"
  | "approval_requested"
  | "queued"
  | "started"
  | "todo_created"
  | "todo_updated"
  | "result_reported"
  | "failed"
  | "cancelled";

interface RoleCallEvent {
  id: string;
  roleCallId: string;
  threadId: string;
  type: RoleCallEventType;
  actorRole?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

### RoleResult

RoleResult 是角色完成工作后的结构化输出。所有可执行角色都必须返回可验证 JSON。

```ts
interface RoleResult {
  summary: string;
  evidence: string[];
  commandsRun?: {
    command: string;
    exitCode: number | null;
    outputSummary: string;
  }[];
  filesRead?: string[];
  filesTouched?: string[];
  patchSummary?: string;
  risks?: string[];
  nextSteps?: string[];
  rawOutput?: string;
}
```

## Orchestrator

Orchestrator 是系统运行时组件，不是角色。它不产出面向用户的分析文本，不参与讨论，
也不应出现在 `@` autocomplete 中。

职责：

- 解析 role 输出中的结构化意图和行首 mention 语法。
- 校验调用方是否允许提出该类型请求。
- 校验被调用方能力、权限、上下文预算、深度、并发和循环风险。
- 对自定义角色读取 `delegationPolicy`、`intakePolicy`、项目策略和审批状态，
  用确定性规则判断调用权。
- 创建 `RoleCall`、`RoleCallEvent` 和必要的 `RoleTodo`。
- 为每次调用构建紧凑 `RoleCallContext`，而不是传整条 thread。
- 启动被调用角色的接单判断。
- 根据接单判断执行、搁置、拒绝、请求上下文或请求审批。
- 对可执行调用启动本地 TaskRunner 或其他本地执行器。
- 校验 `RoleResult` schema。
- 把 decision/result/todo 事件注入调用方后续上下文。
- 保持 SQLite 审计记录和 UI 调用图一致。

Orchestrator 固定的是判定算法，不固定具体角色关系。判断一个角色是否可以调用
另一个角色时，它必须依次检查：

1. caller role 存在、启用，且不处于 blocked/cancelled 状态。
2. callee role 存在、启用，并声明可以接受 RoleCall。
3. caller 的 `delegationPolicy.canInitiateRoleCalls` 为 true。
4. caller 允许当前 intent 类型，例如 `delegate`、`request_review` 或
   `request_evidence`。
5. caller 的 `allowedTargetRoles` 直接包含 callee，或
   `allowedTargetCapabilities` 能匹配 callee 的能力。
6. callee 的 `intakePolicy` 接受 caller role、caller capability 和当前 intent 类型。
7. 请求权限没有超过项目策略、caller 权限、callee 权限和执行器可提供的能力。
8. depth、并发、每轮新增调用数、循环检测、重复任务和 todo 容量均通过。
9. 目标或权限命中 `requiresApprovalForTargets` 或项目审批规则时，RoleCall 进入
   `waiting_approval`，而不是直接执行。
10. 即使策略允许，callee 仍可在接单阶段返回 accepted、rejected、deferred、
    needs_context 或 needs_approval。

例如用户自定义 `@qa` 能否调用 `@analyst`，不由 Orchestrator 猜测，而由双向策略决定：

```ts
const qaRole = {
  handle: "qa",
  capabilities: ["test_planning", "regression_detection"],
  delegationPolicy: {
    canInitiateRoleCalls: true,
    allowedIntentTypes: ["request_analysis", "request_review"],
    allowedTargetCapabilities: ["analysis", "review"]
  }
};

const analystRole = {
  handle: "analyst",
  capabilities: ["analysis", "planning"],
  intakePolicy: {
    acceptsRoleCalls: true,
    acceptedIntentTypes: ["request_analysis", "delegate"],
    acceptedCallerCapabilities: ["test_planning", "implementation", "review"],
    canReject: true,
    canDefer: true
  }
};
```

在这个例子里，`@qa -> @analyst` 的 `request_analysis` 可以成立，因为 caller
允许发起该 intent，目标能力匹配 `analysis`，且 analyst 接受具备 `test_planning`
能力的 caller。若新建 `@random` 没有显式 delegation policy，它默认不能调用
`@analyst`；用户必须在角色配置里授予调用能力，或在具体 RoleCall 上批准。

## 动态协作图

系统生成的是 RoleCall DAG，而不是固定 workflow 模板。

```text
RoleCallGraph
├─ nodes: RoleCall[]
├─ edges: caller -> callee
├─ todos: RoleTodo[]
├─ events: RoleCallEvent[]
└─ policies: RoleExecutionPolicy[]
```

允许动态扩展：

- analyst 可以把调查交给 operator。
- operator 可以请求 reviewer 审查补丁。
- reviewer 可以请求 operator 补充证据。
- engineer 可以请求 reviewer 进行风险检查。
- memory 角色可以提出记忆候选，但不能自动批准。

限制不是固定流程，而是策略：

- 调用深度上限。
- 每轮新增调用数上限。
- 并发上限。
- 角色能力图。
- 读写权限。
- shell、网络、文件写入、外部副作用审批。
- 危险命令阻断。
- 重复任务去重。
- role todo 容量和阻塞状态。

## 权限与策略

权限需要同时进入 prompt、执行器约束和 Orchestrator 策略。Agent Hub 不能只靠
prompt 声明权限。

```ts
interface PermissionSet {
  canReadFiles: boolean;
  canEditFiles: boolean;
  canRunCommands: boolean;
  canUseNetwork: boolean;
  canAskUser: boolean;
  requiresApprovalForShell: boolean;
  requiresApprovalForFileWrite: boolean;
  allowedCommandPatterns?: string[];
  deniedCommandPatterns?: string[];
}

interface RoleExecutionPolicy {
  maxDepth: number;
  maxSubtasksPerTurn: number;
  maxConcurrentRoleCalls: number;
  maxContextTokensPerRoleCall: number;
  requireStructuredResult: boolean;
  requireEvidenceForResult: boolean;
  requireApprovalForFileWrite: boolean;
  requireApprovalForDangerousShell: boolean;
  blockDangerousCommands: boolean;
  allowedDelegations: Record<string, string[]>;
  defaultUserDefinedRoleTrustLevel: RoleTrustLevel;
}
```

`RoleExecutionPolicy.allowedDelegations` 是项目级上限或兼容性配置，不应取代
`RoleDefinition.delegationPolicy` 和 `RoleDefinition.intakePolicy`。最终判定必须同时满足
项目上限、caller 发起策略、callee 接单策略和当前审批状态。

危险命令至少包括：

- `rm -rf`
- `sudo`
- `chmod -R`
- `curl | sh`
- `wget | sh`
- `git push`
- `git reset --hard`
- `docker system prune`

这些检查应复用 Agent Hub 现有 safety scanner，并扩展缺失规则，而不是复制一套
独立实现。

## Parser 规则

行首 mention 是 UI 语法，不是内部调用协议。

支持：

```text
@operator run tests and report failures
@reviewer review the patch for regression risks
```

要求：

- 只检测行首 mention。
- 忽略代码块中的 mention。
- 忽略未知 role，或作为非阻断 validation warning。
- 解析结果是 `RoleIntent`，不是直接执行。
- 不复用普通 composer mention fan-out parser。

## 上下文治理

每次 RoleCall 都得到独立紧凑上下文：

```ts
interface RoleCallContext {
  userGoal: string;
  currentPlan?: string;
  relevantFiles?: string[];
  recentFindings?: string[];
  constraints?: string[];
  previousRoleResults?: RoleResult[];
  callerTodoState?: RoleTodo[];
  calleeTodoState?: RoleTodo[];
  repoState?: {
    branch?: string;
    changedFiles?: string[];
    testStatus?: string;
  };
  tokenBudget?: number;
}
```

上下文要求：

- 不把整条 thread 原样传给每个角色。
- 明确注入调用方目标、任务、约束、相关结果和 todo 状态。
- reviewer 默认读结果、diff、风险、测试证据，不修改文件。
- operator 默认不直接问用户，除非权限允许并由 Orchestrator 转为审批或上下文请求。
- approved memory 不因 RoleCall 自动更新。

## UI 要求

UI 应提供两层视图：

1. 用户默认视图：清晰最终回答、当前协作状态、需要用户审批的事项。主对话页面必须
   保持清爽简明，不默认展示 RoleCall DAG、完整 todo 列表、事件流、命令输出、
   文件列表、风险明细或原始证据。
2. 审计视图：RoleCall 图、RoleTodo 列表、事件、证据、命令、文件、风险、错误。

主对话只应透出少量折叠入口，例如 `3 role calls · 1 deferred · review needed`、
`Open role graph` 或 `View delegation details`。RoleCall DAG、RoleTodoPanel、
RoleCallEvent、RoleResult 原始 JSON、命令记录和文件/风险证据必须默认折叠在
inspector、drawer、modal 或详情页中。用户展开前，主 transcript 应优先显示人类可读的
最终总结、阻塞审批和少量状态 chip。

RoleCallCard 显示：

- callerRole -> calleeRole
- task
- status
- decision/disposition
- refusal/defer reason
- linked todo
- permissions summary
- result summary
- evidence
- commands run
- files touched
- risks
- error
- retry/cancel/approve placeholders

RoleTodoPanel 显示：

- 每个 role 的 open/in_progress/deferred/blocked/done/rejected 任务。
- 每个 todo 关联的 RoleCall、事件和结果。
- deferred todo 的恢复条件。
- caller 是否已感知 callee 的搁置或拒绝。

## 本地优先边界

所有执行保持 Agent Hub 现有边界：

- SQLite 本地持久化。
- TaskRunner 本地执行。
- git worktree 隔离。
- 桌面 renderer sandboxed。
- privileged 操作经 Electron main-process IPC。
- 不自动 merge、push、创建 PR、批准 memory 或导出 repo context。
- 不读取或暴露 `.env`、私钥、token、credential 文件。

## 验收标准

- role 输出的行首 `@operator`、`@reviewer` 可以生成结构化 RoleIntent。
- 代码块内 mention 不会生成 RoleIntent。
- Orchestrator 把合法 RoleIntent 转为 RoleCall，并持久化。
- RoleCall 可以被 callee 接受、拒绝、搁置、请求上下文或请求审批。
- 拒绝和搁置事件会被 caller 感知并进入后续上下文。
- 每个 role 有独立 RoleTodo 列表。
- deferred RoleCall 会创建或更新 callee 的 deferred todo。
- succeeded/cancelled/rejected RoleCall 会更新相关 todo 状态。
- RoleCallGraph 不允许无限递归或循环调用。
- policy 强制执行深度、并发、每轮调用数、权限和危险命令规则。
- operator/reviewer 必须返回结构化 RoleResult，schema 不合法时调用失败且可审计。
- UI 能展示 RoleCallCard、RoleTodoPanel 和调用图。
- 所有执行仍通过本地 TaskRunner、SQLite、safety、context compiler 和 IPC 边界。
