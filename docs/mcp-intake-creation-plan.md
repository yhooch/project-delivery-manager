# MCP/大模型创建事项落地方案

## 1. 背景与定位

事项池当前通过 `sourceType` 表达来源分类，通过 `sourceObject` 保存来源上下文。这个设计不适合让普通用户手写 JSON，但非常适合承接系统集成和智能采集入口。

MCP/大模型创建事项的定位是：大模型作为“智能采集与创建通道”，通过受控 MCP 工具调用 CRM 后端创建事项；真实业务来源仍然需要记录为 Notion、Jira、钉钉、企业微信、文档、邮件、聊天记录或用户当前对话。

核心原则：

- MCP 是写入通道，不等于真实来源。
- `upstream` 记录事实来源。
- `evidence` 记录可展示的证据摘要。
- `modelInference` 记录 AI 判断，不能和事实来源混在一起。
- MCP 创建事项必须复用现有 CRM 权限、审计、时间线和事项服务。

## 2. 一期目标与非目标

一期目标：

- 用户可在 AI 对话中明确要求创建事项。
- 大模型通过 CRM MCP Server 调用后端创建事项。
- 系统自动写入标准化 `sourceObject`。
- 事项详情可读展示 AI/MCP 来源和真实上游来源。
- 后端支持用户身份、权限校验、幂等去重和审计。
- 批量创建、高风险字段和低置信度推断必须先确认。

非一期目标：

- 不让 MCP 直接写数据库。
- 不保存完整 prompt 或整篇原始文档。
- 不允许模型绕过 CRM 组织/空间/对象权限。
- 不把模型推理结果伪装成事实来源。
- 不在一期实现所有外部系统双向回写。

## 3. 总体架构

推荐架构：

```text
AI 客户端（Codex / ChatGPT / 内部助手）
  -> CRM MCP Server
    -> CRM API / MCP 内部接口
      -> IntakeService.create
        -> Prisma / DB
        -> AuditLog
        -> TimelineEvent
        -> ExternalSourceBinding
```

CRM MCP Server 负责：

- 暴露 MCP 工具。
- 做输入 schema 校验。
- 解析当前用户身份。
- 做权限前置检查或调用后端检查。
- 生成确认摘要。
- 调用 CRM API 创建事项。
- 返回事项 ID、URL 和幂等结果。

CRM API 负责：

- 最终权限裁决。
- 数据一致性校验。
- 调用现有 `IntakeService.create`。
- 写审计、时间线和外部来源绑定。

禁止 MCP Server 直接访问数据库创建业务对象。

## 4. MCP 工具清单

### 4.1 一期必需工具

```text
crm.listOrganizations
crm.listSpaces
crm.listVersions
crm.listRequirements
crm.listSpaceMembers
crm.findSimilarIntakeItems
crm.previewIntakeItem
crm.createIntakeItem
crm.getIntakeItem
```

### 4.2 后续工具

```text
crm.updateIntakeItem
crm.acceptIntakeItem
crm.deferIntakeItem
crm.rejectIntakeItem
crm.convertIntakeItemToWorkItems
crm.listSourceBindings
```

后续写工具必须单独评审，尤其是状态流转和拆解任务，不能默认开放给所有 MCP client。

## 5. 工具协议

### 5.1 `crm.previewIntakeItem`

用途：由 MCP Server 或 CRM API 先校验 AI 准备创建的事项，返回风险级别、确认摘要、相似事项和确认 token。

输入：

```ts
type PreviewIntakeItemInput = {
  organizationId: string;
  spaceId: string;
  title: string;
  description?: string;
  sourceType: IntakeSourceType;
  sourceObject: McpIntakeSourceObject;
  priority?: Priority;
  versionId?: string;
  requirementId?: string;
  assigneeId?: string;
  idempotencyKey: string;
};
```

输出：

```ts
type PreviewIntakeItemResult = {
  allowed: boolean;
  confirmationRequired: boolean;
  confirmationToken?: string;
  riskReasons: string[];
  normalizedRequest: CreateIntakeItemRequest;
  similarItems: Array<{
    id: string;
    title: string;
    status: IntakeStatus;
    url: string;
  }>;
  duplicate?: {
    intakeItemId: string;
    url: string;
  };
};
```

