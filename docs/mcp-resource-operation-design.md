# CRM MCP 资源操作全盘落地方案

## 1. 背景与目标

MCP 不是单一“创建事项”能力，而是 CRM 面向大模型和智能助手的统一资源操作层。它需要一次性覆盖需求、事项、任务、Bug 等核心资源的查询、创建、更新、关联、流转和审计，让 AI 客户端可以在受控边界内完成真实业务操作。

MCP 在来源体系中的定位需要拆开表达：

- MCP 是创建来源、操作入口和接入来源之一。
- MCP client 是具体调用方，例如 Codex、ChatGPT、内部助手或自动化服务。
- actor 是真实 CRM 用户或受限 service account。
- upstream 是业务上下文来源，例如 Notion、Jira、钉钉、企业微信、邮件、文档、用户当前对话或人工录入。
- evidence 是可展示、可审计的证据摘要。
- modelInference 是 AI 的判断和建议，不能伪装成事实来源。

全盘落地目标：

- 对需求、事项、任务、Bug 提供统一 MCP 工具集。
- 所有读写操作必须复用现有 CRM API、权限、工作流、审计和时间线。
- 所有写操作必须具备幂等、风险评估、必要确认和可追踪审计。
- 前端能在对应资源详情页展示 MCP 操作来源、业务上下文来源和证据摘要。
- 管理员可以按 MCP client、资源类型和操作类型治理写权限。

非目标：

- 不允许 MCP Server 直接写数据库。
- 不允许模型绕过 CRM 组织、空间、对象、工作流和字段权限。
- 不保存完整 prompt、完整私密对话或大段未脱敏原文。
- 不把 MCP 等同于唯一业务来源，也不把 upstream 覆盖为 MCP。
- 不默认开放删除、归档、关闭、拒绝、批量流转等高风险能力。
- 不在 MCP 层重写一套独立业务规则。

## 2. 核心原则

### 2.1 MCP 是统一操作入口

MCP 要覆盖核心资源操作，不以事项作为首个场景或试点能力。工程实现可以按依赖顺序推进，但产品验收口径必须是需求、事项、任务、Bug 的能力同时闭环。

### 2.2 API 是最终业务裁决点

MCP Server 只负责协议、工具 schema、输入基础校验、用户授权上下文注入和 CRM API 调用。最终权限、字段合法性、状态机、事务、审计和落库都由 CRM API 完成。

推荐架构：

```text
AI 客户端（Codex / ChatGPT / 内部助手 / 自动化服务）
  -> CRM MCP Server
    -> CRM API MCP 内部接口
      -> Resource Operation Adapter
        -> RequirementService / IntakeService / WorkItemService / BugService
        -> AuditLog
        -> TimelineEvent
        -> ExternalSourceBinding
        -> RealtimeEvent
```

### 2.3 通用协议，资源专属规则

工具命名、操作上下文、确认策略、幂等、审计和错误结构保持统一；需求、事项、任务、Bug 的字段、状态、关联和高风险判断保留资源专属规则。

### 2.4 读工具可先宽，写工具必须受控

读工具仍需遵守 CRM 权限，但可以覆盖较多查询能力。写工具必须逐项经过风险策略、确认策略和 MCP client policy，不因为存在工具 schema 就默认允许所有 client 使用。

### 2.5 上下文分层记录

所有 MCP 写操作都记录统一操作元信息。业务来源、证据和模型推断必须分层，不混写成一个不可解释 JSON。

```text
operationSource = MCP
client = codex / chatgpt / internal-assistant
actorUserId = CRM 当前用户
upstream = 业务上下文来源
evidence = 可展示证据
modelInference = AI 判断
```

## 3. 资源范围

### 3.1 核心资源

