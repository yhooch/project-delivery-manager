# 统一文档与需求模型彻底整改方案

> 状态：本地整改蓝图，待用户确认后回写 Notion 事实源。
>
> 来源：2026-05-28 关于“需求属于文档，只是有一个标记”的产品模型讨论。
>
> 目标：为后续完整整改提供唯一方案，不把本次变更做成补丁式同步、投影或双事实源。

## 1. 背景

当前系统同时存在两类内容型对象：

- `Requirement`：需求文档，承载需求标题、正文、摘要、版本、优先级、负责人、REQ 编号、关联任务和 Bug。
- `Document`：文档上下文库文档，承载 Markdown 正文、文件夹、来源、关联资源、标签、评论、附件、时间线、MCP 文档工具。

此前 DOC 方案把这两者定义为不同对象，并通过 `document_links` 支持文档关联需求。这个模型能满足“普通文档关联需求”的第一版范围，但不能自然满足以下新产品判断：

- 文档库里的非草稿需求对空间成员可见。
- 非草稿需求应直接出现在文档库，需求草稿保留在需求工作台草稿入口。
- 文档库中的普通文档可以转成需求。
- 后续不能靠“把需求同步成文档副本”来补洞。

因此需要做架构级整改：把“文档”定义为空间内所有内容型知识对象的根模型，把“需求”定义为文档的一种受控类型。

### 1.1 本次复查修正结论

复查时对照了当前 Prisma 和 shared 契约，原方案方向正确，但需要补齐以下关键点，否则后续落地仍会留下隐性双模型或迁移缺口：

- 当前并非只有一个 `TargetType`，还存在 `AttachmentTargetType`、`CommentTargetType`、`TagTargetType`、`ObjectParticipantTargetType`、`DocumentLinkTargetType`，以及 `audit_logs.target_type` 字符串字段；这些都必须纳入统一整改。
- 历史 migration 文件不能删除或改写，只能新增向前迁移；旧表删除必须通过新的 drop migration 完成。
- 迁移必须覆盖 `audit_logs`、`document_revisions` 基线版本、`requirements.id` 与 `documents.id` 冲突预检、外键从 `requirements(id)` 切到 `documents(id)` 的完整步骤。
- 旧 `RequirementStatus.CONFIRMED` 与新 `DocumentStatus.ACTIVE` 之间必须有明确兼容层和退场时间。
- Tiptap 正文进入统一文档后，文档阅读、chunks、MCP 返回都必须走同一套派生渲染和纯文本管线，不能依赖旧 `content_markdown_cache` 的事实源语义。
- 空间概览、版本详情、最近动态、对象编号 lookup、MCP 评论/时间线等读取聚合也要一起改成 `documents.kind=REQUIREMENT`。

### 1.2 再次完整复查修正结论

在“第一版支持取消需求化”后，新增了以下必须落地的修正点：

- 取消需求化会清空 `documents.sequence`，因此必须新增 `document_code_history` 保存编号历史，保证旧 `REQ-n` 不复用且可审计追溯。
- `DRAFT` 需求不得残留 `sequence`；数据库约束和迁移预检都要阻止草稿需求带编号。
- `object_sequence_counters(REQUIREMENT).next_value` 必须在迁移后大于历史最大编号，避免后续重新发出旧编号。
- 取消需求化要清理需求负责人和关联对象带来的参与关系，避免普通文档继续继承需求写权限。
- 历史附件 `file_key` 可能包含 `requirement/` 路径；target 迁移为 `DOCUMENT` 后，新上传走文档路径，历史 key 保持可读可删。
- 旧需求迁移为文档和 revision 时，必须准备 `migration_actor_id` 填补缺失的创建人、编辑人和 revision actor。
- 文档列表查询必须继续支持 `linkedTargetType/linkedTargetId`，链接到需求时使用 `DOCUMENT + requirementDocumentId`。
- 审计和历史 lookup 不能只看当前 `documents.kind`，否则取消需求化后的旧 `REQ-n` 和旧需求审计会丢失语义。

### 1.3 第三次完整复查修正结论

本轮继续按数据库迁移和并发写入风险复查，补齐以下落地点：

- `document_code_history` 必须有明确 FK、非空、正数、唯一约束和状态变更字段，不能只是概念表。
- `REQ-n` 分配必须在同一事务中锁定 `object_sequence_counters`、更新 `documents.sequence`、插入 `document_code_history`，并靠唯一约束兜底重试。
- 现有普通文档迁移时默认保留原 `source_type`，只有来源缺失或无法表达时才使用 `MIGRATED_DOCUMENT`。
- `documents` 上的需求编号唯一索引也带上 `organization_id`，和 `document_code_history` 保持一致。
- 取消需求化、转需求、删除、恢复涉及编号历史时，都必须通过统一 transition service，不允许 repository 直接改字段。

### 1.4 第四次完整复查修正结论

本轮重点收紧正文事实源、legacy target 和取消需求化后的边界：

- `content_markdown` 只允许作为 Markdown 事实源；`TIPTAP_JSON` 的 Markdown 只能进 `content_markdown_cache` 派生缓存。
- 取消需求化必须保留原 `content_format`，因此第一版要支持 `GENERAL + TIPTAP_JSON` 的阅读和编辑。
- legacy `targetType=REQUIREMENT` 输入必须断言目标仍是需求；已取消需求化的文档返回 kind conflict。
- 活跃 `REQ-n` lookup 必须过滤 `documents.deleted_at IS NULL`，历史 lookup 才能返回取消或删除记录。
- 已取消需求化的普通文档再删除时，编号历史保持 `CANCELLED`，不得改写为 `DELETED`。

### 1.5 Notion 事实源再次核对结论

本轮通过子 agent 成功访问 Notion，并读取了以下当前事实源页面：

- `00 需求演进记录`：`35d313c6-f128-8181-bdab-e8ccbd1cee0e`
- `03 产品方案`：`35d313c6-f128-8141-8c88-f990b9ade9e1`
- `04 技术方案`：`35d313c6-f128-8146-b978-e90b91fb3773`
- `04.1 后端技术方案`：`35d313c6-f128-81e8-941c-ffb2ed634c33`
- `04.2 前端技术方案`：`35d313c6-f128-81c4-8c9f-ecc70bae5943`
- `04.3 跨端契约`：`35d313c6-f128-8156-aac1-ca08e7f34a89`
- `13.10 DOC 实施计划`：`36e313c6-f128-811c-b02f-ed766c3c3608`

核对结论：

- 当前 Notion 确认 `/documents` 是空间级文档上下文库，文档可关联 `VERSION`、`REQUIREMENT`、`INTAKE_ITEM`、`WORK_ITEM`、`DOCUMENT`，且 DOC 权限口径是空间成员可读。
- 当前 Notion 也确认需求正文具备文档化趋势，MCP 后续支持 `TIPTAP_JSON | MARKDOWN` 双格式。
- 但当前 Notion 事实源尚未支持“需求属于文档，只是有一个标记”。现有事实源仍把 `需求文档` 和 `文档` 作为两个核心对象，后端表为 `requirements` 与 `documents`，契约中 `TargetType` 同时存在 `REQUIREMENT` 和 `DOCUMENT`。
- 当前 `DocumentLinkTargetType` 表达的是“文档关联需求”，不是“需求存为文档加标记”。
- 未在当前 Notion 中找到“文档转需求”与“取消需求化”作为已确认能力。
- “文档库里的非草稿需求对空间成员可见”与当前需求可见性事实源冲突；当前需求不是所有空间成员全量可见，而是按角色和参与关系过滤。

因此，本文件不是对当前 Notion 方案的普通补充，而是一份目标架构决策草案。实施前必须先把该决策回写 Notion，并明确 supersede 当前“需求和文档双对象”的 DOC/需求方案。否则根据项目规则“以 Notion 中的原始需求和实施计划为准”，后续 agent 或开发者应当以当前 Notion 为准并拒绝直接按本地方案实现。

正式开工前必须显式确认并回写以下决策：

- 需求统一归入 `documents.kind=REQUIREMENT`，旧 `requirements` 表退场。
- `requirementId === documentId`，不引入 `document_requirement_profiles` 等隐藏需求扩展记录。
- 第一版支持普通文档转需求。
- 第一版支持取消需求化。
- 非删除需求文档对空间成员可读，包括草稿、正式和归档需求。
- `REQUIREMENT` canonical target 退场，统一为 `DOCUMENT + kind=REQUIREMENT`。

## 2. 目标模型一句话

> 文档是空间内内容沉淀的唯一根对象；需求是 `DocumentKind = REQUIREMENT` 的文档，不再是独立于文档之外的另一套内容对象。

新的核心口径：

- 一条需求只有一条 `documents` 记录。
- `requirementId === documentId`。
- 需求正文就是文档正文。
- `/documents` 默认展示普通文档和非草稿需求文档；需求草稿是需求工作台的临时编辑状态，不进入文档库默认列表。
- `/requirements` 是 `kind = REQUIREMENT` 的专用工作视图，不是另一套对象来源。
- 普通文档转需求是修改同一条文档的 `kind` 和补齐需求字段，不复制正文，不创建第二条文档。
- 需求取消需求化是把同一条文档的 `kind` 改回 `GENERAL` 并清理需求字段，不复制正文，不创建第二条文档。

## 3. 必须坚持的硬约束

### 3.1 禁止双事实源

不得出现以下长期状态：

- `requirements` 保存一份正文，`documents` 再保存一份同步正文。
- 需求页编辑 `requirements.content_*`，文档页编辑 `documents.content_*`。
- 需求修改后靠后台任务异步同步到文档库。
- 文档修改后再反向同步回需求。

正文、标题、状态、标签、附件、评论、时间线这些文档公共事实必须收敛到 `documents` 及其通用关联表。

### 3.2 禁止长期双写兼容

迁移过程中可以有短期兼容层，但必须有明确截止点：

- 旧 `requirements` 表不得长期参与业务读写。
- 新代码上线后，需求写路径只写 `documents`。
- 旧表只允许作为迁移校验和短期回滚备份。
- 通过验收后必须删除或至少彻底移出 Prisma 业务模型，避免后续开发误用。

### 3.3 禁止隐藏的“需求扩展记录”

本方案不采用 `document_requirement_profiles` 或类似一对一扩展表。用户明确要求统一概念，需求不是“文档记录 + 需求记录”。

需求专属字段直接进入 `documents`，由 `kind` 和数据库约束控制生效范围。

允许存在 `document_code_history` 这类编号历史表，但它只保存编号占用、取消、删除的审计事实，不保存需求正文、需求状态流转、版本、负责人、优先级等业务字段，因此不构成隐藏需求扩展记录。

### 3.4 禁止把 `kind` 当普通标签

`kind` 不是分类标签。只有当某类文档具备独立业务规则、权限、编号、流转或关联约束时，才允许成为 `DocumentKind`。

普通分类继续使用标签、文件夹或来源，不得滥加 `kind`。

## 4. 新核心概念

### 4.1 Document

`Document` 是空间内内容型知识对象的唯一根实体。

它承载：

- 所属组织和空间。
- 文档类型。
- 标题、摘要、正文、纯文本。
- 状态、文件夹、来源、revision。
- 创建人、编辑人、创建来源、最近编辑来源。
- 标签、评论、附件、时间线、全文检索 chunks。
- MCP 搜索、读取、创建、更新入口。

### 4.2 DocumentKind

第一阶段只保留：

```typescript
type DocumentKind = "GENERAL" | "REQUIREMENT";
```

- `GENERAL`：普通文档，承接方案、纪要、计划、外部导入、Agent 沉淀内容。
- `REQUIREMENT`：需求文档，具备 REQ 编号、版本、优先级、负责人、需求视图和交付关联规则。

后续如加入测试计划、发布说明、会议纪要，必须先判断它们是否真的需要独立业务规则。若只是内容分类，应使用标签或模板，不应新增 `kind`。

### 4.3 DocumentStatus

统一文档状态目标：

```typescript
type DocumentStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
```

映射规则：

- 旧普通文档 `ACTIVE` -> 新 `ACTIVE`。
- 旧普通文档 `ARCHIVED` -> 新 `ARCHIVED`。
- 旧需求 `DRAFT` -> 新 `DRAFT`。
- 旧需求 `CONFIRMED` -> 新 `ACTIVE`。
- 旧需求 `ARCHIVED` -> 新 `ARCHIVED`。

