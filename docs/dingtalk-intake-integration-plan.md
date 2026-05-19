# 钉钉接入事项池落地方案

## 1. 背景与目标

当前事项池的 `sourceType` 和 `sourceObject` 设计，用于承接“工作来源进入事项池”的回溯链路。Notion 原始需求中，事项可能来自计划拆解、需求变更、缺陷问题、会议决议、实施事项、外部协作、运维事件、发布事项和临时事项等。`sourceType` 负责稳定分类，`sourceObject` 负责保存不同来源下不固定的上下文。

钉钉接入的目标不是同步整个钉钉工作空间，而是先把钉钉群消息、客户反馈和会议/协作结论转为 CRM 事项，并由系统自动填充来源信息，避免用户手写“来源对象 JSON”。

一期目标：

- 用户可在钉钉群内通过机器人命令创建事项。
- 系统自动记录钉钉来源上下文，包括企业、群、消息、发送人、原文和时间。
- 创建成功后机器人回复 CRM 事项链接。
- CRM 事项状态变化可回推原钉钉群。
- CRM 前端隐藏普通用户手写 JSON 的入口，改为展示可读来源信息。

非一期目标：

- 不监听所有群消息并自动建单。
- 不做钉钉审批、待办、会议纪要的完整双向同步。
- 不自动下载并入库所有钉钉文件/图片。
- 不绕过 CRM 组织、空间和事项权限。

## 2. 钉钉能力依据

钉钉机器人可以通过 Webhook 或 Stream 接收消息；钉钉文档建议应用机器人可使用 Stream 模式，也支持 HTTP Webhook。群聊中机器人只接收被 AT 的消息，这适合做显式命令式建单。

钉钉机器人消息体包含机器可读上下文，例如 `conversationId`、`chatbotCorpId`、`msgId`、`senderNick`、`senderStaffId`、`createAt`、`conversationType`、`senderId`、`sessionWebhook`、`robotCode`、`msgtype` 和文本内容。非文本消息也包含下载标识，可后续扩展为附件证据。

钉钉发送消息分为回复消息模式和主动发送模式。收到用户请求后可用 `SessionWebhook` 在有效期内即时回复；超时或主动推送状态变化时，需要使用 OpenAPI 访问凭证调用主动发送能力。

参考资料：