| 资源 | 现有模型 | 查询能力 | 写操作能力 | 高风险操作 |
| --- | --- | --- | --- | --- |
| 需求 | `Requirement` | 列表、详情、按版本/负责人/状态筛选、关联工作项 | 创建草稿、保存、更新、归档、关联任务/Bug | 归档、大段内容改写、负责人变更、优先级提升、版本迁移 |
| 事项 | `IntakeItem` | 列表、详情、相似事项、按来源/状态筛选 | 创建、更新、接收、延后、拒绝、转任务 | 拒绝、接收、转任务、指定负责人、紧急优先级、批量处理 |
| 任务 | `WorkItem(type=TASK)` | 列表、详情、按版本/需求/负责人/状态筛选 | 创建、更新、分配、状态流转、关联需求/事项 | 完成/取消、负责人变更、截止时间变更、批量流转 |
| Bug | `WorkItem(type=BUG)` + `BugDetail` | 列表、详情、按严重级别/关联任务/状态筛选 | 创建、更新、定级、分配、状态流转、关联任务 | 严重级别提升/降低、关闭、回归结论、关联修复任务、批量流转 |

### 3.2 支撑资源

支撑资源用于帮助 AI 选择正确目标，本轮主要提供查询和引用能力，不作为核心写入对象：

- `Organization`：列出用户可访问组织。
- `Space`：列出用户可访问空间。
- `Version`：列出空间版本，用于需求、事项、任务、Bug 关联。
- `Member`：列出空间成员，用于 owner、assignee、reporter 选择。
- `Tag`：列出标签，用于资源标记。
- `Workflow`：列出任务/Bug 可用状态和动作。

## 4. MCP 工具设计

### 4.1 命名约定

工具使用资源分组命名：

```text
crm.<resource>.<action>
```

规则：

- 复数资源名：`requirements`、`intakeItems`、`tasks`、`bugs`。
- 查询动作：`list`、`get`、`search`、`findSimilar`。
- 写入动作：`create`、`update`、`assign`、`transition`、`archive`、`convert`、`link`。
- 高风险写入必须先经过 `crm.operations.preview`。

### 4.2 基础上下文工具

```text
crm.organizations.list
crm.spaces.list
crm.versions.list
crm.members.list
crm.tags.list
crm.workflows.listStates
crm.search
```

### 4.3 通用操作工具

```text
crm.operations.preview
crm.operations.explainPolicy
```

`crm.operations.preview` 用于所有写操作的归一化校验、风险判断、相似/重复检测和 confirmation token 生成。低风险操作可以由资源写工具内部自动 preview，也可以由 AI 显式先调用 preview。

`crm.operations.explainPolicy` 用于 AI 在被拒绝时获取可读原因，避免把底层错误直接暴露给用户。

### 4.4 需求工具

```text
crm.requirements.list
crm.requirements.get
crm.requirements.createDraft
crm.requirements.save
crm.requirements.update
crm.requirements.archive
crm.requirements.linkWorkItem
```

约束：

- `createDraft` 只创建草稿骨架，正文保存走 `save`。
- `save` 写入标题、摘要、正文、版本、负责人、优先级和标签。
- `archive` 必须确认。
- 大段正文改写必须确认，并在 confirmation 摘要中展示变更范围，而不是全文。

### 4.5 事项工具

```text
crm.intakeItems.list
crm.intakeItems.get
crm.intakeItems.findSimilar
crm.intakeItems.create
crm.intakeItems.update
crm.intakeItems.accept
crm.intakeItems.defer
crm.intakeItems.reject
crm.intakeItems.convertToTasks
```

约束：

- `create` 必须支持标准 MCP 操作上下文和业务来源证据。
- `accept`、`reject`、`convertToTasks` 必须确认。
- `convertToTasks` 每次最多建议 10 个任务，超过必须拆批并确认。

### 4.6 任务工具

```text
crm.tasks.list
crm.tasks.get
crm.tasks.create
crm.tasks.update
crm.tasks.assign
crm.tasks.transition
crm.tasks.linkRequirement
crm.tasks.linkIntakeItem
```

约束：

- 任务是 `WorkItem(type=TASK)`。
- `transition` 必须走现有工作流服务校验，不允许 MCP 指定任意状态。
- 关闭、完成、取消、阻塞类状态变化必须确认。

### 4.7 Bug 工具

```text
crm.bugs.list
crm.bugs.get
crm.bugs.create
crm.bugs.update
crm.bugs.triage
crm.bugs.assign
crm.bugs.transition
crm.bugs.linkTask
```

约束：