删除继续使用 `deletedAt`，不进入状态枚举。

状态流转规则：

- `DRAFT -> ACTIVE`：发布文档。需求文档发布时必须分配 `REQ-n` 并写 `document_code_history`；普通文档发布不分配编号。
- `ACTIVE -> ARCHIVED`：归档文档，写入 `archived_at`。
- `ARCHIVED -> ACTIVE`：恢复文档，清空 `archived_at`。
- `DRAFT -> ARCHIVED` 第一版不允许直接发生。需求草稿要么先发布为正式需求并分配编号再归档，要么删除空草稿或取消需求化后按普通草稿处理。

`archived_at` 约束：

- `status=ARCHIVED` 时 `archived_at` 必须非空。
- `status<>ARCHIVED` 时 `archived_at` 必须为空。
- 迁移旧已归档需求时，如果旧表没有归档时间，用 `updated_at -> created_at -> migration_time` 回填 `archived_at`，并在 revision/audit metadata 中标记该时间为迁移推断值。

### 4.4 Requirement

需求不再是独立实体。需求是满足以下条件的文档：

```text
documents.kind = REQUIREMENT
```

需求专属能力包括：

- `REQ-n` 编号。
- 版本归属和版本级联规则。
- 优先级。
- 负责人。
- 需求列表和需求详情编辑体验。
- 与事项、任务、Bug 的交付关联。
- 需求可见性和编辑权限。

## 5. 数据模型整改

### 5.1 documents 表目标结构

目标是将 `documents` 升级为统一内容根表。

目标字段：

```text
documents
- id
- organization_id
- space_id
- kind
- folder_id
- title
- summary
- content_format
- content_json
- content_markdown
- content_markdown_cache
- content_text
- status
- sequence
- version_id
- priority
- owner_id
- author_id
- source_type
- source_attachment_id
- revision
- created_via
- created_mcp_client_id
- last_edited_by_id
- last_edited_via
- last_edited_mcp_client_id
- last_edited_at
- archived_at
- created_at
- updated_at
- created_by_id
- updated_by_id
- deleted_at
```

字段口径：

- `kind`：文档类型，首批 `GENERAL | REQUIREMENT`。
- `summary`：需求摘要或文档摘要。普通文档默认可为空，需求可继续使用。
- `content_format`：统一支持 `TIPTAP_JSON | MARKDOWN`。
- `content_json`：Tiptap 模式事实源。
- `content_markdown`：Markdown 模式事实源，仅 `content_format=MARKDOWN` 使用。
- `content_markdown_cache`：可选派生缓存，仅 `content_format=TIPTAP_JSON` 使用，不是事实源。
- `content_text`：全文搜索、摘要片段、MCP 检索用纯文本。
- `sequence`：仅 `kind=REQUIREMENT` 且已正式激活的文档使用，用于 `REQ-n`。
- `version_id`：仅需求使用。
- `priority`：仅需求使用。
- `owner_id`：需求负责人。普通文档如后续需要 owner，需要单独确认语义，不得复用需求负责人含义。
- `author_id`：需求作者或文档原始作者，迁移期可保留现有需求作者语义。
- `source_type`：统一描述文档创建来源。
- `last_edited_by_id`：统一文档最后编辑人。迁移旧需求时如果 `updated_by_id` 为空，按 `created_by_id -> author_id -> migration_actor_id` 回退。
- `created_by_id`：迁移旧需求时如果为空，按 `author_id -> migration_actor_id` 回退或保留 nullable，但相关 revision actor 必须有值。

`source_type` 需要从当前普通文档来源扩展为统一文档来源，避免迁移后的需求只能伪装成某种上传来源。第一版不重命名已有 PostgreSQL enum 值，降低迁移风险：

```typescript
type DocumentSourceType =
  | "USER_CREATED"
  | "PASTE_MARKDOWN"
  | "PASTE_TEXT"
  | "UPLOAD_MARKDOWN"
  | "UPLOAD_DOCX"
  | "MCP_CREATED"
  | "MIGRATED_DOCUMENT"
  | "MIGRATED_REQUIREMENT";
```

已有 `UPLOAD_DOCX | UPLOAD_MARKDOWN | PASTE_MARKDOWN | PASTE_TEXT | MCP_CREATED` 保持存储值不变；如 UI 需要展示为“用户上传/用户粘贴”，在文案层映射。必须补上 `USER_CREATED`、`MIGRATED_DOCUMENT`、`MIGRATED_REQUIREMENT`，否则迁移和需求创建会被迫写入不准确来源。

### 5.2 content_format 统一

现有普通文档只支持 Markdown，现有需求支持 Tiptap JSON 和 Markdown。统一后 `documents` 必须同时支持两种正文格式。

规则：

- `content_format = MARKDOWN` 时，`content_markdown` 必填，`content_json` 必须为空。
- `content_format = TIPTAP_JSON` 时，`content_json` 必填，`content_markdown` 必须为空。
- 迁移 Markdown 需求时，旧表里的默认 `{}` `content_json` 不能照搬为事实源，必须写 `content_json=NULL`。
- 迁移 Tiptap 需求时，旧 `content_markdown_cache` 只能进入派生缓存或 revision metadata，不能写成 Markdown 事实源。
- `content_format` 独立于 `kind`。取消需求化后如果原需求是 Tiptap 正文，普通文档也必须保留 `GENERAL + TIPTAP_JSON`，不得强制转 Markdown。
- `content_text` 必须由当前事实源派生并同事务保存。
- 不再使用 `content_markdown_cache` 作为跨对象长期事实。Tiptap 导出的 Markdown 可作为派生结果写入新的渲染缓存字段，但不能替代正文事实源。
- 数据库迁移必须把现有 `documents.content_markdown` 改为 nullable，并新增 nullable `content_json`；否则 Tiptap 需求无法成为统一文档事实源。

第一版默认不把 Markdown 渲染缓存作为必需字段；如阅读性能需要，可以保留以下派生缓存字段：

```text
content_markdown_cache
```

如果保留，它必须明确为派生缓存：

- 可重建。
- 不作为编辑事实源。
- 不参与权限或业务判断。
- 缓存失效时按 `content_json` 重建。

统一渲染规则：

- 文档阅读页必须支持 `MARKDOWN` 和 `TIPTAP_JSON` 两种事实源。
- 文档编辑页也必须支持 `GENERAL + TIPTAP_JSON`，至少覆盖取消需求化后继续编辑的场景。
- `TIPTAP_JSON` 的展示可以由 Tiptap renderer 直接渲染，也可以由服务端派生安全 HTML/Markdown 后渲染，但派生结果只能是缓存。
- chunks、MCP 摘要、搜索片段只读取 `content_text` 和按 revision 生成的 chunks，不直接读取旧 `content_markdown_cache`。
- 文档详情 API 返回正文时必须带 `contentFormat`，前端不能按“文档一定是 Markdown”假设渲染。

正文大小限制第一版按现有 shared 常量收敛：

- `GENERAL`：Markdown 正文限制 2MB，导入文件限制 20MB。
- `REQUIREMENT`：沿用需求正文 20KB 限制；`TIPTAP_JSON` 按序列化后的 JSON 文本大小校验，`MARKDOWN` 按 Markdown 文本大小校验。
- 如果同一 `documents` 表使用 kind-specific limit，校验必须集中在 `DocumentContentPolicy`，不得在页面、MCP、导入、需求保存各自散落判断。

### 5.3 需求编号

`REQ-n` 仍按 `space + REQUIREMENT` 独立递增。

规则：

- `kind=REQUIREMENT` 且从空草稿首次保存为 `ACTIVE` 时分配 `sequence`。
- `kind=GENERAL` 必须没有 `sequence`。
- `kind=REQUIREMENT` 且 `status=ACTIVE|ARCHIVED` 必须有 `sequence`。
- 删除和归档不回收编号。
- 取消需求化不释放编号；旧 `REQ-n` 不得复用。
- `object_sequence_counters` 可以继续保留 `REQUIREMENT` objectType。

取消需求化要求 `documents.sequence` 清空，但又要求旧编号不可复用，因此需要增加文档编号历史表，而不是把旧编号继续挂在普通文档主表上。

目标表：

```text
document_code_history
- id
- organization_id
- space_id
- document_id
- kind
- code_prefix
- sequence
- display_code
- code_status
- assigned_at
- status_changed_at
- changed_by_id
- request_id
- reason
- created_at
- updated_at
```

字段口径：

- `kind`：当前第一版只记录 `REQUIREMENT` 编号历史。
- `code_status`：`ASSIGNED | CANCELLED | DELETED`。取消需求化写 `CANCELLED`，删除需求写 `DELETED`。
- `display_code`：冗余保存 `REQ-n`，便于审计和历史展示。
- `sequence`：必填且大于 0。
- `changed_by_id`：最近一次改变编号状态的用户或 `migration_actor_id`。
- `request_id`：可选，用于幂等和审计串联。
- 唯一约束：`UNIQUE(organization_id, space_id, kind, sequence)`，保证旧编号即使从 `documents.sequence` 清空也不能复用。
- 唯一约束：同一 `organization_id + document_id + kind + sequence` 只能有一条历史记录。
- 外键：`document_id -> documents(id)`，第一版使用 `ON DELETE RESTRICT`，因为编号历史用于防复用，不应随物理删除丢失。
- CHECK：`kind='REQUIREMENT'`、`code_prefix='REQ'`、`sequence > 0`。

使用规则：

- 分配 `REQ-n` 时，同事务写入 `document_code_history(code_status=ASSIGNED)`。
- 取消需求化时，同事务将对应历史记录标记为 `CANCELLED`，并清空 `documents.sequence`。
- 删除仍是 `kind=REQUIREMENT` 且持有编号的需求时，同事务将对应历史记录标记为 `DELETED`，编号仍不复用。
- 已取消需求化的普通文档再被删除时，编号历史保持 `CANCELLED`，不得改成 `DELETED`。
- 恢复被删除的需求文档时，如果 `kind=REQUIREMENT` 且 `sequence` 仍存在，将对应历史记录恢复为 `ASSIGNED`；如果删除前已取消需求化，恢复普通文档时不得恢复旧编号。
- 再次把同一文档转为需求时，分配新的 sequence，新增编号历史记录，不恢复旧编号。
- 物理清理文档不在第一版范围内；如后续要做合规删除，需要先设计编号 tombstone 保留策略，不能删除编号历史导致复用。

编号分配并发规则：

- `DocumentKindTransitionService` 在同一事务内锁定 `object_sequence_counters(space_id, REQUIREMENT)`。
- 递增 counter、更新 `documents.sequence`、插入 `document_code_history` 必须同事务完成。
- 如果唯一约束冲突，说明并发或历史数据异常，事务回滚后重新读取 counter 并重试；不得跳过 `document_code_history`。

这张表只保存编号历史，不保存需求正文、状态流转或需求字段，不构成第二套需求记录。

`RequirementStatus` 退场规则：

- shared 可以短期保留 `RequirementStatusSchema` 作为兼容输入输出适配。
- 存储层只保存 `DocumentStatus`。
- 旧 `CONFIRMED` 对外兼容返回时可以映射为 `ACTIVE` 或增加 `legacyStatus: "CONFIRMED"`，但不能让新业务继续依赖 `CONFIRMED` 存储值。
- 一个发布周期后删除 `RequirementStatusSchema` 的业务依赖，只在迁移脚本或历史审计展示中允许出现旧值。

### 5.4 数据库约束

必须用数据库约束阻止脏数据。

目标约束：

```sql
CHECK (
  (kind = 'GENERAL' AND sequence IS NULL)
  OR
  (kind = 'REQUIREMENT')
)
```

```sql
CHECK (
  kind = 'REQUIREMENT'
  OR (
    sequence IS NULL
    AND version_id IS NULL
    AND priority IS NULL
    AND owner_id IS NULL
  )
)
```

```sql
CHECK (
  kind <> 'REQUIREMENT'
  OR (status = 'DRAFT' AND sequence IS NULL)
  OR (status IN ('ACTIVE', 'ARCHIVED') AND sequence IS NOT NULL)
)
```

```sql
CHECK (
  (content_format = 'MARKDOWN' AND content_markdown IS NOT NULL AND content_json IS NULL)
  OR
  (content_format = 'TIPTAP_JSON' AND content_json IS NOT NULL AND content_markdown IS NULL)
)
```