- [钉钉机器人接收消息](https://opensource.dingtalk.com/developerpedia/docs/learn/bot/appbot/receive/)
- [钉钉机器人接收的消息类型](https://opensource.dingtalk.com/developerpedia/docs/learn/bot/message/)
- [钉钉 AI 助理发送消息](https://opensource.dingtalk.com/developerpedia/docs/develop/agent/send-message/)
- [钉钉权限概述](https://opensource.dingtalk.com/developerpedia/docs/learn/permission/intro/overview/)

## 3. 推荐一期产品形态

### 3.1 群内创建事项

用户在已绑定 CRM 空间的钉钉群中输入：

```text
@CRM 创建事项 客户A导入模板字段和系统不一致
```

可选增强语法：

```text
@CRM 创建事项 客户A导入模板字段和系统不一致 #高
@CRM 创建事项 客户A导入模板字段和系统不一致 @李四
@CRM 创建事项 客户A导入模板字段和系统不一致 来源=客户反馈
```

一期只建议实现基础标题和优先级，负责人解析可以后置。

### 3.2 引用消息转事项

用户回复或引用一条原始反馈消息，然后输入：

```text
@CRM 转事项
```

如果钉钉回调中能拿到被引用消息上下文，则用被引用消息作为 `originalText`；否则用当前命令消息正文作为来源摘要，并在机器人回复里提示“未读取到引用原文”。

### 3.3 绑定空间

管理员或空间管理员在钉钉群输入：

```text
@CRM 绑定空间 CRM项目
```

绑定成功后，该群后续创建的事项默认进入对应 CRM 空间。

建议一期不要允许普通用户绑定空间。绑定动作需要校验：

- 钉钉用户已映射 CRM 用户。
- CRM 用户是目标空间的 `SPACE_ADMIN` 或 `PM`，或组织管理员。
- 钉钉企业 `corpId` 已绑定 CRM 组织。

### 3.4 机器人回复

创建成功：

```text
已创建事项：客户A导入模板字段和系统不一致
事项编号：INTAKE-xxxx
打开： https://crm.example.com/zh-CN/intake-items?item=...
```

未绑定空间：

```text
当前钉钉群尚未绑定 CRM 项目空间。请空间管理员使用：@CRM 绑定空间 <空间名称>
```

未绑定用户：

```text
无法识别你的 CRM 账号。请先打开链接完成钉钉账号绑定：...
```

无权限：

```text
你在 CRM 空间中没有创建事项的权限，请联系项目管理员。
```

重复创建：

```text
这条钉钉消息已经创建过事项：INTAKE-xxxx
打开：...
```

## 4. 来源字段映射

### 4.1 IntakeItem 映射

钉钉消息创建事项时，建议这样映射：

```ts
title = parsedTitle;
description = originalTextOrParsedDescription;
sourceType = "EXTERNAL_COLLABORATION";
sourceObject = {
  provider: "dingtalk",
  corpId,
  conversationId,
  conversationType,
  conversationName,
  msgId,
  senderStaffId,
  senderId,
  senderNick,
  msgtype,
  originalText,
  commandText,
  createdAt,
  robotCode
};
```

如果命令明确是会议决议、需求变更或缺陷问题，可以映射到更具体的 `sourceType`：

- `会议决议` -> `MEETING_DECISION`
- `需求变更` -> `REQUIREMENT_CHANGE`
- `缺陷`、`Bug`、`问题` -> `DEFECT_PROBLEM`
- 默认 -> `EXTERNAL_COLLABORATION`

### 4.2 不应保存的字段

不要长期保存以下敏感或临时字段：

- `sessionWebhook`
- `conversationToken`
- access token
- refresh token
- app secret
- 文件下载临时 URL

这些字段只能用于当前请求内即时回复或临时下载，长期存储会扩大泄露风险。

### 4.3 建议新增结构化字段

当前 `sourceObject` 足以承接一期，但正式集成建议新增结构化来源字段或外部绑定表，以支持去重、筛选和同步。

建议优先采用外部绑定表，而不是直接改 `intake_items` 太多字段：

```prisma
model ExternalSourceBinding {
  id             String   @id @db.Char(26)
  organizationId String   @map("organization_id") @db.Char(26)
  spaceId        String   @map("space_id") @db.Char(26)
  provider       String   @db.VarChar(32)
  externalId     String   @map("external_id") @db.VarChar(300)
  targetType     String   @map("target_type") @db.VarChar(40)
  targetId       String   @map("target_id") @db.Char(26)
  metadata       Json?
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  deletedAt      DateTime? @map("deleted_at")

  @@unique([provider, externalId, deletedAt])
  @@index([organizationId])
  @@index([spaceId])
  @@index([targetType, targetId])
  @@map("external_source_bindings")
}
```

实现注记：PostgreSQL 普通唯一约束会把 `NULL` 视为不相等，`@@unique([provider, externalId, deletedAt])` 不能保证“未删除记录唯一”。实际迁移应使用项目现有软删除唯一约束模式，为 `deleted_at IS NULL` 建部分唯一索引，例如 `CREATE UNIQUE INDEX ... ON external_source_bindings(provider, external_id) WHERE deleted_at IS NULL`。

钉钉 `externalId` 建议：

```text
dingtalk:<corpId>:<conversationId>:<msgId>
```

## 5. 后端设计

### 5.1 新增模块

建议新增集成模块：

```text
apps/api/src/modules/integration/
apps/api/src/modules/integration/dingtalk/
```

核心类：

- `IntegrationModule`
- `DingtalkController`
- `DingtalkEventService`
- `DingtalkCommandParser`
- `DingtalkSignatureService`
- `DingtalkMessageService`
- `DingtalkIntakeBridgeService`
- `IntegrationConnectionRepository`
- `IntegrationChannelBindingRepository`
- `IntegrationUserBindingRepository`
- `ExternalSourceBindingRepository`

### 5.2 接收消息接口

Webhook 模式建议接口：

```http
POST /api/v1/integrations/dingtalk/events
```

处理流程：

1. 校验钉钉签名、时间戳和来源。
2. 解析消息体。
3. 根据 `chatbotCorpId` 或 `senderCorpId` 查找 CRM 组织集成连接。
4. 根据 `conversationId` 查找空间绑定。
5. 根据 `senderStaffId` 或 unionId 查找 CRM 用户绑定。
6. 解析命令。
7. 做幂等检查：`provider + externalId` 是否已存在。
8. 调用现有 `IntakeService.create` 创建事项。
9. 写入 `external_source_bindings`。
10. 使用 `sessionWebhook` 即时回复。

Stream 模式可作为生产推荐方式，但本系统一期可以先实现 HTTP Webhook，保留 Stream 适配层接口，避免一次引入额外长连接运行时复杂度。

### 5.3 命令解析

命令解析结果：

```ts
type DingtalkCommand =
  | {
      type: "CREATE_INTAKE_ITEM";
      title: string;
      priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
      sourceType?: IntakeSourceType;
      description?: string;
    }
  | {
      type: "CONVERT_MESSAGE_TO_INTAKE_ITEM";
      priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    }
  | {
      type: "BIND_SPACE";
      spaceNameOrCode: string;
    }
  | {
      type: "HELP";
    }
  | {
      type: "UNKNOWN";
      reason: string;
    };
```

解析规则：

- 去掉机器人 AT 文本。
- 支持中文命令：`创建事项`、`转事项`、`绑定空间`、`帮助`。
- `#低`、`#中`、`#高`、`#紧急` 映射优先级。
- 标题不能为空，最长 200 字。
- 原文摘要最长 2000 字，超长截断并保留 `truncated: true`。

### 5.4 创建事项

`DingtalkIntakeBridgeService` 组装现有请求：

```ts
const request: CreateIntakeItemRequest = {
  title,
  description,
  sourceType,
  sourceObject,
  priority,
};

await intakeService.create(actorUserId, spaceId, request, metadata);
```

关键原则：

- 必须复用现有 `IntakeService.create`，不要绕过权限和审计。
- actor 使用绑定后的 CRM 用户。
- 如果用户未绑定 CRM 账号，一期直接拒绝创建并提示绑定，不建议用机器人账号代建。
- 如果群未绑定空间，直接提示绑定，不创建游离事项。

### 5.5 状态回推

CRM 中这些事件可回推钉钉群：

- 事项创建成功。
- 事项纳入。
- 事项拒绝。
- 事项暂缓。
- 事项拆解成任务。

实现方式：

- 创建成功优先用当前消息的 `sessionWebhook` 即时回复。
- 后续状态变化使用主动发送模式，按 `conversationId` 或钉钉开放会话 ID 推送。
- 如果没有主动发送权限，降级为仅 CRM 内展示，不回推。

推送内容示例：

```text
事项已纳入：客户A导入模板字段和系统不一致
负责人：李四
优先级：高
打开：...
```

## 6. 配置与数据模型

### 6.1 集成连接

保存钉钉企业应用级配置：

```prisma
model IntegrationConnection {
  id             String   @id @db.Char(26)
  organizationId String   @map("organization_id") @db.Char(26)
  provider       String   @db.VarChar(32)
  externalOrgId  String   @map("external_org_id") @db.VarChar(120)
  clientId       String?  @map("client_id") @db.VarChar(200)
  encryptedSecret String? @map("encrypted_secret") @db.VarChar(1000)
  robotCode      String?  @map("robot_code") @db.VarChar(200)
  status         String   @db.VarChar(32)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  deletedAt      DateTime? @map("deleted_at")

  @@unique([provider, externalOrgId, deletedAt])
  @@index([organizationId])
  @@map("integration_connections")
}
```

实现注记：`integration_connections` 的未删除唯一约束同样应使用部分唯一索引，而不是依赖包含 `deletedAt` 的普通唯一约束。

`encryptedSecret` 必须加密存储，不能明文进入日志。

### 6.2 群与空间绑定

```prisma
model IntegrationChannelBinding {
  id                  String   @id @db.Char(26)
  organizationId      String   @map("organization_id") @db.Char(26)
  spaceId             String   @map("space_id") @db.Char(26)
  provider            String   @db.VarChar(32)
  externalChannelId   String   @map("external_channel_id") @db.VarChar(300)
  externalChannelName String?  @map("external_channel_name") @db.VarChar(200)
  defaultSourceType   String?  @map("default_source_type") @db.VarChar(80)
  status              String   @db.VarChar(32)
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")
  deletedAt           DateTime? @map("deleted_at")

  @@unique([provider, externalChannelId, deletedAt])
  @@index([organizationId])
  @@index([spaceId])
  @@map("integration_channel_bindings")
}
```

实现注记：`integration_channel_bindings` 的未删除唯一约束同样应使用部分唯一索引。

### 6.3 用户绑定

```prisma
model IntegrationUserBinding {
  id             String   @id @db.Char(26)
  organizationId String   @map("organization_id") @db.Char(26)
  userId         String   @map("user_id") @db.Char(26)
  provider       String   @db.VarChar(32)
  externalUserId String   @map("external_user_id") @db.VarChar(200)
  externalStaffId String? @map("external_staff_id") @db.VarChar(200)
  externalUnionId String? @map("external_union_id") @db.VarChar(200)
  displayName    String? @map("display_name") @db.VarChar(200)
  status         String   @db.VarChar(32)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  deletedAt      DateTime? @map("deleted_at")

  @@unique([provider, organizationId, externalUserId, deletedAt])
  @@index([organizationId])
  @@index([userId])
  @@map("integration_user_bindings")
}
```

实现注记：`integration_user_bindings` 的未删除唯一约束同样应使用部分唯一索引。

绑定方式一期可用 CRM 页面生成绑定链接，用户登录 CRM 后确认绑定钉钉身份。后续可接钉钉免登/OAuth。

## 7. 前端设计

### 7.1 事项详情来源信息

事项详情增加“来源信息”区域。

钉钉来源展示：

- 来源系统：钉钉
- 来源类型：外部协作 / 会议决议 / 缺陷问题
- 来源群：`conversationName`
- 来源人：`senderNick`
- 来源时间：`createdAt`
- 原始消息：`originalText`
- 来源标识：`msgId` 简短展示

不要直接展示原始 JSON，除非是开发调试模式。

### 7.2 新建/编辑事项表单

短期建议：

- 隐藏“来源对象 JSON”字段。
- 对手工创建事项展示普通字段：
  - 来源编号
  - 来源链接
  - 来源说明

内部保存为：

```json
{
  "provider": "manual",
  "refNo": "...",
  "url": "...",
  "note": "..."
}
```

钉钉自动创建的事项，来源信息只读展示；普通编辑不允许直接改 `provider`、`corpId`、`conversationId`、`msgId` 等机器字段。

### 7.3 集成设置页

建议在组织或空间设置下新增“集成”入口：

- 钉钉连接状态。
- 已绑定钉钉企业。
- 群与空间绑定列表。
- 用户绑定状态。
- 最近接收事件和错误。
- 开启/关闭状态回推。

一期可以先做后台配置或数据库种子，前端设置页后置；但至少需要用户绑定入口。

## 8. 权限与安全

### 8.1 权限边界

钉钉命令不能绕过 CRM 权限。

创建事项必须同时满足：

- 钉钉企业已绑定 CRM 组织。
- 钉钉群已绑定 CRM 空间。
- 钉钉发送人已绑定 CRM 用户。
- CRM 用户在该空间有创建事项权限。

否则机器人回复明确错误，不创建事项。

### 8.2 回调安全

- 校验钉钉回调签名、时间戳或 Stream 连接凭证。
- 拒绝过期请求，防重放。
- 所有外部请求记录 `requestId`，但敏感字段脱敏。
- 只接受已配置的 `corpId`、`robotCode`。

### 8.3 数据安全

- `appSecret` 加密存储。
- 不记录 access token 明文。
- 不长期保存 `sessionWebhook`。
- `sourceObject.originalText` 限长并过滤控制字符。
- 非文本消息一期只保存元信息，不自动下载原文件。
- 附件下载和入库必须经过用户确认或明确命令。

### 8.4 幂等与去重

同一条钉钉消息不能重复创建事项。

幂等键：

```text
provider = dingtalk
externalId = dingtalk:<corpId>:<conversationId>:<msgId>
```

如果幂等命中，机器人返回已有事项链接。

## 9. 错误处理

常见错误和用户提示：

| 场景 | 处理 |
| --- | --- |
| 未绑定组织 | 提示管理员完成钉钉企业接入 |
| 未绑定空间 | 提示使用 `绑定空间` 命令 |
| 未绑定用户 | 返回 CRM 账号绑定链接 |
| 无 CRM 权限 | 提示联系空间管理员 |
| 标题为空 | 返回命令示例 |
| 重复消息 | 返回已有事项链接 |
| 钉钉回复失败 | CRM 事项仍创建，记录集成错误日志 |
| CRM 创建失败 | 回复失败原因，不写外部绑定 |

建议新增集成错误码：

- `INTEGRATION_CONNECTION_NOT_FOUND`
- `INTEGRATION_CHANNEL_NOT_BOUND`
- `INTEGRATION_USER_NOT_BOUND`
- `INTEGRATION_SIGNATURE_INVALID`
- `INTEGRATION_MESSAGE_DUPLICATED`
- `INTEGRATION_COMMAND_INVALID`

## 10. 分期计划

### Phase 1：命令创建事项

交付内容：

- 钉钉应用机器人接收消息。
- 群绑定 CRM 空间。
- 钉钉用户绑定 CRM 用户。
- `@CRM 创建事项 <标题>`。
- 自动写入 `sourceType/sourceObject`。
- 创建成功回复事项链接。
- CRM 详情页展示来源信息。
- 幂等去重。

验收标准：

- 已绑定群内可创建事项。
- 未绑定空间、未绑定用户、无权限都有明确回复。
- 同一条消息重复提交不会创建重复事项。
- CRM 事项详情能看到钉钉来源，不暴露 JSON。
- 后端审计记录能追踪创建来源。

### Phase 2：引用消息转事项与状态回推

交付内容：

- `@CRM 转事项`。
- 读取引用消息或当前消息作为来源摘要。
- 事项纳入、拒绝、暂缓、拆解后回推原群。
- 钉钉来源详情支持跳转或展示外部标识。

验收标准：

- 引用消息转事项能保留原文摘要。
- 状态变化能推送到原群。
- 推送失败不影响 CRM 主事务。
- 已转事项重复操作返回已有事项。

### Phase 3：互动卡片与高级来源

交付内容：

- 钉钉互动卡片补充优先级、负责人、版本、需求。
- 图片/文件证据确认后转 CRM 附件。
- 钉钉会议纪要、审批、待办作为来源。
- 多群多空间治理和管理员配置页。

验收标准：

- 用户能在钉钉内补充关键字段。
- 附件入库经过明确确认。
- 不同来源类型展示不同结构化来源信息。

## 11. 测试策略

后端单测：

- 命令解析。
- 签名校验。
- sourceObject 组装。
- 幂等去重。
- 用户/空间未绑定错误。
- 权限拒绝。

后端集成测试：

- 模拟钉钉 Webhook 创建事项。
- 重复消息不重复创建。
- 创建后写 `external_source_bindings`。
- 创建失败不写绑定。

前端测试：

- 事项详情展示钉钉来源信息。
- 手工创建事项不再要求填写 JSON。
- 集成设置页展示绑定状态。

端到端测试：

- 钉钉消息模拟 -> 创建事项 -> 详情展示来源 -> 状态变更回推事件入队。

## 12. 运维与观测

需要记录：

- 每次钉钉事件的接收时间、处理状态、耗时。
- 命令解析结果。
- 创建事项 ID。
- 钉钉回复/主动发送结果。
- 失败原因和可重试状态。

建议指标：

- `dingtalk_events_total`
- `dingtalk_events_failed_total`
- `dingtalk_intake_created_total`
- `dingtalk_duplicate_messages_total`
- `dingtalk_reply_failed_total`

建议后台可查询最近 100 条集成事件，便于排障。

## 13. 关键取舍

- 先做显式命令，不做全量监听，降低隐私和误建单风险。
- 先做事项来源，不做完整 OA 同步，保证项目主链路清晰。
- 先复用 `IntakeService.create`，不绕过现有权限、审计和时间线。
- `sourceObject` 继续作为机器可读扩展载荷，但前端不让普通用户手写 JSON。
- 外部来源必须有幂等绑定，避免一条消息生成多个事项。

## 14. 待评审问题

- 一期采用 HTTP Webhook 还是直接采用 Stream 模式。
- 钉钉用户绑定采用 CRM 页面确认，还是接钉钉免登/OAuth。
- 群绑定空间由钉钉命令完成，还是仅在 CRM 设置页完成。
- 状态回推是否一期必须交付，还是 Phase 2。
- 是否新增 `ExternalSourceBinding` 表，还是一期仅存在 `sourceObject` 中。
- 手工创建事项的“来源编号/来源链接/来源说明”是否同步纳入本次改造。