### 5.2 `crm.createIntakeItem`

用途：执行创建。低风险请求可直接创建；高风险请求必须携带 `confirmationToken`。

输入：

```ts
type CreateMcpIntakeItemInput = {
  organizationId: string;
  spaceId: string;
  title: string;
  description?: string;
  sourceType: IntakeSourceType;
  sourceObject: McpIntakeSourceObject;
  priority?: Priority;
  versionId?: string;
  requirementId?: string;
  assigneeId?: string;
  idempotencyKey: string;
  confirmationToken?: string;
};
```

输出：

```ts
type CreateMcpIntakeItemResult = {
  created: boolean;
  intakeItemId: string;
  title: string;
  url: string;
  duplicatedFrom?: string;
};
```

## 6. 标准 `sourceObject`

MCP 创建事项必须使用统一结构：

```ts
type McpIntakeSourceObject = {
  provider: "mcp";
  client: string;
  tool: "crm.createIntakeItem";
  requestId: string;
  upstream?: {
    provider:
      | "notion"
      | "jira"
      | "dingtalk"
      | "wecom"
      | "email"
      | "document"
      | "conversation"
      | "manual";
    objectType?: string;
    objectId?: string;
    title?: string;
    url?: string;
    externalCreatedAt?: string;
  };
  evidence: {
    refNo?: string;
    summary: string;
    originalExcerpt?: string;
    excerptHash?: string;
  };
  modelInference?: {
    selectedSourceType?: IntakeSourceType;
    suggestedPriority?: Priority;
    suggestedAssigneeId?: string;
    suggestedVersionId?: string;
    suggestedRequirementId?: string;
    reason?: string;
    confidence?: number;
  };
  capturedAt: string;
};
```

字段说明：

- `provider = "mcp"`：表示创建通道。
- `client`：调用方，例如 `codex`、`chatgpt`、`internal-assistant`。
- `requestId`：MCP 请求 ID，用于排障和审计。
- `upstream`：真实上游来源。
- `evidence.summary`：用户可读证据摘要。
- `evidence.originalExcerpt`：可选原文摘录，必须限长。
- `modelInference`：AI 的推断和建议，不是事实来源。
- `capturedAt`：AI 捕获来源的时间。

### 6.1 示例：Notion 会议决议

```json
{
  "provider": "mcp",
  "client": "codex",
  "tool": "crm.createIntakeItem",
  "requestId": "req_01H...",
  "upstream": {
    "provider": "notion",
    "objectType": "page",
    "objectId": "35d313...",
    "title": "CRM MVP 周会",
    "url": "https://notion.so/..."
  },
  "evidence": {
    "refNo": "D-03",
    "summary": "会议决定支持客户资料批量导入",
    "originalExcerpt": "D-03：客户资料需要支持 CSV/Excel 批量导入。"
  },
  "modelInference": {
    "selectedSourceType": "MEETING_DECISION",
    "suggestedPriority": "HIGH",
    "reason": "会议明确形成执行决议",
    "confidence": 0.82
  },
  "capturedAt": "2026-05-19T10:00:00.000Z"
}
```

### 6.2 示例：用户当前对话

```json
{
  "provider": "mcp",
  "client": "chatgpt",
  "tool": "crm.createIntakeItem",
  "requestId": "req_01J...",
  "upstream": {
    "provider": "conversation",
    "objectType": "chat_thread",
    "title": "用户当前对话"
  },
  "evidence": {
    "summary": "用户明确要求记录客户A导入模板字段不一致问题",
    "originalExcerpt": "帮我把客户A导入模板字段不一致这个问题创建成事项"
  },
  "modelInference": {
    "selectedSourceType": "EXTERNAL_COLLABORATION",
    "suggestedPriority": "MEDIUM",
    "confidence": 0.76
  },
  "capturedAt": "2026-05-19T10:00:00.000Z"
}
```

## 7. 数据模型

### 7.1 短期方案

一期可以只写入：

- `intake_items.source_type`
- `intake_items.source_object`
- `audit_logs.metadata`
- `timeline_events.metadata`

但这不足以可靠去重和反查。

### 7.2 推荐新增外部来源绑定表

正式落地建议新增 `external_source_bindings`：