```sql
CHECK (
  (status = 'ARCHIVED' AND archived_at IS NOT NULL)
  OR
  (status <> 'ARCHIVED' AND archived_at IS NULL)
)
```

需求关联字段需要额外保护：

- `work_items.requirement_id`
- `intake_items.requirement_id`
- 任何需求专属外键引用

这些字段必须只能指向 `documents.kind = REQUIREMENT` 的记录。

PostgreSQL 不能直接用普通外键引用带条件的行。第一版采用“普通外键到 `documents(id)` + trigger 校验 kind”的方案，原因是改动面最小、迁移直观，并能提供数据库级保护。

备选方案：

1. 使用复合约束技术：在子表中增加固定 `requirement_kind = REQUIREMENT`，引用 `documents(id, kind)` 的唯一键。

服务层集中校验和数据巡检测试是补充保护，不是可替代的数据库约束。不得只依赖服务层校验，避免后续误把普通文档关联为需求。

外键迁移必须明确：

- `intake_items.requirement_id` 现有关联从 `requirements(id)` 切到 `documents(id)`。
- `work_items.requirement_id` 现有关联从 `requirements(id)` 切到 `documents(id)`。
- Prisma relation 命名可以继续叫 `requirement`，但目标 model 必须是 `Document` 或一个只读的 `RequirementDocument` 视图类型。
- 如果采用 trigger 校验 kind，外键仍然引用 `documents(id)`，trigger 只负责拒绝非需求文档。
- 如果采用复合外键，子表需要增加固定列 `requirement_kind`，并引用 `documents(id, kind)`；该列应由 DB default 或 generated column 管理，业务层不要手填。

### 5.5 旧 requirements 表退场

旧 `requirements` 表迁移后必须退场。

退场步骤：

1. 迁移前只读冻结或停写。
2. 将旧需求行插入 `documents`，保持 `id` 不变。
3. 校验所有需求数量、编号、状态、正文、标签、附件、评论、时间线、关联工作项一致。
4. 新代码完全切换到 `documents`。
5. 旧表保留一个发布周期作为只读备份。
6. 删除 Prisma `Requirement` model 或改名为迁移历史模型，业务代码不得导入。
7. 后续迁移删除旧表。

不得长期保留 `requirements` 参与业务读写。

删除或归档 Prisma `Requirement` model 时必须同步清理反向关系，不能只删主 model：

- `Organization.requirements`
- `Space.requirements`
- `Version.requirements`
- `User.ownedRequirements`
- `User.authoredRequirements`
- `IntakeItem.requirement`
- `WorkItem.requirement`

其中 `IntakeItem.requirement`、`WorkItem.requirement` 应改为指向 `Document` 或只读 `RequirementDocument` 视图类型，并由 trigger/约束保证 `kind=REQUIREMENT`。`Version.requirements` 这类反向集合改为通过 `documents.version_id + kind=REQUIREMENT` 查询，不再依赖 Prisma relation。

迁移文件规则：

- 不得删除或改写任何已提交、已运行的历史 migration。
- 不得把“删除旧 requirement table migration”作为清理手段。
- 旧表退场只能通过新增 migration 执行 `DROP TABLE requirements` 或先 rename 为只读归档表再在下一轮 drop。
- Prisma schema 清理和 DB drop migration 必须同一阶段评审，避免 schema 已无模型但数据库仍被旧脚本读写，或数据库已 drop 但代码仍引用。

## 6. 关联模型整改

### 6.1 TargetType 统一

评论、附件、标签、时间线、参与关系的 canonical target 应统一为：

```typescript
type TargetType = "SPACE" | "VERSION" | "DOCUMENT" | "INTAKE_ITEM" | "WORK_ITEM";
```

`REQUIREMENT` 不再作为独立 target 类型长期存在。

当前代码里需要逐一整改的目标类型不止一个：

```text
TargetType
AttachmentTargetType
CommentTargetType
ObjectParticipantTargetType
TagTargetType
DocumentLinkTargetType
workflow_bindings.target_type
audit_logs.target_type
MCP targetType schema
Realtime target payload
Timeline target_type 与 metadata.sourceTargetType/relatedTargetType/targetType
```

整改目标：

- `TargetType` 移除 `REQUIREMENT`，保留 `DOCUMENT`。
- `AttachmentTargetType` 移除 `REQUIREMENT`，需求附件统一写 `DOCUMENT`。
- `CommentTargetType` 移除 `REQUIREMENT`，需求评论统一写 `DOCUMENT`。
- `ObjectParticipantTargetType` 移除 `REQUIREMENT`，需求参与关系统一写 `DOCUMENT`。
- `TagTargetType` 移除 `REQUIREMENT`，需求标签统一写 `DOCUMENT`。
- `DocumentLinkTargetType` 移除 `REQUIREMENT`，链接到需求就是链接到 `DOCUMENT`。
- `workflow_bindings.target_type` 使用同一个 Prisma `TargetType` enum，必须纳入 enum 清理预检。当前 workflow binding 业务实际只支持 `WORK_ITEM`，第一版不得把历史 `REQUIREMENT` binding 静默迁成 `DOCUMENT` 并制造不可执行的文档工作流绑定；如果预检发现此类数据，必须中止并先补明确的文档工作流语义字段或人工清理方案。
- `audit_logs.target_type` 虽然当前是字符串，也必须迁移历史值并统一新写入枚举口径。
- `timeline_events.metadata` 中的 `sourceTargetType`、`relatedTargetType`、`targetType` 如保存了 `REQUIREMENT`，新写入统一改为 `DOCUMENT`，并用 `sourceDocumentKind/relatedDocumentKind/kind=REQUIREMENT` 或等价 metadata 保留语义。

Prisma/PostgreSQL enum 删除旧值时必须分阶段：

1. shared/API 先停止新写入 `REQUIREMENT` target。
2. 数据迁移把所有表中的 `REQUIREMENT` target 改为 `DOCUMENT`。
3. 校验无旧值。
4. 再通过重建 enum 类型或新 enum 类型替换来移除旧值。

不得在还有历史行使用旧 enum 值时直接删除 Prisma enum value。

附件对象存储路径需要单独处理：

- 数据库 canonical target 迁移为 `DOCUMENT`。
- 历史 `attachments.file_key` 如果包含 `requirement/` 路径，可以保持不动，只要读取和删除仍按存量 key 工作。
- 新上传统一使用 `attachments/document/{documentId}/...` 或等价文档路径。
- 不建议在同一迁移窗口批量移动对象存储文件；如确需移动，必须做幂等 copy、校验和回滚策略。

迁移规则：

- 原 `targetType=REQUIREMENT,targetId=reqId` -> `targetType=DOCUMENT,targetId=reqId`。
- 通过 `documents.kind=REQUIREMENT` 判断该文档是需求。
- 对外短期兼容可以接受 `REQUIREMENT`，但必须立刻转成 `DOCUMENT` 处理，并标记废弃。
- 兼容期收到 `targetType=REQUIREMENT` 时必须断言当前文档仍是 `kind=REQUIREMENT`；如果该文档已取消需求化，应返回 kind conflict，而不是把它当普通 `DOCUMENT` 静默处理。

兼容期不得超过一个明确发布周期。

### 6.2 document_links 整改

旧文档模型中 `document_links.targetType` 支持 `REQUIREMENT`，统一后需求本身就是文档。

目标模型：

```typescript
type DocumentLinkTargetType =
  | "DOCUMENT"
  | "VERSION"
  | "INTAKE_ITEM"
  | "WORK_ITEM";
```

规则：

- 链接到需求时，使用 `targetType=DOCUMENT,targetId=requirementDocumentId`。
- 展示时如果目标文档 `kind=REQUIREMENT`，显示 `REQ-n` 和需求标题。
- 不再允许新写入 `targetType=REQUIREMENT` 的 document link。
- 不允许 `document_id = target_id AND target_type = DOCUMENT` 的自链接；普通文档转需求后尤其要校验历史 link，避免“文档链接到自己”。

### 6.3 工作项与事项关联需求

`work_items.requirement_id` 和 `intake_items.requirement_id` 继续保留字段名可以接受，因为它们表达业务语义。

但它们必须引用 `documents.id`，且目标 `documents.kind = REQUIREMENT`。

`intake_items.source_object` 是来源快照，不得作为活跃需求关联来源。取消需求化选择 `UNLINK_REFERENCES` 时，必须清空 `intake_items.requirement_id`；如果 `source_object` 中存在 `requirementId`，应改写为 `previousRequirementId`、`requirementUnlinkedAt` 或等价历史字段，避免后续代码误把它当成活跃需求引用。

交付引用规则必须和可见性分离：

- 需求草稿对空间成员可见，但不能作为新任务、新 Bug、新事项的 `requirement_id`。
- 新建或更新交付对象时，`requirement_id` 只能指向 `kind=REQUIREMENT AND status=ACTIVE AND sequence IS NOT NULL AND deleted_at IS NULL` 的文档。
- 已归档需求的历史引用可以保留用于追溯，但默认不允许新建引用；如果后续需要允许，需要单独设计“引用归档需求”的业务开关。
- 取消需求化时，任何仍存在的 `work_items.requirement_id` 或 `intake_items.requirement_id` 都视为阻塞，必须走默认拒绝或显式解除引用。
- 数据库 trigger 至少保护 `kind=REQUIREMENT`，服务层必须额外保护“新引用只能指向 ACTIVE 正式需求”。如果用 trigger 同时校验 status，需要允许历史引用在目标归档后继续存在，避免归档操作破坏旧数据。

服务层命名可以逐步调整：

- Repository 层：从 `RequirementRepository` 改为 `DocumentRequirementRepository` 或直接由 `DocumentRepository` 承接。
- Usecase 层：保留 `RequirementService` 作为需求用例服务，但底层只操作 `documents`。
- DTO：继续返回 `Requirement` 视图对象，但它是 `Document(kind=REQUIREMENT)` 的投影，不是独立实体。

## 7. 权限整改

### 7.1 读权限

新需求：

> 文档库里的非草稿需求对空间成员可见；需求草稿不进入文档库默认列表。

统一后读权限：

- 所有有效空间成员可读 `status=ACTIVE|ARCHIVED` 的普通文档。
- 所有有效空间成员可读非删除的 `kind=REQUIREMENT` 文档，包括 `DRAFT`、`ACTIVE`、`ARCHIVED`。这是“需求对象空间级可读”的第一版明确口径。
- `VIEWER` 可读，不可写。
- 未保存到服务端的本地空草稿不是文档，不进入公共文档库；一旦创建为 `DRAFT + REQUIREMENT` 文档，可以在 `/requirements` 的草稿入口中对有权限用户可见，但不得进入 `/documents` 默认列表。
- 需求草稿可见不等于可引用或可编辑；工作项/事项/Bug 关联仍只能指向满足业务规则的需求，写权限仍按需求规则判断。

这意味着需求读权限正式升级为空间级可读，但文档库默认列表仍要过滤草稿，避免空草稿污染公共文档库。

### 7.2 写权限

写权限按 `kind` 分派：

- `GENERAL`：普通文档写权限。
- `REQUIREMENT`：需求写权限。

统一根对象不意味着写权限完全统一。需求仍然有交付规则，不能因为它是文档就允许所有非 `VIEWER` 随意编辑需求字段。

写权限规则：

- 普通文档：创建者、`PM`、`SPACE_ADMIN` 可编辑；后续如要放开，单独确认。
- 需求文档：创建者、需求负责人、`REQUIREMENT`、`PM`、`SPACE_ADMIN` 可编辑。
- 版本、优先级、负责人、状态转换等需求字段必须走需求用例服务。
- 正文编辑也要走同一权限判断，避免文档详情页绕开需求权限。

### 7.3 转需求权限

普通文档转需求需要更高权限：

- `PM`、`SPACE_ADMIN`、`REQUIREMENT` 可转需求。
- 文档创建者如果不是上述角色，默认不能转需求，避免普通成员把资料变成正式需求。
- 后续如希望创建者可转为草稿需求，可以单独配置。

### 7.4 取消需求化权限

第一版必须支持“取消需求化”，但它仍是受控动作，不是普通字段编辑。

权限规则：

- 未分配 `REQ-n` 的需求草稿：`PM`、`SPACE_ADMIN`、`REQUIREMENT`、创建者可取消需求化。
- 已分配 `REQ-n` 的正式需求：仅 `PM`、`SPACE_ADMIN` 可取消需求化。
- 如果取消时需要批量解除任务、Bug、事项中的 `requirement_id`，必须二次确认，并记录操作原因。
- `VIEWER` 和普通空间成员只能阅读，不能取消需求化。