- Bug 是 `WorkItem(type=BUG)` 加 `BugDetail`。
- `triage` 负责严重级别、优先级、关联需求/版本/任务等定级字段。
- 关闭 Bug、改变严重级别、填写回归结论必须确认。

## 5. 通用协议

### 5.1 操作上下文

MCP Server 负责注入服务端可信字段，MCP client 不得自行传入 `actorUserId` 冒充用户。

```ts
type CrmMcpOperationContext = {
  operationSource: "MCP";
  client: "codex" | "chatgpt" | "internal-assistant" | string;
  tool: string;
  requestId: string;
  actorUserId: string; // 服务端解析，不接受 client 明文指定
  capturedAt: string;
  upstream?: {
    provider:
      | "notion"
      | "jira"
      | "dingtalk"
      | "wecom"
      | "email"
      | "document"
      | "conversation"
      | "manual"
      | "mcp";
    objectType?: string;
    objectId?: string;
    title?: string;
    url?: string;
    externalCreatedAt?: string;
  };
  evidence?: {
    refNo?: string;
    summary: string;
    originalExcerpt?: string;
    excerptHash?: string;
  };
  modelInference?: {
    suggestedResource?: "requirement" | "intake_item" | "task" | "bug";
    suggestedAction?: string;
    suggestedPriority?: string;
    suggestedAssigneeId?: string;
    suggestedOwnerId?: string;
    suggestedVersionId?: string;
    suggestedRequirementId?: string;
    suggestedSeverity?: string;
    reason?: string;
    confidence?: number;
  };
};
```

当业务上下文本身就是当前 MCP 对话时，`upstream.provider` 可以为 `conversation` 或 `mcp`。区别建议如下：

- `conversation`：用户当前对话是业务证据来源。
- `mcp`：仅表达操作入口或自动化上下文，没有额外上游业务对象。

### 5.2 写操作输入包络

```ts
type CrmMcpWriteInput<TPayload> = {
  organizationId: string;
  spaceId: string;
  payload: TPayload;
  context: Omit<CrmMcpOperationContext, "actorUserId">;
  idempotencyKey: string;
  confirmationToken?: string;
};
```

资源工具可以将 `payload` 展开成更友好的 schema，但 API 内部应归一化成该结构处理。

### 5.3 预览输出

```ts
type CrmMcpPreviewResult<TPayload> = {
  allowed: boolean;
  confirmationRequired: boolean;
  confirmationToken?: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
  riskReasons: string[];
  normalizedOperation: {
    resource: "requirement" | "intake_item" | "task" | "bug";
    action: string;
    payload: TPayload;
  };
  duplicate?: {
    resource: string;
    id: string;
    displayCode?: string;
    url: string;
  };
  similarTargets?: Array<{
    resource: string;
    id: string;
    title: string;
    status?: string;
    url: string;
  }>;
  confirmationSummary: string;
};
```

### 5.4 写操作输出

```ts
type CrmMcpWriteResult<TResource> = {
  executed: boolean;
  created?: boolean;
  updated?: boolean;
  resource: TResource;
  url: string;
  duplicatedFrom?: string;
  auditLogId?: string;
  timelineEventId?: string;
};
```

## 6. 数据模型

### 6.1 短期必须写入

所有 MCP 写操作必须至少写入：

- 目标资源表的业务字段。
- `audit_logs.metadata` 中的 MCP 操作上下文。
- `timeline_events.metadata` 中的 MCP 操作摘要。
- 可用于幂等和反查的外部来源绑定。

事项当前已有 `sourceType` 和 `sourceObject`，可以继续用于事项的业务来源展示；需求、任务、Bug 不应为了 MCP 简单复制一套 `sourceObject` 字段，优先通过审计、时间线和外部来源绑定统一承载。

### 6.2 外部来源绑定表

建议引入通用 `external_source_bindings`，不要只服务事项：