```prisma
model ExternalSourceBinding {
  id             String    @id @db.Char(26)
  organizationId String    @map("organization_id") @db.Char(26)
  spaceId        String    @map("space_id") @db.Char(26)
  provider       String    @db.VarChar(32)
  externalId     String    @map("external_id") @db.VarChar(300)
  targetType     String    @map("target_type") @db.VarChar(40)
  targetId       String    @map("target_id") @db.Char(26)
  metadata       Json?
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  deletedAt      DateTime? @map("deleted_at")

  @@index([organizationId])
  @@index([spaceId])
  @@index([targetType, targetId])
  @@map("external_source_bindings")
}
```

PostgreSQL 未删除唯一约束使用部分唯一索引：

```sql
CREATE UNIQUE INDEX external_source_bindings_active_unique
ON external_source_bindings(provider, external_id)
WHERE deleted_at IS NULL;
```

### 7.3 幂等键

有上游对象：

```text
mcp:<client>:<upstream.provider>:<upstream.objectId>:<evidence.refNo>
```

无上游对象：

```text
mcp:<client>:<actorUserId>:<normalizedTitle>:<yyyy-mm-dd>
```

如果 AI 能提供 `excerptHash`，可加入幂等键：

```text
mcp:<client>:<upstream.provider>:<upstream.objectId>:<excerptHash>
```

## 8. 权限模型

MCP 写入必须使用真实 CRM 用户身份。

必需规则：

- MCP 请求必须解析出 `actorUserId`。
- actor 必须是目标组织有效成员。
- actor 必须是目标空间有效成员。
- actor 必须具备创建事项权限。
- `versionId` 必须属于目标空间。
- `requirementId` 必须属于目标空间。
- `assigneeId` 必须是目标空间有效成员。
- `VIEWER` 不能通过 MCP 创建事项。
- MCP client 不得传任意 `userId` 冒充用户。

认证方式建议：

- 本地 Codex / ChatGPT 插件：OAuth 或短期用户授权 token。
- 内部助手：服务端 session + delegated user token。
- 自动化任务：service account 只能创建“待确认事项”，不能直接指定负责人、紧急优先级或拆解任务。

## 9. 确认策略

### 9.1 可直接创建

满足全部条件时可直接创建：

- 用户明确说“创建事项”。
- 目标空间明确。
- 标题明确。
- 只设置标题、描述、来源类型和来源证据。
- 不指定负责人。
- 不设置 `URGENT`。
- 非批量。
- 没有相似事项命中。
- 模型置信度高于阈值，例如 `0.75`。

### 9.2 必须确认

任一条件命中时必须确认：

- 批量创建。
- 自动设置 `URGENT`。
- 自动指定负责人。
- 自动关联版本或需求。
- 来源证据缺失或只来自模型推断。
- 相似事项已存在。
- 置信度低于阈值。
- 用户表达含糊，例如“可能需要记一下”。

### 9.3 confirmation token

确认流程：

1. AI 调用 `crm.previewIntakeItem`。
2. 后端返回确认摘要和 `confirmationToken`。
3. AI 向用户展示摘要。
4. 用户确认。
5. AI 调用 `crm.createIntakeItem` 并带上 `confirmationToken`。
6. 后端校验 token 未过期，且请求内容未变化。

`confirmationToken` 应包含或关联：

- actorUserId
- normalized request hash
- riskReasons
- expiresAt

建议有效期 10 分钟。

## 10. 创建流程

### 10.1 单条创建

```text
用户发起
-> AI 抽取标题、描述、来源和证据
-> AI/MCP 查询组织、空间、版本、需求、成员
-> MCP 调用 previewIntakeItem
-> 后端校验权限、引用、幂等和风险
-> 低风险直接允许，高风险返回 confirmationRequired
-> 用户确认
-> MCP 调用 createIntakeItem
-> 后端调用 IntakeService.create
-> 写 ExternalSourceBinding
-> 写 AuditLog 和 TimelineEvent
-> 返回事项链接
```

### 10.2 重复创建

```text
MCP createIntakeItem
-> 查询 external_source_bindings
-> 命中 active binding
-> 返回已有 intakeItemId
-> created = false
```

### 10.3 批量创建

批量创建必须先 preview 全部事项，展示给用户确认。