取消需求化的权限和转需求权限必须放在同一个类型转换策略服务中，避免文档页和需求页各自实现。

## 8. 产品与交互整改

### 8.1 /documents 文档库

`/documents` 是统一文档库，默认展示所有非草稿 `documents`：

- 普通文档。
- 非草稿需求文档。
- 需求草稿默认不展示；只有显式 `status=DRAFT` 查询或专用草稿入口才允许读取。

列表筛选：

- 全部。
- 普通文档。
- 需求。
- 我的文档。
- 草稿。
- 已归档。
- 文件夹。
- 标签。
- 来源。

列表行必须展示：

- 文档类型图标或徽标。
- 标题。
- `REQ-n`，仅需求有。
- 需求的版本、优先级、负责人，按低权重展示。
- 普通文档的来源、创建信息、最近编辑信息。
- 标签、文件夹、状态。

点击行为：

- 普通文档：进入 `/documents/:id`。
- 需求文档：默认也可进入 `/documents/:id` 的阅读视图，但需要提供明显的“打开需求视图”入口。
- 如果用户在需求筛选下点击，也可以直接进入 `/requirements/:id`，但必须保持同一对象 ID。

### 8.2 /requirements 需求视图

`/requirements` 不再是独立对象列表，而是：

```text
documents where kind = REQUIREMENT
```

需求列表继续保留需求工作属性：

- `REQ-n`
- 标题
- 摘要
- 版本
- 状态
- 优先级
- 负责人
- 标签
- 创建人/创建时间
- 关联任务和 Bug

需求详情和编辑继续使用专用体验，但底层读写 `documents`。

文件夹规则：

- 需求作为文档可以拥有 `folder_id`，在 `/documents` 中按文件夹展示。
- `/requirements` 默认不按文件夹组织，但可以提供文件夹筛选；它不能因为需求入口存在而修改或清空 `folder_id`。
- 文档转需求时保留原 `folder_id`，除非用户在转换表单中明确移动。
- 删除文件夹时对其中需求文档使用与普通文档一致的保护或移动规则。
- 文档文件夹树里的 `documentCount`、`descendantDocumentCount` 必须统计所有非删除文档，包括 `kind=REQUIREMENT`。转需求不改变文件夹计数，取消需求化也不改变文件夹计数；移动、删除、恢复需求文档时才影响计数。
- 文件夹删除判空必须把需求文档算作占用，不能因为需求入口是 `/requirements` 就允许删除仍包含需求文档的文件夹。

空间概览、版本页和最近动态也要统一：

- 空间概览中的需求数量从 `documents where kind=REQUIREMENT` 统计。
- 版本详情中的需求列表从 `documents.version_id` 查询。
- `versions.requirement_count` 这类冗余计数字段如果继续保留，必须从 `documents.kind=REQUIREMENT AND deleted_at IS NULL` 重算，并在转需求、取消需求化、版本变更、删除、恢复时同事务维护；否则应废弃该字段，不能继续由旧 `requirements` 表驱动。
- 最近打开、最近编辑、全局搜索、Cmd+K 结果使用 `DOCUMENT + kind` 表示需求，不再返回独立 `REQUIREMENT` 对象。
- 工作台或异常视图如需要展示关联需求标题，也从 `documents` 投影 `REQ-n` 和标题。

### 8.3 文档转需求

普通文档详情页提供“转为需求”动作。

流程：

1. 用户点击“转为需求”。
2. 弹出转需求表单。
3. 用户填写或确认：
   - 标题。
   - 摘要。
   - 版本。
   - 优先级。
   - 负责人。
   - 是否保存为草稿或直接确认。
4. 后端校验 `baseRevision`。
5. 同事务更新同一条 `documents`：
   - `kind = REQUIREMENT`
   - 写入需求字段。
   - 如直接确认，分配 `REQ-n`。
   - 写时间线。
   - 发布 realtime invalidation。
6. 页面跳转到 `/requirements/:id` 或留在文档详情并显示需求徽标。

限制：

- 已归档文档默认不能转需求，需先恢复。
- 删除文档不能转需求。
- 已经是需求的文档不能重复转需求。
- 转需求后第一版即支持取消需求化，但必须走“取消需求化”受控用例，不能直接 PATCH `kind`。

### 8.4 取消需求化

第一版支持把 `kind=REQUIREMENT` 的文档改回 `kind=GENERAL`。

这不是删除需求文档，也不是创建普通文档副本，而是同一条 `documents.id` 的类型转换：

```text
documents.kind: REQUIREMENT -> GENERAL
```

流程：

1. 用户在需求详情或文档详情点击“取消需求化”。
2. 后端返回预检结果：
   - 是否已有 `REQ-n`。
   - 是否有关联事项、任务、Bug。
   - 是否有关联版本。
   - 是否存在未完成工作项。
   - 取消后会清理哪些需求专属字段。
3. 用户确认取消方式。
4. 后端校验权限和 `baseRevision`。
5. 同事务更新同一条 `documents`：
   - `kind = GENERAL`
   - 清空 `sequence`
   - 清空 `version_id`
   - 清空 `priority`
   - 清空 `owner_id`
   - 保留 `summary`、正文、`content_format`、标签、附件、评论、文件夹、文档链接。
   - 标记 `document_code_history` 中旧编号为 `CANCELLED`。
   - 清理或重算需求专属参与关系。
   - 写 `document_revisions`、timeline、audit log。
   - 发布 realtime invalidation。

默认规则：

- 未分配 `REQ-n` 的需求草稿，且没有事项、任务、Bug 引用时，可以直接取消需求化。
- 已分配 `REQ-n` 的需求允许取消，但必须显式确认。取消后旧 `REQ-n` 永不复用，并保留在 `document_code_history`、revision、timeline、audit 中。
- 如果存在 `work_items.requirement_id` 或 `intake_items.requirement_id`，第一版提供两种模式：
  - `REJECT_IF_REFERENCED`：默认模式，有引用则拒绝取消。
  - `UNLINK_REFERENCES`：显式解除引用，将相关 `requirement_id` 置空，并在受影响对象上写 timeline。
- `UNLINK_REFERENCES` 必须重新执行版本和追踪策略校验；如果解除需求会破坏当前工作流约束，则拒绝并提示需要先处理对应对象。
- `work_items` 同时覆盖任务和 Bug，解除 Bug 需求引用时也通过对应 `work_items.requirement_id` 清空。
- `ACTIVE` 需求取消需求化后保持 `ACTIVE`，成为普通正式文档。
- 归档需求取消需求化后仍保持 `ARCHIVED`。
- 草稿需求取消需求化后默认保持 `DRAFT`，用户可选择发布为普通文档；由于 `GENERAL + DRAFT` 按普通文档草稿权限生效，UI 必须提示“取消需求化后空间成员可能不再可见”。
- `GENERAL + DRAFT` 的普通文档必须有发布入口或 API 能转为 `ACTIVE`；否则取消需求化后的草稿普通文档会进入不可发布的半状态。
- 已删除需求不能取消需求化，必须先恢复。
- 取消后再次转为需求时，按新的需求分配新的 `REQ-n`，不恢复旧编号。
- 取消后不再出现在需求列表、版本需求列表和需求 lookup 的活跃结果中。

不变内容：

- `documentId` 不变。
- 正文事实源不变。
- 文档历史不丢失。
- 文档标签、附件、评论、文件夹不丢失。
- 指向该文档的 document link 继续有效，只是不再展示 `REQ-n`。

参与关系处理：

- `DOCUMENT/CREATOR`、`DOCUMENT/COMMENTER` 保留。
- 由需求负责人产生的 `DOCUMENT/ASSIGNEE` 第一版直接删除，并依赖普通文档编辑权限重新授权。
- 由关联任务、Bug、事项产生的 `DOCUMENT/RELATED` 在解除引用时同步删除。
- 取消后草稿可见性按普通文档规则重新计算，不能继续使用需求全员可见或需求负责人权限放行。

### 8.5 需求创建

新建需求本质是创建 `kind=REQUIREMENT` 的文档。

规则：

- 新建空需求创建 `DRAFT` 文档，不分配 `REQ-n`。
- 首次保存为有效需求并进入 `ACTIVE` 时分配 `REQ-n`。
- 图片粘贴、附件上传、评论、时间线目标均使用 `DOCUMENT`。
- 创建空需求草稿不写用户可见时间线；保存为有效需求、内容更新、发布、归档、取消需求化等业务动作才写时间线。
- 需求正文编辑使用统一文档正文字段。

### 8.6 普通文档创建

普通文档创建 `kind=GENERAL`。

来源包括：

- 粘贴 Markdown。
- 粘贴纯文本。
- 上传 Markdown。
- 上传 `.docx`。
- MCP 创建。

普通文档不会分配 `REQ-n`。

通用文档创建入口不得成为需求创建捷径：

- `POST /documents`、`pdm.document.create_from_markdown`、导入文档等通用入口默认只能创建 `kind=GENERAL`。
- 通用入口不得接受或信任客户端传入的 `kind=REQUIREMENT`、`sequence`、`versionId`、`priority`、`ownerId` 等需求字段。
- 创建需求必须走 `RequirementService.create*` 或 `DocumentKindTransitionService.convertToRequirement`，由服务端补齐需求字段、权限、编号和 revision/audit；用户可见 timeline 只在有效业务动作发生时写入，空草稿创建不写 timeline。
- 更新文档时同理，`kind`、`sequence`、`document_code_history` 不能由普通 metadata 更新接口直接改。

## 9. API 契约整改

### 9.1 共享枚举

新增或调整：

```typescript
type DocumentKind = "GENERAL" | "REQUIREMENT";
type DocumentStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
type DocumentContentFormat = "TIPTAP_JSON" | "MARKDOWN";
```

需要同步调整：

- `RequirementStatusSchema` 改成兼容层，不再作为存储状态。
- `DocumentSourceTypeSchema` 补齐迁移来源和用户创建来源。
- `DocumentChangeTypeSchema` 增加 `CONVERTED_TO_REQUIREMENT`、`CANCELLED_REQUIREMENT`，用于版本历史和时间线。
- API 错误码增加或复用清晰错误：`DOCUMENT_KIND_CONFLICT`、`DOCUMENT_REVISION_CONFLICT`、`DOCUMENT_CONTENT_TOO_LARGE`、`REQUIREMENT_NOT_FOUND`、`REQUIREMENT_KIND_REQUIRED`、`REQUIREMENT_REFERENCE_INVALID`、`DOCUMENT_CANNOT_CONVERT_TO_REQUIREMENT`、`DOCUMENT_CANNOT_CANCEL_REQUIREMENT`、`DOCUMENT_REQUIREMENT_REFERENCED`。

`REQUIREMENT_REFERENCE_INVALID` 用于新建或更新任务、Bug、事项时目标不是可引用的正式需求，例如目标为普通文档、需求草稿、归档需求、无编号需求、已删除需求或已取消需求化文档。不要用 `REQUIREMENT_NOT_FOUND` 掩盖这类可诊断的业务状态，除非调用方没有权限知道目标存在。

`TargetType` 长期目标：

```typescript
type TargetType =
  | "SPACE"
  | "VERSION"
  | "DOCUMENT"
  | "INTAKE_ITEM"
  | "WORK_ITEM";
```

迁移期可保留 `REQUIREMENT` 输入兼容，但输出和存储应尽快切换为 `DOCUMENT`。

兼容输入不能复用长期 canonical enum。shared 需要提供临时 `LegacyTargetTypeInputSchema` 或在 controller 层单独接收 `REQUIREMENT` 并立即规范化，避免为了兼容输入而让业务输出和存储继续携带旧值。

### 9.2 Document DTO

统一 `Document` DTO 必须覆盖需求字段：

```typescript
type Document = {
  id: string;
  organizationId: string;
  spaceId: string;
  kind: DocumentKind;
  folderId?: string;
  title: string;
  summary?: string;
  contentFormat: DocumentContentFormat;
  contentJson?: Record<string, unknown>;
  contentMarkdown?: string;
  contentText?: string;
  status: DocumentStatus;
  sequence?: number;
  displayCode?: string;
  versionId?: string;
  priority?: Priority;
  ownerId?: string;
  sourceType: DocumentSourceType;
  revision: number;
  tags: TagDto[];
  links?: DocumentLink[];
  createdAt: string;
  updatedAt: string;
};
```