```prisma
model ExternalSourceBinding {
  id              String    @id @db.Char(26)
  organizationId  String    @map("organization_id") @db.Char(26)
  spaceId         String    @map("space_id") @db.Char(26)
  provider        String    @db.VarChar(32)
  externalId      String    @map("external_id") @db.VarChar(300)
  targetType      String    @map("target_type") @db.VarChar(40)
  targetSubtype   String?   @map("target_subtype") @db.VarChar(40)
  targetId        String    @map("target_id") @db.Char(26)
  operationSource String    @map("operation_source") @db.VarChar(32)
  client          String?   @db.VarChar(80)
  metadata        Json?
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  deletedAt       DateTime? @map("deleted_at")

  @@index([organizationId])
  @@index([spaceId])
  @@index([targetType, targetId])
  @@index([provider, externalId])
  @@map("external_source_bindings")
}
```

PostgreSQL 未删除唯一约束：

```sql
CREATE UNIQUE INDEX external_source_bindings_active_unique
ON external_source_bindings(provider, external_id, target_type, target_id)
WHERE deleted_at IS NULL;
```

### 6.3 MCP 确认表

高风险操作需要短期 confirmation token。可以落库，也可以使用服务端签名 token；如果需要审计和失效管理，建议落库：

```prisma
model McpOperationConfirmation {
  id             String   @id @db.Char(26)
  actorUserId    String   @map("actor_user_id") @db.Char(26)
  client         String   @db.VarChar(80)
  resource       String   @db.VarChar(40)
  action         String   @db.VarChar(80)
  requestHash    String   @map("request_hash") @db.VarChar(128)
  riskReasons    Json     @map("risk_reasons")
  expiresAt      DateTime @map("expires_at")
  consumedAt     DateTime? @map("consumed_at")
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([actorUserId])
  @@index([client])
  @@map("mcp_operation_confirmations")
}
```

### 6.4 MCP Client Policy

管理员需要能治理 MCP client 写权限：

```text
client
allowedResources
allowedActions
requiresConfirmationOverrides
maxBatchSize
allowServiceAccountDirectWrite
enabled
```

初始工程实现可以先用配置文件或环境变量，正式治理再落表。

## 7. 幂等与去重

幂等键由 MCP Server 生成并由 API 校验。API 不能信任 client 传入的任意键，必须重新规范化并校验格式。

有上游对象：

```text
mcp:<client>:<resource>:<action>:<upstream.provider>:<upstream.objectId>:<refNo|excerptHash>
```

当前对话或无上游对象：

```text
mcp:<client>:<actorUserId>:<resource>:<action>:<normalizedTitle>:<yyyy-mm-dd>
```

状态流转或更新：

```text
mcp:<client>:<resource>:<targetId>:<action>:<requestHash>
```

重复命中规则：

- 创建类操作优先查 `external_source_bindings`。
- 更新/流转类操作优先查操作审计中的 `idempotencyKey`。
- 命中同一幂等键时返回已有资源或已有操作结果，不重复执行。
- 幂等冲突但 payload 不一致时返回 `MCP_IDEMPOTENCY_CONFLICT`。

## 8. 权限模型

MCP 写入必须使用真实 CRM 身份。

通用规则：

- MCP 请求必须解析出 `actorUserId`，该字段不能由 client 明文指定。
- actor 必须是目标组织有效成员。
- actor 必须是目标空间有效成员。
- actor 必须具备目标资源和动作权限。
- `versionId`、`requirementId`、`intakeItemId`、`assigneeId`、`ownerId` 必须属于目标空间或可访问范围。
- `VIEWER` 不能通过 MCP 创建或修改业务资源。
- service account 默认只能创建待确认草稿或待确认事项，不能直接分配负责人、关闭资源或批量流转。

认证方式：

- 本地 Codex / ChatGPT 插件：OAuth 或短期 delegated user token。
- 内部助手：服务端 session + delegated user token。
- 自动化服务：service account + 审批策略 + 强制确认队列。

## 9. 风险与确认策略

### 9.1 可直接执行

满足全部条件时可直接执行：

- 用户明确表达具体操作。
- 目标组织、空间和资源明确。
- payload 只包含低风险字段。
- 非批量。
- 无相似/重复冲突。
- 不自动分配负责人、owner 或改变高风险状态。
- 不设置 `URGENT` 或高严重级别。
- 模型置信度高于阈值，例如 `0.75`。
- MCP client policy 允许直接执行该动作。

### 9.2 必须确认

任一条件命中时必须确认：