批量创建建议拆成多次单条 `createIntakeItem` 调用，不建议一期提供无上限批量工具。每批建议最多 10 条。

## 11. 后端模块设计

如果 MCP Server 独立部署，API 侧建议新增内部接口：

```http
POST /api/v1/mcp/intake-items/preview
POST /api/v1/mcp/intake-items
GET  /api/v1/mcp/intake-items/similar
```

API 模块建议：

```text
apps/api/src/modules/mcp/
apps/api/src/modules/mcp/mcp.module.ts
apps/api/src/modules/mcp/mcp-intake.controller.ts
apps/api/src/modules/mcp/mcp-intake.service.ts
apps/api/src/modules/mcp/mcp-auth.service.ts
apps/api/src/modules/mcp/mcp-confirmation.service.ts
apps/api/src/modules/mcp/mcp-source-normalizer.ts
apps/api/src/modules/mcp/mcp-risk-policy.ts
apps/api/src/modules/integration/external-source-binding.repository.ts
```

`McpIntakeService` 职责：

- 标准化 `sourceObject`。
- 校验 MCP 来源格式。
- 计算幂等键。
- 查询重复绑定。
- 调用相似事项搜索。
- 调用 `IntakeService.create`。
- 写外部来源绑定。

## 12. MCP Server 设计

MCP Server 可独立放置：

```text
apps/mcp/
```

或作为 API 子进程/独立包：

```text
packages/mcp-server/
```

建议独立部署，避免 MCP 协议运行时和 API 主服务强耦合。

MCP Server 职责：

- 暴露工具 schema。
- 验证输入基础类型。
- 注入 user delegated token。
- 调用 CRM API。
- 处理 CRM 错误并转成 MCP tool result。

MCP Server 不负责：

- 最终权限裁决。
- 数据库事务。
- 审计落库。
- 业务规则绕过。

## 13. 前端展示

事项详情增加“来源信息”区块。

MCP 来源展示：

- 创建方式：AI / MCP
- AI 客户端：Codex / ChatGPT / 内部助手
- 原始来源：Notion / Jira / 钉钉 / 用户对话
- 来源标题
- 来源编号
- 来源链接
- 证据摘要
- AI 判断：来源类型、优先级建议、判断理由

不要直接展示原始 JSON。开发调试模式可折叠显示。

新建/编辑事项表单应隐藏“来源对象 JSON”，改为普通来源字段或只读来源信息：

- 手工创建：来源编号、来源链接、来源说明。
- MCP 创建：来源信息默认只读；允许用户补充说明，但不允许直接改机器字段。

## 14. 审计与安全

### 14.1 必须记录

- actorUserId
- MCP client
- MCP tool
- requestId
- idempotencyKey
- upstream provider
- upstream objectId
- 是否经过用户确认
- riskReasons
- 创建结果 intakeItemId

### 14.2 禁止记录

- 完整 prompt。
- access token、refresh token、cookie、secret。
- 大段未脱敏原文全文。
- 未经用户授权的私密对话全文。

### 14.3 sourceObject 限制

- `evidence.summary` 建议不超过 500 字。
- `evidence.originalExcerpt` 建议不超过 1000 字。
- 整体 `sourceObject` 建议不超过 8KB。
- 超长内容应改存附件或外部 URL。

### 14.4 审计 metadata 示例

```json
{
  "operation": "MCP_CREATE_INTAKE_ITEM",
  "client": "codex",
  "tool": "crm.createIntakeItem",
  "requestId": "req_01H...",
  "idempotencyKey": "mcp:codex:notion:xxx:D-03",
  "upstreamProvider": "notion",
  "confirmationRequired": true,
  "riskReasons": ["ASSIGNEE_INFERRED"]
}
```

## 15. 错误处理

建议新增错误码：

- `MCP_AUTH_REQUIRED`
- `MCP_CLIENT_NOT_ALLOWED`
- `MCP_SOURCE_OBJECT_INVALID`
- `MCP_CONFIRMATION_REQUIRED`
- `MCP_CONFIRMATION_INVALID`
- `MCP_IDEMPOTENCY_CONFLICT`
- `MCP_SIMILAR_INTAKE_EXISTS`
- `MCP_UPSTREAM_REQUIRED`