规则：

- `displayCode` 仅 `kind=REQUIREMENT` 且有 `sequence` 时返回 `REQ-n`。
- 普通文档的 `displayCode` 第一版为空。
- `contentJson/contentMarkdown` 按 `contentFormat` 互斥。

### 9.3 Requirement DTO

可以保留 `Requirement` DTO，但它是 `Document` 的需求视图：

```typescript
type Requirement = Document & {
  kind: "REQUIREMENT";
  displayCode?: string;
  versionId?: string;
  priority?: Priority;
  ownerId?: string;
  relatedWorkItems: RequirementRelatedWorkItems;
};
```

不允许出现只有 `Requirement` 有、`Document` 没有的正文事实字段。

### 9.4 REST 路由

文档路由：

- `GET /spaces/:spaceId/documents`
- `POST /spaces/:spaceId/documents`
- `GET /documents/:documentId`
- `PATCH /documents/:documentId/metadata`
- `PATCH /documents/:documentId/content`
- `POST /spaces/:spaceId/documents/import`
- `POST /spaces/:spaceId/documents/paste`
- `POST /documents/:documentId/publish` 或等价状态更新接口，用于发布 `GENERAL + DRAFT` 文档；需求草稿发布仍走需求保存/激活规则并分配编号。
- `POST /documents/:documentId/archive`
- `POST /documents/:documentId/restore`
- `DELETE /documents/:documentId`
- `POST /documents/:documentId/convert-to-requirement`
- `GET /documents/:documentId/cancel-requirement/preflight`
- `POST /documents/:documentId/cancel-requirement`

需求路由继续保留，但底层改为文档：

- `GET /spaces/:spaceId/requirements`
- `POST /spaces/:spaceId/requirements`
- `GET /requirements/:requirementId`
- `PATCH /requirements/:requirementId`
- `DELETE /requirements/:requirementId`
- `GET /requirements/:requirementId/cancel/preflight`
- `POST /requirements/:requirementId/cancel`

要求：

- `requirementId` 就是 `documentId`。
- 需求路由必须校验 `documents.kind=REQUIREMENT`。
- `DELETE /requirements/:requirementId` 兼容现有“删除空需求草稿”契约；实现上只能删除空草稿需求，非空草稿和正式需求返回明确错误。不要改成 `/draft` 路由，除非同步更新 shared/OpenAPI/前端/MCP 契约。
- 取消需求化后，`GET/PATCH /requirements/:requirementId` 应返回 `REQUIREMENT_NOT_FOUND` 或 `DOCUMENT_KIND_CONFLICT`，并在错误上下文中可带 `documentId`，供前端跳转 `/documents/:id`。
- 文档通用路由遇到 `kind=REQUIREMENT` 时，涉及需求字段的写入要走需求权限和需求规则。
- 所有正文保存、转需求、取消需求化写入都必须携带 `baseRevision` 或等价条件更新，避免并发覆盖。
- 取消需求化请求必须带 `referenceMode`，默认 `REJECT_IF_REFERENCED`，显式解除引用时使用 `UNLINK_REFERENCES`。
- 文档列表查询必须同时支持 `kind` 和 `linkedTargetType/linkedTargetId`；链接到需求时传 `linkedTargetType=DOCUMENT, linkedTargetId=requirementDocumentId`。

### 9.5 编号 lookup

`REQ-n` lookup 解析到：

```typescript
{
  // canonical navigation target
  targetType: "DOCUMENT",
  targetId: documentId,
  kind: "REQUIREMENT",
  // compatibility/code namespace
  type: "REQUIREMENT",
  id: documentId,
  displayCode: "REQ-12",
  title: string
}
```

`type=REQUIREMENT` 在兼容期只表示编号族或旧客户端语义，不表示独立 Requirement 实体。新 UI、MCP 和跳转逻辑必须使用 `targetType=DOCUMENT + targetId + kind=REQUIREMENT`。

长期可以把旧 `type` 重命名为 `codeType` 或仅保留在 legacy schema 中，但不能让它继续驱动 `Requirement` persistence 读取。

长期不要把 `REQ-n` 解析成独立 `Requirement` 对象。

取消需求化后的编号 lookup：

- 活跃 lookup 默认只返回 `documents.kind=REQUIREMENT` 且 `document_code_history.code_status=ASSIGNED` 的编号。
- 活跃 lookup 必须同时过滤 `documents.deleted_at IS NULL`。
- 如果用户或审计工具显式查询历史编号，可以返回 `targetType=DOCUMENT`、`kind=GENERAL`、`previousKind=REQUIREMENT`、`previousDisplayCode=REQ-n`、`codeStatus=CANCELLED`。
- 历史编号 lookup 不允许被工作项、事项、Bug 用作新的 `requirement_id`。
- `REQ-n` 无论活跃还是历史，都不能解析成独立 `Requirement` 记录。

## 10. 后端模块整改

### 10.1 document 模块升级为内容根模块

`document` 模块负责：

- 文档根对象 CRUD。
- 正文格式校验和纯文本派生。
- revision 和冲突保护。
- 文件夹。
- chunks。
- 文档权限入口。
- 文档类型分派。
- 统一正文写入策略，支持 `GENERAL/REQUIREMENT` 与 `MARKDOWN/TIPTAP_JSON` 的组合。

### 10.2 requirement 模块改为需求用例模块

`requirement` 模块保留，但职责收窄：

- 创建 `kind=REQUIREMENT` 文档。
- 保存需求字段。
- 分配 `REQ-n`。
- 版本级联规则。
- 需求关联任务/Bug 查询。
- 需求权限判断。

它不得拥有独立 persistence model。

需求草稿激活为正式需求时，也必须使用统一编号分配能力写入 `documents.sequence` 和 `document_code_history`。不得由 `RequirementService` 直接更新 sequence。

### 10.3 TargetResolverService

目标解析器需要统一：

- `DOCUMENT` 能解析所有文档。
- 返回 `document.kind`。
- 若调用方要求需求，必须显式断言 `kind=REQUIREMENT`。
- 迁移期收到 `REQUIREMENT` targetType 时，转为 `DOCUMENT` 并记录废弃路径。
- 旧逻辑中 `DRAFT REQUIREMENT` 只对参与者或部分角色可见的分支必须删除或改造。第一版新口径是所有空间成员可读非删除需求文档，因此 TargetResolver 解析 `DOCUMENT + kind=REQUIREMENT` 时，草稿需求也按空间成员可读返回。
- RealtimePermissionService 同步调整：需求事件 canonical target 改为 `DOCUMENT`，并按 `kind=REQUIREMENT` 对所有空间成员放行非删除需求文档；不能继续因为 `status=DRAFT` 要求参与关系。

### 10.4 TraceVersionPolicy

版本联动策略从读取 `requirements` 改为读取 `documents.kind=REQUIREMENT`。

要求：

- 关联需求时校验目标文档 `kind=REQUIREMENT`。
- 需求版本变更仍触发下游事项、任务、Bug 级联检查。
- 普通文档没有版本级联语义。
- `TRACE_VERSION_CONFLICT`、`TRACE_VERSION_CHANGE_REQUIRES_CASCADE` 等错误 payload 不应继续输出 canonical `targetType=REQUIREMENT`。新 payload 使用 `targetType=DOCUMENT`、`targetKind=REQUIREMENT`、`targetId=documentId`，或把旧字段重命名为 `semanticTargetType=REQUIREMENT` 作为兼容字段。

### 10.5 Object participants

需求参与关系迁移为文档参与关系：

- 创建需求写 `DOCUMENT/CREATOR`。
- 需求负责人写 `DOCUMENT/ASSIGNEE` 或继续使用独立 owner 字段并在可见性策略中读取。
- 评论者写 `DOCUMENT/COMMENTER`。
- 关联任务/Bug 可写 `DOCUMENT/RELATED`。

所有空间成员可读非删除需求文档后，参与关系主要用于写权限、通知、负责人/相关人展示，不再用于公共需求读权限。

### 10.6 DocumentRevision

`document_revisions` 必须覆盖需求文档：

- 迁移旧需求时为每条需求生成至少一条基线 revision。
- 旧需求 `contentFormat=TIPTAP_JSON` 时，revision 表也要能保存 `content_json` 或明确保存派生 Markdown；推荐同步升级 revision schema，避免历史版本只能保存 Markdown。
- 如果 revision 升级为双格式事实源，`document_revisions.content_markdown` 也必须改为 nullable，并新增 nullable `content_json`，用 `content_format` CHECK 约束二选一；不能只改主表而让 Tiptap 历史版本被迫伪造 Markdown。
- revision 表需要增加 `metadata` JSON 字段，用于记录类型转换、旧编号、解除引用摘要等不可放进正文的历史上下文。
- 转需求写入 `DocumentChangeType.CONVERTED_TO_REQUIREMENT`。
- 取消需求化写入 `DocumentChangeType.CANCELLED_REQUIREMENT`，并在 revision metadata 中记录原 `REQ-n`、原版本、原负责人、原优先级、解除引用数量。
- 需求正文、标题、摘要更新都应生成文档 revision。
- revision 的 `baseRevision` 冲突保护对文档页和需求页一致生效。

### 10.7 读取聚合模块

以下模块不能继续直接查 `requirements` 表：

- `space` overview 和动态聚合。
- `version` 详情、版本看板中的需求摘要。
- `workitem`、`bug`、`intake` 映射中的关联需求标题和编号。
- `object-code` lookup。
- `target-resolver` 权限解析。
- `realtime-permission` 和订阅鉴权。

统一策略是：业务字段仍叫 `requirementId`，但读取时 join `documents` 并断言 `kind=REQUIREMENT`。

### 10.8 AuditLog

`audit_logs.target_type` 当前不是 Prisma enum，但仍是业务事实的一部分。

要求：

- 历史 `target_type='REQUIREMENT'` 迁移为 `DOCUMENT`，`target_id` 保持不变。
- `metadata` 中如存有 `requirementId`、`requirementCode`、`targetType` 等冗余字段，需要按兼容策略迁移或在读取时标准化。
- 新审计写入统一使用 `DOCUMENT`，并在 metadata 中可带 `kind=REQUIREMENT`、`displayCode=REQ-n`。
- 审计查询 UI 可以提供“需求”筛选。活跃需求筛选条件是 `target_type=DOCUMENT AND documents.kind=REQUIREMENT`；历史需求筛选必须同时查 `audit_logs.metadata.kind/previousKind` 或 `document_code_history`，否则取消需求化后的旧审计会从需求审计视图中消失。

### 10.9 DocumentKindTransitionService

类型转换必须集中在一个服务中，至少包含：

- `convertToRequirement(documentId, input)`。
- `cancelRequirement(documentId, input)`。
- `preflightCancelRequirement(documentId)`。

该服务负责：

- 权限判断。
- `baseRevision` 冲突保护。
- 需求编号分配和不可复用语义。
- 编号历史状态更新。
- 需求字段清理。
- 下游 `requirement_id` 引用预检和解除。
- revision、timeline、audit、realtime 按动作语义一致写入；空需求草稿创建保留 revision/audit/realtime，不写用户可见 timeline。
- 转换后的 DTO 投影。

禁止任何 controller、repository、MCP executor 直接修改 `documents.kind`、`documents.sequence` 或 `document_code_history`。这些写入必须经过 `DocumentKindTransitionService`，否则会破坏编号不可复用和取消需求化的一致性。

## 11. 前端整改

### 11.1 类型与服务

需要统一前端类型：

- `DocumentSummary` 增加 `kind`、`displayCode`、`versionId`、`priority`、`ownerId`、`summary`。
- `Requirement` 从独立类型改为 `Document(kind=REQUIREMENT)` 的视图类型。
- `document-service` 支持 `kind` 筛选。
- `document-service` 继续透传 `linkedTargetType/linkedTargetId`，并移除 `REQUIREMENT` link target 输入。
- `requirement-service` 底层调用需求路由，但解析结果来自统一文档 schema。

### 11.2 文档列表

文档列表新增需求展示能力：

- 类型筛选。
- 需求徽标。
- `REQ-n`。
- 版本、优先级、负责人。
- 需求状态。
- 打开需求视图的入口。
- 默认排除 `status=DRAFT`；显式草稿状态查询可用于专用入口或内部工具。

列表必须避免两个问题：