- 批量操作。
- 自动指定负责人、owner、版本、需求、关联任务。
- 自动设置 `URGENT`、严重级别或业务优先级。
- 需求大段正文改写或归档。
- 事项接收、拒绝、转任务。
- 任务/Bug 状态流转到完成、关闭、取消、拒绝、阻塞。
- Bug 严重级别改变、关闭或写入回归结论。
- 来源证据缺失或只来自模型推断。
- 相似资源已存在。
- 置信度低于阈值。
- 用户表达含糊，例如“可能需要记一下”。

### 9.3 阻断执行

以下情况直接阻断，不进入确认：

- actor 无权限。
- MCP client 被禁用或未授权该资源动作。
- 请求引用了跨空间或不可访问对象。
- 请求试图传入 `actorUserId` 冒充用户。
- payload 包含 token、cookie、secret 或大段未脱敏隐私内容。
- 操作不符合资源状态机，例如从不可关闭状态直接关闭。

### 9.4 confirmation token

确认流程：

1. AI 调用 `crm.operations.preview` 或资源写工具内部 preview。
2. 后端返回风险原因、确认摘要和 `confirmationToken`。
3. AI 向用户展示摘要。
4. 用户明确确认。
5. AI 调用资源写工具并携带 `confirmationToken`。
6. 后端校验 token 未过期、未消费、actor/client/resource/action 一致、请求 hash 未变化。

建议有效期 10 分钟。

## 10. 后端模块设计

API 侧新增 MCP 模块，但业务动作落到各资源服务：

```text
apps/api/src/modules/mcp/
  mcp.module.ts
  mcp-operation.controller.ts
  mcp-operation.service.ts
  mcp-auth.service.ts
  mcp-client-policy.service.ts
  mcp-confirmation.service.ts
  mcp-context-normalizer.ts
  mcp-idempotency.service.ts
  mcp-risk-policy.ts
  adapters/
    mcp-requirement.adapter.ts
    mcp-intake-item.adapter.ts
    mcp-task.adapter.ts
    mcp-bug.adapter.ts

apps/api/src/modules/integration/
  external-source-binding.repository.ts
```

内部接口建议：

```http
POST /api/v1/mcp/operations/preview
POST /api/v1/mcp/requirements/drafts
PATCH /api/v1/mcp/requirements/{requirementId}
POST /api/v1/mcp/intake-items
PATCH /api/v1/mcp/intake-items/{intakeItemId}
POST /api/v1/mcp/tasks
PATCH /api/v1/mcp/tasks/{taskId}
POST /api/v1/mcp/tasks/{taskId}/transition
POST /api/v1/mcp/bugs
PATCH /api/v1/mcp/bugs/{bugId}
POST /api/v1/mcp/bugs/{bugId}/transition
```

`McpOperationService` 职责：

- 标准化操作上下文。
- 解析 actor 和 MCP client。
- 调用 client policy。
- 调用资源 adapter 做归一化和领域校验。
- 计算幂等键和 request hash。
- 调用风险策略和 confirmation 服务。
- 执行资源写操作。
- 写外部来源绑定、审计、时间线和实时失效事件。

资源 adapter 职责：

- 将 MCP payload 映射到现有共享 contract。
- 调用对应领域服务。
- 识别资源专属风险。
- 生成用户可读确认摘要。
- 返回资源 URL 和展示编码。

## 11. MCP Server 设计

MCP Server 建议独立部署：

```text
apps/mcp/
```

或独立包：

```text
packages/mcp-server/
```

MCP Server 职责：

- 暴露 MCP 工具 schema。
- 校验输入基础类型和必填字段。
- 获取并注入 delegated token。
- 生成 requestId。
- 生成初始 idempotencyKey。
- 调用 CRM API。
- 将 CRM 错误映射为 MCP tool result。

MCP Server 不负责：

- 最终权限裁决。
- 数据库事务。
- 状态机判定。
- 审计落库。
- 业务规则绕过。

## 12. 前端展示

所有核心资源详情页增加“来源与操作记录”区块：