错误返回应能被 AI 转成用户可读提示：

```text
你没有在该空间创建事项的权限。
```

```text
我找到一个相似事项，建议确认后再创建：...
```

```text
这个操作会自动指定负责人，需要你确认。
```

## 16. 测试策略

后端单测：

- `McpIntakeSourceObject` schema 校验。
- 幂等键生成。
- confirmation token 生成和校验。
- 风险策略。
- 权限拒绝。
- 相似事项命中。

后端集成测试：

- MCP preview 低风险请求。
- MCP preview 高风险请求返回 confirmationRequired。
- MCP create 复用 `IntakeService.create`。
- 重复 idempotencyKey 不重复创建。
- 无权限用户无法创建。
- 非法 sourceObject 被拒绝。

MCP Server 测试：

- 工具 schema 正确。
- CRM API 错误能映射为 tool result。
- token 缺失时拒绝写操作。

前端测试：

- 事项详情展示 MCP 来源信息。
- 不直接展示原始 JSON。
- 手工创建不再要求填写 JSON。

端到端测试：

- 模拟 AI tool call 创建事项。
- 检查事项、审计、时间线、外部来源绑定。
- 重复调用返回已有事项。

## 17. 运维与观测

建议指标：

- `mcp_tool_calls_total`
- `mcp_tool_calls_failed_total`
- `mcp_intake_created_total`
- `mcp_intake_duplicate_total`
- `mcp_confirmation_required_total`
- `mcp_permission_denied_total`

建议日志字段：

- requestId
- actorUserId
- client
- tool
- organizationId
- spaceId
- idempotencyKey hash
- result
- latencyMs

敏感字段必须脱敏，不能记录完整 sourceObject 原文。

## 18. 分期计划

### Phase 1：单条创建闭环

交付：

- MCP Server 暴露 `crm.createIntakeItem`。
- 用户身份授权。
- 标准 MCP `sourceObject`。
- 幂等键。
- 后端创建事项复用 `IntakeService.create`。
- 事项详情展示来源信息。
- 审计记录。

验收：

- 用户可通过 MCP 创建事项。
- 无权限用户无法创建。
- 同一来源重复调用不重复建事项。
- 详情页能看到 AI/MCP 来源和真实上游来源。
- 审计能追踪用户、MCP client、上游来源和创建结果。

### Phase 2：确认与去重

交付：

- `crm.previewIntakeItem`。
- confirmation token。
- 相似事项检测。
- 批量创建前确认。
- 高风险字段确认。

验收：

- 批量创建必须确认。
- 自动负责人、紧急优先级、版本/需求关联必须确认。
- 相似事项命中时提示用户。

### Phase 3：多来源标准化

交付：

- Notion upstream 标准化。
- Jira upstream 标准化。
- 钉钉/企业微信 upstream 标准化。
- 用户当前对话 upstream 标准化。
- 创建后可回写上游系统链接或评论。

验收：

- 不同上游来源在详情页展示一致。
- 真实来源和模型推断清晰分离。
- 来源链接可回溯。

### Phase 4：治理与统计

交付：

- AI 创建事项筛选。
- 按 MCP client 统计创建量、重复率、转任务率。
- 管理员控制 MCP 写能力。
- service account 待确认事项队列。

验收：

- 管理员可关闭某个 MCP client 写权限。
- 可统计 AI 创建事项质量。
- 自动化创建不会绕过人工确认规则。

## 19. 关键取舍

- MCP 是通用智能入口，钉钉/Notion/Jira 是 upstream，不要混淆。
- 一期只做创建事项，不做自动状态流转和拆解任务。
- 复用现有事项服务，避免产生第二套业务规则。
- sourceObject 用于机器可读上下文，前端展示应转成可读来源信息。
- 幂等绑定表建议尽早引入，否则重复创建难以治理。

## 20. 待评审问题

- MCP Server 独立部署还是内置到 API 服务。
- 一期是否新增 `ExternalSourceBinding` 表。
- OAuth / delegated token 的具体实现方式。
- 哪些字段必须确认。
- 是否允许 service account 创建待确认事项。
- 是否同步改造当前“来源对象 JSON”表单。
- MCP 创建事项是否优先于钉钉接入先做。