- 需求在 `/documents` 出现但无法识别为需求。
- 用户从 `/documents` 编辑需求正文时绕过需求权限和版本规则。

### 11.3 文档详情

`/documents/:id` 成为统一阅读页。

当 `kind=REQUIREMENT` 时：

- 显示需求徽标和 `REQ-n`。
- 显示版本、优先级、负责人、关联任务/Bug。
- 编辑按钮跳到需求编辑体验，或在当前页打开需求编辑模式，但必须使用需求保存 API。
- `contentFormat=TIPTAP_JSON` 时使用需求编辑器/阅读渲染器，不允许把 JSON 当 Markdown 展示。
- `contentFormat=MARKDOWN` 时使用文档 Markdown 渲染器，并保持附件、图片、链接解析规则一致。

当 `kind=GENERAL` 且 `contentFormat=TIPTAP_JSON` 时：

- 使用同一套 Tiptap 阅读和编辑组件。
- 权限按普通文档写权限判断。
- 保存走文档内容 API，不走需求 API。
- 不允许在保存时隐式转成 Markdown。

### 11.4 需求页面

`/requirements` 和 `/requirements/:id` 继续存在，因为用户需要需求工作台视图。

但实现上：

- 列表查询 `kind=REQUIREMENT`。
- 详情读取统一文档。
- 保存写统一文档。
- 草稿、本机缓存、图片上传继续可用，但 targetType 使用 `DOCUMENT`。
- 本机草稿缓存 key 可以继续叫 `requirementId`，但其值就是 `documentId`，缓存内容必须包含 `contentFormat` 和 `baseRevision`。

### 11.5 文档转需求 UI

普通文档详情增加“转为需求”按钮。

对话框字段：

- 标题。
- 摘要。
- 版本。
- 优先级。
- 负责人。
- 保存为草稿 / 确认为需求。

提交后：

- 成功转为需求，显示 `REQ-n` 或草稿状态。
- 跳转需求详情。
- 当前文档列表和需求列表都实时刷新。

### 11.6 取消需求化 UI

需求详情和需求文档详情增加“取消需求化”入口。

交互要求：

- 先调用预检接口，展示关联事项、任务、Bug 数量和编号摘要。
- 无引用时允许直接确认。
- 有引用时默认禁用确认，并提示需要先处理引用；具备权限时可选择“解除引用并取消需求化”。
- 对已分配 `REQ-n` 的需求必须展示“旧编号不会复用”的确认文案。
- 成功后留在 `/documents/:id`，徽标变为普通文档；`/requirements` 列表移除该项。
- 文档列表、需求列表、版本需求列表、关联对象详情实时刷新。

## 12. MCP 整改

### 12.1 文档工具

`pdm.document.search/get` 必须返回：

- `id`
- `kind`
- `displayCode`
- `title`
- `contentMarkdown` 或 chunks
- `sourceType`
- `status`
- 权限摘要

搜索默认覆盖普通文档和需求文档。

可增加筛选：

```typescript
kind?: "GENERAL" | "REQUIREMENT";
```

### 12.2 需求工具

`pdm.requirement.get/create` 继续保留，但底层操作 `documents.kind=REQUIREMENT`。

创建需求：

- 创建 `kind=REQUIREMENT` 文档。
- Markdown 输入写 `content_format=MARKDOWN`。
- 分配 `REQ-n`。
- 返回同一个 `documentId`。

MCP scope 必须保持业务边界：

- `pdm.requirement.create` 继续要求 `mcp:write:requirement`，不得因为底层写 `documents` 就降级为只要 `mcp:write:document`。
- `pdm.document.convert_to_requirement` 要求 `mcp:write:document + mcp:write:requirement`，因为它既改文档，又创建正式需求语义。
- `pdm.document.cancel_requirement` 要求 `mcp:write:document + mcp:write:requirement`，因为它会移除需求语义、清理编号和解除交付引用。
- `pdm.document.append_content/replace_content/update_metadata/link_resources/move_to_folder` 如果目标是 `kind=REQUIREMENT`，除原 `mcp:write:document` 外还必须具备 `mcp:write:requirement`，或明确拒绝由文档工具修改需求文档。第一版推荐要求双 scope，避免现有文档写客户端绕过需求写授权。
- `mcp:write:requirement` 是 OAuth scope 边界，空间角色和业务权限仍必须继续校验，二者不能互相替代。

兼容要求：

- `pdm.requirement.get` 输入仍叫 `requirementId`，但内部按 `documents.id` 查询并断言 `kind=REQUIREMENT`。
- `pdm.comment.create` 如果调用方传 `targetType=REQUIREMENT`，兼容期内可接收，但必须规范化为 `DOCUMENT` 写入。
- `pdm.timeline.list` 如果调用方传 `targetType=REQUIREMENT`，兼容期内可接收，但返回 payload 的 canonical target 应是 `DOCUMENT`，并带 `kind=REQUIREMENT`。
- 如果目标文档已经取消需求化，`pdm.requirement.get` 和 legacy `targetType=REQUIREMENT` 写入都必须返回 kind conflict。
- `pdm.object.lookup_code` 对 `REQ-n` 返回 canonical `targetType=DOCUMENT`、`targetId=documentId`、`kind=REQUIREMENT`；兼容期可继续返回 `type=REQUIREMENT` 作为编号族字段，但不能把它用于独立需求表读取。
- 兼容期结束后 MCP schema 移除 `REQUIREMENT` targetType 输入。

### 12.3 文档转需求工具

新增类型转换工具：

```text
pdm.document.convert_to_requirement
pdm.document.cancel_requirement
```

输入：

- `documentId`
- `organizationId`
- `spaceId`
- `baseRevision`
- `versionId?`
- `priority?`
- `ownerId?`
- `summary?`
- `activate?: boolean`
- `idempotencyKey`

规则：

- 必须拥有转需求权限。
- 只能对 `kind=GENERAL` 文档执行。
- 成功后返回 `kind=REQUIREMENT` 文档和 `REQ-n`。

取消需求化输入：

- `documentId`
- `organizationId`
- `spaceId`
- `baseRevision`
- `referenceMode: "REJECT_IF_REFERENCED" | "UNLINK_REFERENCES"`
- `reason?`
- `idempotencyKey`

规则：

- 必须拥有取消需求化权限。
- 只能对 `kind=REQUIREMENT` 文档执行。
- 默认有事项、任务、Bug 引用时拒绝。
- `UNLINK_REFERENCES` 成功后返回 `kind=GENERAL` 文档和被解除引用对象摘要。
- 返回中可以包含 `previousDisplayCode`，但对象本身不再有 `displayCode`。

## 13. Realtime 整改

统一后 realtime target 应以 `DOCUMENT` 为核心。

事件示例：

```typescript
{
  target: { type: "DOCUMENT", id: documentId },
  hints: { kind: "REQUIREMENT" },
  invalidates: [
    "document-list",
    "document-detail",
    "requirement-list",
    "requirement-detail",
    "resource-documents"
  ]
}
```

规则：

- 普通文档更新：刷新文档列表和文档详情。
- 需求文档更新：刷新文档列表、需求列表、需求详情、相关版本/任务/Bug 视图。
- 普通文档转需求：同时刷新文档列表和需求列表。
- 需求取消需求化：刷新文档列表、需求列表、需求详情、相关版本/任务/Bug/事项视图；需求详情应跳转或失效。
- 需求归档：同时影响文档归档视图和需求归档视图。

事件 payload 仍不得携带敏感正文、评论内容或附件名。

## 14. 搜索与 chunks 整改

`document_chunks` 应覆盖所有 `documents`。

规则：

- 普通文档按 Markdown 标题和段落分块。
- Markdown 需求同样按 Markdown 分块。
- Tiptap 需求需要从 Tiptap JSON 派生稳定文本和可选 Markdown 缓存，再生成 chunks。
- chunks 必须包含 `documentId`、`revision`、`ordinal`、`headingPath`、`contentText`。
- 需求正文更新后，同事务或同一 durable write path 重建 chunks。
- 转需求和取消需求化不一定改变正文，但必须更新搜索索引中的 `kind`、`displayCode`、`versionId`、`ownerId` 等过滤字段。
- 取消需求化后，文档继续可被文档库搜索命中，但不能再被 `kind=REQUIREMENT` 的需求搜索命中。

不得保留一套 requirement search index 和一套 document search index。

## 15. 迁移实施计划

### 阶段 A：事实源和契约冻结

目标：先冻结新模型，避免边做边改。

任务：

- 先创建或更新统一模型架构决策记录，写明本方案 supersede 当前 Notion 中“需求文档”和“文档”双对象方案。
- 回写 Notion `03 产品方案`。
- 回写 Notion `04 技术方案`。
- 回写 Notion `04.1 后端技术方案`。
- 回写 Notion `04.2 前端技术方案`。
- 回写 Notion `04.3 跨端契约`。
- 回写 Notion `06 测试与验收`。
- 回写 Notion `13.10 DOC 实施计划`。
- 在相关 Notion 页顶部标注旧双对象模型已被统一文档模型取代，避免后续 agent 继续按旧事实源拆分实现。
- 明确“需求属于文档，不存在需求扩展表”。
- 明确第一版必须支持文档转需求和取消需求化。
- 明确所有非删除需求文档对空间成员可读。
- 明确旧 `requirements` 退场。
- 明确 `REQUIREMENT` targetType 废弃路径。

交付物：

- 新 DocumentKind 事实源。
- 新统一状态事实源。
- 新权限事实源。
- 新迁移计划。
- 已回写 Notion 的架构决策记录，并能从产品方案、技术方案、跨端契约和 DOC 实施计划互相引用。

### 阶段 B：shared 契约改造

任务：

- 新增 `DocumentKindSchema`。
- 统一 `DocumentStatusSchema`。
- 扩展 `DocumentSchema` 支持需求字段。
- 调整 `RequirementSchema` 为 `Document(kind=REQUIREMENT)` 视图。
- 调整 `TargetType`、`AttachmentTargetType`、`CommentTargetType`、`ObjectParticipantTargetType`、`TagTargetType`、`DocumentLinkTargetType`。
- 明确 `WorkflowBindingSchema` 第一版仍是 `WORK_ITEM` workflow binding，不新增隐式 `DOCUMENT/REQUIREMENT` workflow binding 输入。
- 调整 `ObjectCodeLookupResultSchema`，为 `REQ-n` 增加 canonical `targetType=DOCUMENT`、`targetId`、`kind=REQUIREMENT` 字段；旧 `type=REQUIREMENT` 只作为兼容编号族字段保留。
- 增加 `ConvertDocumentToRequirementRequestSchema`。
- 增加 `CancelRequirementRequestSchema` 和 `CancelRequirementPreflightResponseSchema`。
- 增加 `baseRevision`、kind-specific content limit、转换错误码。
- 更新 MCP tool schema。
- 更新 OpenAPI 契约。

验收：

- shared 单测覆盖普通文档、需求文档、草稿需求、转需求输入、取消需求化输入、非法字段组合。

### 阶段 C：数据库迁移准备

任务：

- 扩展 `documents` 表字段。
- 增加 `kind`、统一 `status`、`content_format`、`content_json`、`content_markdown_cache`、`summary`、`sequence`、`version_id`、`priority`、`owner_id`、`author_id`。
- 将 `documents.content_markdown` 改为 nullable；新增的 `content_json` 允许 nullable，由 `content_format` CHECK 约束决定事实源字段。
- 清理 Prisma 旧 `Requirement` model 的所有反向 relation，并将 `IntakeItem.requirement`、`WorkItem.requirement` 改为指向 `Document` 或只读 `RequirementDocument` 视图类型。
- 增加数据库约束。
- 增加需求关联校验 trigger 或复合约束。
- 新增 `document_code_history` 表和编号唯一约束。
- 为 `documents(space_id, kind, status, deleted_at)` 建索引。
- 为 `documents(organization_id, space_id, kind, sequence)` 建唯一索引，`sequence IS NOT NULL`。
- 为 `documents(space_id, folder_id, kind, status, deleted_at)` 建列表索引。
- 为 `document_chunks(document_id, revision, ordinal)` 建唯一或查询索引。
- 升级 `document_revisions` 支持 `kind`、`content_format`、`content_json`、`summary`、`metadata` 或明确的历史渲染缓存策略。
- 准备 `audit_logs.target_type` 历史值迁移 SQL。
- 准备 `workflow_bindings.target_type` 预检 SQL。当前第一版 workflow binding 只支持 `WORK_ITEM`，所以预检必须证明不存在 `REQUIREMENT` binding；如存在，迁移必须中止，不能直接改成 `DOCUMENT`。
- 准备 `timeline_events.metadata` 中旧 target 字段的 JSON 迁移 SQL，至少覆盖 `sourceTargetType`、`relatedTargetType`、`targetType`。
- 准备 PostgreSQL enum 迁移策略：新增值可以直接追加，删除 `REQUIREMENT` 等旧 enum 值必须在历史数据迁移后通过重建 enum 类型或新 enum 类型切换完成。