- 创建入口：MCP / Web / 钉钉 / API / 手工。
- MCP client：Codex / ChatGPT / 内部助手。
- 操作人：真实 CRM 用户。
- 业务上下文来源：Notion / Jira / 钉钉 / 用户对话 / 文档 / MCP。
- 来源标题、编号、链接。
- 证据摘要。
- AI 判断：建议资源、建议动作、优先级、严重级别、负责人、判断理由和置信度。
- 最近一次 MCP 操作及审计链接。

展示要求：

- 普通用户不直接看到原始 JSON。
- 开发调试模式可以折叠展示原始 metadata。
- 手工创建表单不要求用户填写 JSON。
- MCP 创建或修改的机器字段默认只读，允许用户补充说明，但不允许直接篡改 MCP 元信息。
- 列表页支持筛选“由 MCP 创建/更新”和 MCP client。

## 13. 审计与安全

### 13.1 必须记录

- actorUserId
- organizationId
- spaceId
- MCP client
- MCP tool
- requestId
- idempotencyKey hash
- resource
- action
- targetId
- upstream provider
- upstream objectId
- evidence refNo / excerptHash
- 是否经过用户确认
- riskLevel
- riskReasons
- 执行结果

### 13.2 禁止记录

- 完整 prompt。
- access token、refresh token、cookie、secret。
- 大段未脱敏原文全文。
- 未经授权的私密对话全文。
- 含个人敏感信息的附件原文。

### 13.3 内容限制

- `evidence.summary` 建议不超过 500 字。
- `evidence.originalExcerpt` 建议不超过 1000 字。
- 单次 MCP metadata 建议不超过 8KB。
- 超长内容应改存附件、外部 URL 或脱敏摘要。

### 13.4 审计 metadata 示例

```json
{
  "operation": "MCP_RESOURCE_OPERATION",
  "client": "codex",
  "tool": "crm.bugs.triage",
  "requestId": "req_01H...",
  "resource": "bug",
  "action": "triage",
  "targetId": "01H...",
  "idempotencyKeyHash": "sha256:...",
  "upstreamProvider": "conversation",
  "confirmationRequired": true,
  "riskLevel": "HIGH",
  "riskReasons": ["SEVERITY_INFERRED", "ASSIGNEE_INFERRED"]
}
```

## 14. 错误处理

建议错误码：

- `MCP_AUTH_REQUIRED`
- `MCP_CLIENT_NOT_ALLOWED`
- `MCP_RESOURCE_NOT_ALLOWED`
- `MCP_ACTION_NOT_ALLOWED`
- `MCP_CONTEXT_INVALID`
- `MCP_EVIDENCE_REQUIRED`
- `MCP_CONFIRMATION_REQUIRED`
- `MCP_CONFIRMATION_INVALID`
- `MCP_IDEMPOTENCY_CONFLICT`
- `MCP_DUPLICATE_RESOURCE_EXISTS`
- `MCP_SIMILAR_RESOURCE_EXISTS`
- `MCP_PERMISSION_DENIED`
- `MCP_WORKFLOW_TRANSITION_INVALID`
- `MCP_REFERENCE_INVALID`
- `MCP_PAYLOAD_TOO_LARGE`

错误返回必须能被 AI 转成用户可读提示：

```text
你没有在该空间创建 Bug 的权限。
```

```text
这个操作会关闭任务，需要你确认后我才能继续。
```

```text
我找到一个相似需求，建议确认是否复用或继续创建。
```

## 15. 测试策略

后端单测：

- MCP 操作上下文 schema 校验。
- actor 解析和 client policy。
- 幂等键生成和冲突检测。
- confirmation token 生成、过期、消费和 request hash 校验。
- 通用风险策略。
- 资源 adapter 的 payload 映射。
- 权限拒绝和跨空间引用拒绝。

后端集成测试：

- 需求创建草稿、保存、归档确认。
- 事项创建、更新、接收/拒绝/转任务确认。
- 任务创建、分配、状态流转确认。
- Bug 创建、定级、分配、关闭确认。
- 重复 idempotencyKey 不重复执行。
- 无权限用户无法读写。
- 非法上下文和超大 evidence 被拒绝。
- 审计、时间线、外部来源绑定、实时事件完整写入。

MCP Server 测试：

- 所有工具 schema 正确。
- delegated token 缺失时拒绝写操作。
- CRM API 错误能映射为 tool result。
- requestId 和 idempotencyKey 生成稳定。