验收：

- migration 可以在空库和含历史数据的库执行。
- 约束能阻止普通文档写入 `sequence`。
- 编号历史唯一约束能阻止旧 `REQ-n` 被复用。
- 约束能阻止工作项关联普通文档作为需求。
- Tiptap 需求可以在 `documents` 中保存而不需要伪造 `content_markdown`。
- Prisma schema 不再暴露可被业务代码误用的 `Requirement` persistence relation。
- PostgreSQL enum 迁移演练覆盖“旧值已清空后再移除 enum 值”的路径。
- 历史 migration 文件未被删除或改写，只新增向前 migration。

### 阶段 D：数据迁移

采用维护窗口，避免长期双写。

步骤：

1. 停止 Web/API 写入口或进入维护模式。
2. 备份数据库。
3. 执行迁移预检：
   - `requirements.id` 与现有 `documents.id` 不得冲突；如冲突必须停下人工处理，不能生成新 ID，因为目标模型要求 `requirementId === documentId`。
   - 所有 `work_items.requirement_id`、`intake_items.requirement_id` 必须能在旧 `requirements` 中找到，找不到的先修复或清空。
   - 所有新建引用策略要确认：迁移后历史引用可保留，但新引用只能指向 `ACTIVE` 且有编号的需求文档。
   - 旧 `requirements.sequence` 在同一 `space_id` 下不得重复。
   - `object_sequence_counters(REQUIREMENT).next_value` 必须大于同空间历史最大 `requirements.sequence`；不满足则迁移中修正。
   - 旧 `CONFIRMED/ARCHIVED` 需求必须有 `sequence`。
   - 旧 `DRAFT` 需求不得有 `sequence`；如存在，必须先人工确认改为 `CONFIRMED`、清空编号并写历史，或中止迁移。
   - 旧需求正文必须能按 `content_format` 解析并派生 `content_text`。
   - 旧归档需求必须能回填 `archived_at`；如无明确归档时间，使用 `updated_at -> created_at -> migration_time` 推断，并写入迁移 metadata。
   - `workflow_bindings.target_type` 不得存在 `REQUIREMENT`；如存在，说明历史数据表达了当前第一版不支持的需求工作流绑定，必须先人工处理或补文档工作流设计。
   - 确认存在可用于迁移的 `migration_actor_id`，用于填补旧需求缺失的创建人、编辑人和 revision actor。
4. 将现有普通 `documents` 标记为 `kind=GENERAL`。默认保留原 `source_type`；只有来源缺失、非法或无法表达时才补为 `MIGRATED_DOCUMENT`。
5. 将旧 `requirements` 插入 `documents`：
   - 保持 `id` 不变。
   - `kind=REQUIREMENT`。
   - 状态按映射转换。
   - `ARCHIVED` 需求写入 `archived_at`；非归档需求清空 `archived_at`。
   - 复制标题、摘要、正文、纯文本、格式、版本、优先级、负责人、作者、编号、时间戳。
   - `MARKDOWN` 需求写 `content_markdown` 并将 `content_json` 置空。
   - `TIPTAP_JSON` 需求写 `content_json`，`content_markdown` 置空或仅写派生缓存字段。
   - 写入 `source_type=MIGRATED_REQUIREMENT` 或等价来源。
   - 用 `updated_by_id -> created_by_id -> author_id -> migration_actor_id` 填充 `last_edited_by_id`。
   - 用 `created_by_id -> author_id -> migration_actor_id` 填充 revision actor。
   - 初始化 `revision=1` 或沿用可计算的最新 revision。
6. 为每条迁移后的需求文档生成 `document_revisions` 基线版本。
7. 为每条已有编号的旧需求生成 `document_code_history(code_status=ASSIGNED)`。
8. 修正 `object_sequence_counters(REQUIREMENT).next_value`，确保大于 `document_code_history` 中同空间最大 sequence。
9. 重算并校验版本需求计数。如果保留 `versions.requirement_count`，必须按 `documents.kind=REQUIREMENT AND deleted_at IS NULL` 重算。
10. 切换外键：
   - 删除 `work_items.requirement_id -> requirements(id)` 旧外键。
   - 删除 `intake_items.requirement_id -> requirements(id)` 旧外键。
   - 新增 `work_items.requirement_id -> documents(id)` 外键。
   - 新增 `intake_items.requirement_id -> documents(id)` 外键。
   - 增加 trigger 或复合约束，阻止引用 `kind<>REQUIREMENT` 的文档。
11. 迁移 target：
   - comments: `REQUIREMENT` -> `DOCUMENT`
   - attachments: `REQUIREMENT` -> `DOCUMENT`
   - tag_assignments: `REQUIREMENT` -> `DOCUMENT`
   - timeline_events: `REQUIREMENT` -> `DOCUMENT`
   - timeline_events.metadata: `sourceTargetType/relatedTargetType/targetType=REQUIREMENT` -> `DOCUMENT`，同时补充 `sourceDocumentKind/relatedDocumentKind/kind=REQUIREMENT` 或等价语义字段。
   - object_participants: `REQUIREMENT` -> `DOCUMENT`
   - audit_logs: `REQUIREMENT` -> `DOCUMENT`
   - workflow_bindings: 当前应只允许 `WORK_ITEM`；若仍有 `REQUIREMENT`，本阶段必须中止，不能静默转成 `DOCUMENT`。
12. 标准化来源快照：
   - `intake_items.source_object.requirementId` 如果表示历史来源，迁移为 `previousRequirementId` 或等价历史字段。
   - 活跃需求关联只以 `intake_items.requirement_id` 为准。
13. 校验附件对象存储 key：
   - 历史 `requirement/` 路径保持可读。
   - 新写入路径切到 `document/`。
   - 不在主迁移中强制移动对象存储文件。
14. 迁移 document links：
   - `targetType=REQUIREMENT` -> `targetType=DOCUMENT`
   - 清理或拒绝 `document_id=target_id AND target_type=DOCUMENT` 自链接。
15. 重建需求文档 chunks。
16. 校验关联字段仍指向同 ID。
17. 启动新代码。

校验 SQL 必须覆盖：

- 旧需求数 = 新 `documents.kind=REQUIREMENT` 数。
- 非草稿旧需求编号全部存在。
- 旧需求编号全部写入 `document_code_history`，且没有重复。
- `object_sequence_counters(REQUIREMENT).next_value` 大于同空间最大历史需求编号。
- 工作项需求关联全部能找到 `kind=REQUIREMENT` 文档。
- 事项需求关联全部能找到 `kind=REQUIREMENT` 文档。
- 新建/更新工作项、Bug、事项时不能引用 `DRAFT`、`ARCHIVED`、无编号、已删除或已取消需求化的文档。
- `status=ARCHIVED` 的文档都有 `archived_at`，非归档文档没有 `archived_at`。
- 如保留 `versions.requirement_count`，其值等于同版本非删除需求文档数量。
- `intake_items.source_object` 不再保留会被误用为活跃关联的 `requirementId` 字段。
- 旧需求评论、附件、标签、时间线数量迁移一致。
- 历史需求附件 file key 仍可读取和删除，新需求附件写入文档路径。
- 旧需求审计日志数量迁移一致或读取兼容策略已覆盖。
- 每条需求文档至少有一条 baseline `document_revisions`。
- 不存在 `targetType=REQUIREMENT` 的新活跃数据。
- 不存在 `audit_logs.target_type='REQUIREMENT'` 的新写入。
- 不存在 `workflow_bindings.target_type='REQUIREMENT'`；若 enum 已清理，该表仍能正常维护默认 `WORK_ITEM` binding。
- 不存在 `timeline_events.metadata.sourceTargetType/relatedTargetType/targetType='REQUIREMENT'` 的新写入或未标准化历史值。
- 不存在 document link 自链接。

### 阶段 E：后端切换

任务：

- `DocumentRepository` 成为统一内容 repository。
- `RequirementRepository` 删除或改为基于 document repository 的视图适配器。
- `RequirementService` 改为需求用例服务，不再直接访问旧 `requirements` 表。
- `DocumentKindTransitionService` 落地转需求、取消需求化和预检能力。
- `DocumentCodeHistoryRepository` 落地编号历史写入、取消标记和历史 lookup。
- `AttachmentService`、`CommentService`、`TagService`、`TimelineService` 使用 `DOCUMENT` target。
- `TargetResolverService` 统一解析。
- `TraceVersionPolicy` 读取 `documents.kind=REQUIREMENT`。
- `ObjectCodeLookup` 从 `documents + document_code_history` 查询 `REQ-n`，默认只返回活跃需求编号。
- `SpaceOverview`、`VersionRepository`、最近动态、工作项/事项/Bug 映射全部从 `documents.kind=REQUIREMENT` 读取需求投影。
- 文档转需求和取消需求化 usecase 落地。
- MCP 工具改造。
- Realtime invalidation 改造。

验收：

- API 定向测试通过。
- 所有需求相关写路径不再引用 Prisma `Requirement` model。
- 代码搜索不得出现旧 repository 写入路径。

### 阶段 F：前端切换

任务：

- 更新 shared 类型消费。
- 文档列表支持 `kind`。
- 文档详情支持需求文档阅读。
- 需求页面改用统一文档数据。
- 图片上传 target 改为 `DOCUMENT`。
- 评论、附件、时间线 target 改为 `DOCUMENT`。
- Cmd+K 搜索结果区分普通文档和需求文档。
- 最近打开记录使用 `DOCUMENT + kind`。
- 转需求对话框落地。
- 取消需求化预检和确认对话框落地。

验收：

- `/documents` 能看到普通文档和非草稿需求。
- `/requirements` 只看到需求。
- 从文档转需求后两个入口都能看到同一 ID。
- 取消需求化后同一 ID 仍在 `/documents` 可见，并从 `/requirements` 移除。
- 需求编辑不会绕过需求权限。

### 阶段 G：旧模型清理

任务：

- 删除旧 `requirements` Prisma model。
- 新增 drop migration 删除旧 `requirements` 表；不得删除或改写历史 migration。
- 删除旧 `REQUIREMENT` target 写入分支。
- 删除旧 `contentMarkdownCache` 事实源语义。
- 删除旧 document link `REQUIREMENT` target 写入兼容。
- 更新文档、测试和种子数据。

要求：

- 清理必须在完整验收后执行。
- 不允许因为担心回滚而长期保留旧表业务入口。

## 16. 测试与验收

### 16.1 数据迁移测试

必须覆盖：

- 空库迁移。
- 只有普通文档的库。
- 只有需求的库。
- 普通文档和需求混合的库。
- DRAFT、CONFIRMED、ARCHIVED 需求状态映射。
- Tiptap 需求正文迁移。
- Markdown 需求正文迁移。
- 标签、评论、附件、时间线、参与关系迁移。
- 审计日志 target 迁移。
- `workflow_bindings.target_type` 不存在历史 `REQUIREMENT` 的预检；存在时迁移中止。
- `timeline_events.metadata` 中 target 语义字段的历史值标准化。
- 历史附件 `file_key` 兼容读取，新上传路径切到文档路径。
- `document_revisions` 基线版本生成。
- document link 指向需求的迁移。
- document link 自链接清理或拒绝。
- 工作项和事项关联需求的完整性。
- `versions.requirement_count` 重算或废弃策略验证。
- `intake_items.source_object.requirementId` 标准化为历史字段，不能作为活跃关联读取。
- `requirements.id` 与 `documents.id` 冲突预检。
- `document_code_history` 对旧编号、取消需求化编号、删除需求编号都能阻止复用。
- 历史编号 lookup 返回取消状态，但不能被新关联写入使用。
- 历史 migration 文件未改写的迁移审查。

### 16.2 后端单测

必须覆盖：

- 创建普通文档。
- 通用文档创建和导入接口不能通过传 `kind=REQUIREMENT` 绕过需求创建/转需求流程。
- 创建需求文档草稿。
- 普通空间成员和 `VIEWER` 可以读取非删除需求草稿，但不能编辑。
- TargetResolver 和 realtime permission 对需求草稿按空间成员可读放行，不再要求参与关系。
- 保存需求草稿为正式需求并分配 `REQ-n`。
- 需求草稿激活分配编号时写入 `document_code_history`，且并发保存不会重复分配。
- 普通文档不能有 `REQ-n`。
- 普通文档转需求。
- 已经是需求不能重复转需求。
- 非法权限不能转需求。
- 需求草稿取消需求化。
- `GENERAL + DRAFT` 文档可以发布为 `ACTIVE`，发布后按普通文档可见性进入文档库。
- 已分配 `REQ-n` 的需求取消需求化后旧编号不复用。
- 取消需求化后的历史 `REQ-n` 默认不能作为新工作项/事项/Bug 的需求引用。
- 取消需求化后的历史 `REQ-n` 在审计 lookup 中可追溯到原文档。
- 新建/更新任务、Bug、事项不能引用需求草稿、归档需求、无编号需求或已取消需求化文档。
- 有事项、任务、Bug 引用时默认拒绝取消需求化。
- `UNLINK_REFERENCES` 模式解除引用并写受影响对象 timeline。
- `UNLINK_REFERENCES` 同步标准化事项 `sourceObject` 中的历史需求来源字段。
- 转需求、取消需求化、版本变更、删除、恢复会同步维护或废弃版本需求计数。
- 需求版本变更级联规则。
- Trace version 冲突错误 payload 使用 `DOCUMENT + targetKind=REQUIREMENT` 或兼容语义字段，不再输出 canonical `targetType=REQUIREMENT`。
- 工作项不能关联普通文档作为需求。
- 评论、附件、标签、时间线使用 `DOCUMENT` target。
- timeline metadata 和 realtime payload 不再写入 `REQUIREMENT` target，需求语义通过 `kind=REQUIREMENT` metadata 表达。
- `object-code-lookup` 对 `REQ-n` 返回 `targetType=DOCUMENT + kind=REQUIREMENT`，旧 `type=REQUIREMENT` 仅作为编号族兼容字段。
- `audit_logs` 新写入使用 `DOCUMENT` target，并带需求 kind metadata。
- workflow binding 仍只创建和查询 `WORK_ITEM` binding，不因移除 `REQUIREMENT` target 产生文档工作流绑定。
- 所有目标枚举 schema 不再允许新写入 `REQUIREMENT`。
- `baseRevision` 冲突在文档保存、需求保存、转需求、取消需求化时都能阻止覆盖。
- Tiptap 需求在文档详情和需求详情都能正确渲染。
- 取消需求化后的 Tiptap 普通文档能继续按普通文档权限编辑。

### 16.3 前端测试

必须覆盖：

- `/documents` 默认展示普通文档和非草稿需求，不能展示需求草稿。
- `/requirements` 的草稿入口展示已持久化的需求草稿，并以草稿状态标识。
- kind 筛选。
- `linkedTargetType=DOCUMENT` 能筛出关联需求文档的普通文档。
- 文件夹筛选。
- 标签筛选。
- 需求徽标和 `REQ-n` 展示。
- 普通文档详情。
- 需求文档详情。
- 从文档打开需求视图。
- 文档转需求对话框。
- 取消需求化预检、拒绝、解除引用确认。
- 需求编辑保存后文档列表同步刷新。
- 需求文档保留并展示文件夹归属。
- `contentFormat=TIPTAP_JSON` 的需求不被 Markdown 渲染器误渲染。
- `GENERAL + TIPTAP_JSON` 文档可以阅读、编辑和保存，且不会被隐式转为 Markdown。

### 16.4 MCP 测试

必须覆盖：

- `pdm.document.search` 返回普通文档和需求文档。
- `pdm.document.get` 读取需求文档。
- `pdm.requirement.get` 读取同一 ID。
- `pdm.requirement.create` 创建 `kind=REQUIREMENT` 文档。
- `pdm.document.convert_to_requirement` 成功和失败路径。
- `pdm.document.cancel_requirement` 成功、引用拒绝、解除引用路径。
- 文档 MCP 写工具修改 `kind=REQUIREMENT` 文档时必须要求 `mcp:write:requirement`，只有 `mcp:write:document` 时拒绝。
- 转需求和取消需求化 MCP 工具必须同时校验 `mcp:write:document` 与 `mcp:write:requirement`。
- `pdm.comment.create` 对需求兼容输入最终写入 `DOCUMENT`。
- `pdm.timeline.list` 对需求兼容输入最终返回 `DOCUMENT + kind=REQUIREMENT`。
- scope 和业务权限共同生效。

### 16.5 E2E 验收

发布前 E2E 必须覆盖：

1. 创建普通文档，在 `/documents` 可见。
2. 创建有效需求，在 `/requirements` 和 `/documents` 均可见。
3. 创建需求草稿，可在 `/requirements` 草稿入口看到但不会出现在 `/documents` 默认列表，也不会产生用户可见时间线。
4. 普通空间成员可读已确认需求。
5. `VIEWER` 可读需求但不可编辑。
6. 需求所在文件夹的 `documentCount/descendantDocumentCount` 包含该需求，文件夹删除保护也包含需求文档。
7. 普通文档转需求后获得 `REQ-n`。
8. 转换后的同一 ID 可从 `/documents/:id` 和 `/requirements/:id` 打开。
9. 需求保存后文档列表实时刷新。
10. 文档库搜索能搜到需求正文。
11. 无引用需求可以取消需求化，同一 ID 仍在文档库，需求列表移除。
12. 有任务/Bug/事项引用时默认不能取消需求化。
13. 使用解除引用模式取消需求化后，关联对象的 `requirementId` 清空并留下时间线。
14. MCP 搜索和读取返回同一事实源。

## 17. 发布和回滚策略

### 17.1 发布策略

推荐维护窗口发布，不做长期在线双写。

发布步骤：

1. 发布前全量备份。
2. 进入维护模式。
3. 执行 schema migration。
4. 执行数据迁移脚本。
5. 执行迁移校验脚本。
6. 部署新 API 和 Web。
7. 执行 smoke test。
8. 退出维护模式。

### 17.2 回滚策略

只有迁移窗口内允许回滚到旧模型。

如果新代码已产生业务写入：

- 不建议自动回滚旧模型。
- 应优先修复新模型。
- 若必须回滚，需要使用迁移前备份恢复，并明确丢弃迁移后写入。

因此上线前必须把定向测试、迁移演练和 E2E 做足。

## 18. 后续迭代规则

为了避免再次出现模型分裂，后续新增内容型能力必须遵守：

### 18.1 内容型对象优先进入 DocumentKind

如果一个新对象主要是标题、正文、附件、评论、标签、搜索和阅读，那么优先作为 `documents.kind`。

示例候选：

- 测试计划。
- 发布说明。
- 会议纪要。
- 实施记录。

### 18.2 执行型对象仍保持独立

如果一个对象主要是状态流转、负责人、动作表单、截止时间、异常判断，它不应被塞进文档。

示例：

- 任务。
- Bug。
- 事项。
- 流程动作。

这些对象可以关联文档，但不是文档类型。

### 18.3 新 kind 准入标准

新增 `DocumentKind` 前必须回答：

- 是否需要独立编号？
- 是否需要专属权限？
- 是否需要专属状态或流转？
- 是否需要专属结构化字段？
- 是否需要在左侧导航有独立工作视图？
- 是否会被 MCP 作为独立工具操作？

如果答案都是否，使用标签、文件夹或模板，不新增 kind。

### 18.4 字段治理

由于本方案采用单表，必须控制字段膨胀：

- 核心可查询字段使用显式列。
- 不把核心业务字段塞进任意 JSON。
- 新字段必须说明适用 kind。
- 必须配套 CHECK 约束或服务层集中校验。
- 过多字段只服务单一新 kind 时，需要重新评审该 kind 是否真的应该进入当前阶段。

## 19. 主要风险与规避

### 风险 1：documents 表变成大杂表

规避：

- 严格控制 `DocumentKind`。
- 核心字段进入显式列。
- 分类诉求使用标签或模板。
- 新 kind 必须经过事实源确认。

### 风险 2：需求权限被文档页绕过

规避：

- 所有写操作按 `kind` 分派权限。
- 需求正文保存也走需求权限。
- 后端统一裁决，前端只展示结果。

### 风险 3：旧 requirements 表残留导致双事实源

规避：

- 新代码不得写旧表。
- 旧表只读保留一个发布周期。
- 后续 drop migration 删除。
- CI 增加静态检查，禁止业务代码导入旧 Prisma model。

### 风险 4：普通文档错误关联为需求

规避：

- 数据库 trigger 或复合约束校验 `requirement_id`。
- 服务层集中校验。
- 单测覆盖。
- 取消需求化和解除引用必须同事务执行；解除失败时不得先把文档改为普通文档。

### 风险 5：编号历史表变成事实源扩展表

规避：

- `document_code_history` 只保存编号占用和状态，不保存正文、版本、负责人、优先级等需求业务字段。
- 需求列表、详情、权限、交付关联都不得从 `document_code_history` 读取业务事实。
- 只有编号分配、历史 lookup、审计追溯、防复用校验可以读取该表。

### 风险 6：迁移影响面大

规避：

- 维护窗口迁移。
- 迁移演练。
- 全量备份。
- 校验脚本。
- 发布前真实依赖 E2E。

### 风险 7：只改 TargetType，漏掉其他 target 枚举

规避：

- shared 和 Prisma 中所有 `*TargetType` 统一建清单。
- CI 增加静态检查，禁止新业务写入 `REQUIREMENT` target。
- 迁移校验同时查 comments、attachments、tag assignments、object participants、timeline events、timeline metadata、document links、workflow bindings、audit logs。

### 风险 8：Tiptap 需求进入文档库后无法稳定渲染

规避：

- 文档详情按 `contentFormat` 分派 renderer。
- chunks 和 MCP 只依赖可重建的 `content_text` 与 revision chunks。
- 旧 `content_markdown_cache` 只作为派生缓存，不作为事实源。

### 风险 9：本地方案未回写 Notion，后续仍按旧模型实现

规避：

- 阶段 A 必须先回写 Notion 并标注旧双对象模型已被 supersede。
- 主 agent 派发实现任务前必须确认 Notion 产品方案、技术方案、跨端契约和 DOC 实施计划均已更新。
- 子 agent 读取 Notion 时，如果仍看到 `requirements` 与 `documents` 双核心对象作为当前方案，应立即停止并升级给主 agent，而不是自行按本地 Markdown 推断实现。
- 本地 Markdown 只能作为整改蓝图；Notion 回写完成前不能作为唯一事实源启动代码整改。

## 20. 最终验收定义

本次整改完成后，必须满足：

- Notion 事实源已回写并明确取代旧的需求/文档双对象方案。
- 系统中不存在独立需求正文事实源。
- 一条需求只有一条 `documents` 记录。
- `requirementId === documentId`。
- `/documents` 默认展示普通文档和非草稿需求。
- `/requirements` 是需求专用视图，底层读取 `documents.kind=REQUIREMENT`。
- 普通文档可以转为需求，转换不复制正文，不创建第二个对象。
- 需求可以取消需求化，转换回普通文档不复制正文，不创建第二个对象。
- 取消需求化不会破坏事项、任务、Bug 的需求引用约束；有引用时必须拒绝或显式解除引用。
- 已取消或删除的旧 `REQ-n` 通过 `document_code_history` 保证不复用且可审计追溯。
- 所有空间成员可读非删除需求文档，包括需求草稿、正式需求和归档需求。
- 需求草稿不进入 `/documents` 默认列表，且空草稿创建不写用户可见时间线。
- 需求写权限仍受需求规则控制。
- 评论、附件、标签、时间线 canonical target 为 `DOCUMENT`。
- 审计日志、参与关系、文档链接也不再新写入独立 `REQUIREMENT` target。
- MCP 文档搜索能搜索需求。
- MCP 需求工具和文档工具读到同一事实源。
- 旧 `requirements` 表不再参与业务读写，并已规划删除。
- 历史 migration 未被删除或改写，旧表清理通过新增 drop migration 完成。

只有满足以上条件，才算完成“需求属于文档”的彻底整改。