前端测试：

- 需求、事项、任务、Bug 详情展示 MCP 来源和操作信息。
- 不直接展示原始 JSON。
- 列表能筛选 MCP 创建/更新资源。
- 高风险操作确认摘要可读。

端到端测试：

- 模拟 AI tool call 分别创建需求、事项、任务、Bug。
- 模拟 AI tool call 修改和流转任务/Bug。
- 检查资源、审计、时间线、外部来源绑定和实时刷新。
- 重复调用返回已有资源或已有操作结果。

## 16. 运维与观测

指标：

- `mcp_tool_calls_total`
- `mcp_tool_calls_failed_total`
- `mcp_resource_operations_total`
- `mcp_resource_operations_blocked_total`
- `mcp_confirmation_required_total`
- `mcp_idempotency_hit_total`
- `mcp_permission_denied_total`
- `mcp_client_policy_denied_total`

日志字段：

- requestId
- actorUserId
- client
- tool
- resource
- action
- organizationId
- spaceId
- targetId
- idempotencyKey hash
- result
- latencyMs

日志必须脱敏，不能记录完整 source metadata 原文。

## 17. 工程落地顺序

这里的顺序是工程依赖顺序，不是产品分期。最终验收必须覆盖需求、事项、任务、Bug。

1. 建立共享 MCP 操作 contract：上下文、preview、write result、错误码。
2. 新增 API MCP 模块：auth、client policy、confirmation、idempotency、risk policy。
3. 新增或改造外部来源绑定、审计 metadata、时间线 metadata。
4. 实现四类资源 adapter：需求、事项、任务、Bug。
5. 暴露 MCP Server 全量工具 schema。
6. 前端四类资源详情页统一展示“来源与操作记录”。
7. 补齐单测、集成测试、MCP Server 测试和 E2E。
8. 管理员配置 MCP client 写权限和高风险确认策略。

## 18. 验收标准

功能验收：

- 用户可通过 MCP 查询需求、事项、任务、Bug。
- 用户可通过 MCP 创建需求、事项、任务、Bug。
- 用户可通过 MCP 更新、关联和流转允许范围内的资源。
- 高风险操作必须先确认。
- 无权限用户不能通过 MCP 读写资源。
- 同一上游来源或幂等键重复调用不会重复创建或重复执行。
- 四类资源详情页都能看到 MCP 操作来源、业务上下文来源和证据摘要。
- 审计能追踪用户、MCP client、工具、上游来源、风险原因和执行结果。

安全验收：

- MCP Server 不直接访问数据库。
- client 不能伪造 actorUserId。
- service account 不能绕过人工确认策略。
- prompt、token、cookie、secret 不进入审计或日志。
- 跨组织、跨空间、跨权限对象引用被拒绝。

治理验收：

- 管理员可关闭某个 MCP client。
- 管理员可限制某个 MCP client 的资源和动作。
- 可按 client、资源、动作统计成功率、失败率、确认率和重复率。

## 19. 关键取舍

- MCP 是 CRM 的智能资源操作入口，不是事项创建的附属能力。
- MCP 本身是创建/操作来源，但业务上下文来源仍需通过 upstream 单独表达。
- 统一 MCP 协议不等于统一所有资源字段；资源专属规则必须留在 adapter 和领域服务中。
- 写操作优先复用现有服务和工作流，不产生第二套业务状态机。
- 幂等和外部来源绑定必须通用化，否则需求、任务、Bug 会重复踩事项方案的问题。
- 前端展示要面向用户可读，不把 JSON 当产品界面。

## 20. 待评审问题

- MCP Server 独立部署还是内置到 API 服务。
- 外部来源绑定表是否立即落库，还是先写 audit/timeline metadata 过渡。
- delegated token / OAuth 的具体实现方式。
- MCP client policy 一期用配置还是落表。
- 需求正文的 AI 改写如何展示 diff 和确认摘要。
- 任务/Bug 工作流动作如何暴露给 MCP：按状态 ID 还是按动作语义。
- service account 是否允许创建待确认需求草稿、事项、任务和 Bug。
- 是否同步改造所有资源详情页的来源与操作记录展示。
