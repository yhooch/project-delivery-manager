# 文档上下文库方案与实施计划

> 状态：本地讨论稿与本轮落地记录，待用户确认后再回写 Notion 事实源。
>
> 来源：2026-05-27 文档页功能头脑风暴。当前 Notion 事实源只确认 `/documents`
> 是独立空白文档子系统入口；本文描述的是后续实现提案和本地落地口径，不代表既有已确认产品范围。

## 1. 背景与目标

当前系统已经有需求、事项、任务、Bug、版本、时间线、标签、业务编号、实时刷新和
MCP 能力。新增文档页的主要目标不是做一个完整在线文档编辑器，而是解决用户在与大模型
协作过程中产生的结论、计划、方案、纪要等内容无法快速沉淀、检索和复用的问题。

文档页定位为“面向人和 Agent 的项目上下文沉淀库”：

- 快速把大模型沟通结果、外部 Markdown、Word 文档和粘贴文本落地到系统。
- 支持模型后续搜索、读取、创建、追加和替换文档内容。
- 支持用户对文档做常规管理，包括标题、正文、标签、关联资源、评论、归档和删除。
- 明确标识文档是否由模型创建或最近由模型修改，降低用户误判。
- 提供接近 Notion 页面阅读体验，但弱化在线编辑，不做多人协同编辑和块级编辑器。
- 让文档能快速进入关联资源、关联文档和资源页，成为后续模型工作的上下文入口。

## 2. 产品范围

### 2.1 本地提案/本轮落地要做

> 本节是当前仓库本地方案与实现记录；在回写 Notion 前，不作为正式需求事实源。

- 空间级文档库。
- 文档列表、搜索、筛选、归档。
- 文档详情阅读页，重点优化阅读和关联跳转体验。
- Markdown 上传、Markdown 粘贴、Word `.docx` 上传导入。
- 模型通过 MCP 创建、追加、替换和读取文档。
- 用户可以通过编辑入口修改标题、正文、标签和关联资源。
- 文档正文以 Markdown 为主要事实源，并生成纯文本用于搜索。
- 文档不维护独立摘要字段；检索命中片段从正文动态截取。
- 文档关联版本、需求、事项、任务、Bug 和其他文档。
- 文档评论、附件、时间线。
- 文档标签复用当前空间标签能力。
- 空间级共享文档目录树：文件夹用于组织和导航，文档至多归属一个文件夹，未归档文档保留为空 `folderId`。
- 文档进入 Cmd+K 搜索范围，支持按标题、正文命中片段和关联资源快速打开。
- 文档创建来源和最近编辑来源清晰标记：用户导入、用户粘贴、用户编辑、模型创建、模型修改。
- 基于 `revision` / `baseRevision` 的简单并发保护。

### 2.2 本地提案/本轮落地不做

- 不做 Notion 式块编辑器。
- 不做多人实时协同编辑、光标协同、CRDT/OT。
- 不做复杂在线富文本编辑。
- 不做模板管理。
- 不做文件夹级私有权限、单文件夹 ACL、多位置挂载、递归删除或外链分享；目录树只承担空间内组织能力。
- 不做单篇文档私有权限、分享链接、外部公开访问。
- 不做文档审批流。
- 不做完整版本 diff 或复杂合并。
- 不把文档功能扩张为测试计划、发布单、实施记录、运维记录等独立业务模块。
- 不强依赖向量数据库；第一版优先 PostgreSQL 全文检索和结构化过滤。

## 3. 核心概念

### 3.1 文档

文档是可被用户和模型检索、阅读、关联和评论的上下文对象。

文档正文第一版采用 Markdown 事实源：

- `contentMarkdown`：正文事实源。
- `contentText`：从 Markdown 提取的纯文本，用于搜索、命中片段和模型检索。
- 不维护 `summary` 字段。

Word 导入后转换为 Markdown；原始 Word 文件作为来源附件保留。

### 3.2 资源

资源是文档可关联、可跳转、可作为上下文入口的系统对象。第一版资源范围：

- `DOCUMENT`
- `VERSION`
- `REQUIREMENT`
- `INTAKE_ITEM`
- `WORK_ITEM`

其中任务和 Bug 继续通过 `WORK_ITEM` 承接，展示时根据 `workItem.type` 显示 `TASK-n`
或 `BUG-n`。

### 3.3 资源页

资源页是围绕一个资源聚合上下文的页面或详情入口。第一版不强制重构现有任务、Bug、
需求等页面路由，但文档详情页本身必须具备资源页体验：

- 展示正文。
- 展示关联资源。
- 展示关联文档。
- 展示评论、附件和时间线。
- 支持快速跳转到关联资源的现有详情页或详情抽屉。

后续如需要统一资源页路由，可新增 `/resources/:targetType/:targetId`，由后端
`TargetResolverService` 解析并返回资源基础信息、关联文档、关联对象和可跳转 URL。

## 4. 用户体验方案

### 4.1 文档首页

`/documents` 继续作为独立文档子系统入口，不复用主应用 `(app)` 的 Sidebar/TopBar，
而是使用文档子系统自有顶栏，保留当前登录态、组织和空间上下文。

页面布局（已实现）：

- 子系统顶栏（列表与详情共用）：文档入口标识与当前空间名、返回工作台。
  顶栏不承载导入/粘贴创建入口，避免详情页出现列表级创建操作。
- 页面创建操作区：位于文档首页说明文案下方、搜索框上方，按“粘贴内容”“导入文档”顺序展示创建入口。
- 列表控制条：搜索框（输入防抖）、排序（最近编辑 / 最近创建 / 标题）、显示密度切换（舒适 / 紧凑，本地记忆偏好）；
  快速筛选（全部、我创建、模型生成、通过模型修改、已归档）单独一行。
- 列表行：来源图标（用户 / 模型）+ 标题 + 归档标记 + revision；次行展示创建信息
  （创建人、创建工具/来源、创建时间）、关联业务对象（版本 / 需求 / 事项 / 任务 / Bug；文档型关联不在列表展示）与标签。
  为突出“最近沉淀”，列表行只展示创建信息，最近编辑信息在详情页查看。
- 按日期排序（最近编辑 / 最近创建）时按 今天 / 本周 / 本月 / 更早 分组；超过单页数量提供“加载更多”。
- 空态：保留暂无文档说明和图标，不再重复展示导入/粘贴 CTA。
- 左侧文档目录：仅在 `/documents` 列表页展示空间级共享文件夹树；虚拟入口固定为全部文档、我的文档、已归档。文件夹树首次加载默认折叠有子级的节点，但会自动展开当前选中文件夹或当前文档所属文件夹的祖先链；标题行固定展示“包含子目录”开关，未选中文件夹时禁用并说明原因，选中文件夹时按 URL 状态开关；标题行提供树级“展开全部 / 收起全部”，收起全部仍保留当前选中项祖先链可见。目录支持选择文件夹、单个文件夹拖拽移动/同级排序，以及将单个或多个已选文档批量拖入目标文件夹。

主按钮文案使用“导入”，弱化“新建文档”。

### 4.2 文档详情页

文档详情页是第一版体验重点，参考 Notion 的阅读页面，但不实现块编辑器。

结构建议：

- 顶部返回操作：详情内容区顶部提供 sticky“返回文档列表”条，固定在文档子系统顶栏下方，长文档滚动到底部时仍可见；返回目标优先回到用户进入详情前的 `/documents` 列表 URL，保留目录、文件夹、包含子目录和搜索筛选 query；没有可用历史上下文时按文档文件夹、归档状态、全部文档依次降级。左侧本文目录跳转到正文标题锚点时，标题滚动偏移需要覆盖子系统顶栏和 sticky 返回条。
- 顶部面包屑：组织 / 项目空间 / 文档。
- 标题区：
  - 文档标题。
  - 状态：活跃 / 已归档。
  - 来源标记：用户导入 / 用户粘贴 / 模型生成。
  - 创建信息：创建人、创建工具/来源、创建时间。
  - 最近编辑信息：最近编辑人、最近编辑工具/来源、最近更新时间。
  - MCP client 名称需要展示具体工具名，例如 `Codex`、`Claude Code`；缺失时降级显示 `MCP`。
- 关联资源区：
  - 版本、需求、事项、任务、Bug、其他文档以 chip 展示。
  - 点击 chip 进入对应资源详情页或打开对应详情抽屉。
- 正文区：
  - Markdown 渲染阅读模式，阅读宽度受限以保证可读行长（约 70 字符）。
  - 标题自动生成目录锚点。
  - 表格以语义化 `table` 渲染（表头加强），不拆成独立行卡片。
  - 正文中的 `REQ-12`、`INTAKE-8`、`TASK-42`、`BUG-17` 自动识别为可点击链接。
  - Markdown 渲染必须做 XSS 清洗；链接只允许 `http`、`https`、`mailto`、系统内部链接和受控附件链接。
  - 远程图片默认不直接内嵌渲染；第一版优先展示为可点击链接或占位，避免绕过附件权限。
- 左侧本文目录：
  - 基于当前文档 Markdown 标题实时生成；编辑态基于编辑草稿实时计算。
  - 该区域只表示当前文档的标题目录，不展示文档库文件夹树。
- 右侧上下文栏：
  - 关联资源。
  - 关联文档。
  - 标签。
  - 附件：计数 + 跳转到正文下方附件区，不在右栏重复展示完整列表。
  - 最近评论：计数 + 跳转到正文下方评论区，不在右栏重复展示完整内容。
  - 时间线入口。
  - 创建信息、最近编辑信息、来源和 revision。
- 操作区：
  - 编辑。
  - 重新导入 / 替换正文。
  - 评论。
  - 归档。
  - 删除。

移动端首版可将右侧上下文栏下沉为页面底部信息卡，保证信息完整可见且不产生横向溢出；后续再评估是否改为抽屉。

### 4.3 用户编辑入口

虽然不重点做在线编辑，但需要提供常规编辑能力。

点击“编辑”后进入轻量编辑模式：

- 标题变为输入框。
- 正文变为 Markdown 源码编辑区，并提供“源码 / 预览”切换（预览复用阅读渲染）。
- 可编辑标签和关联资源。
- 保存时提交 `baseRevision`。
- 保存成功后退出编辑模式，写时间线。
- 如果期间模型或其他用户更新了文档，后端返回冲突，前端提示刷新后再编辑。

第一版不做自动合并和复杂冲突解决。

### 4.4 重新导入

文档详情页支持“重新导入”：

- 上传新的 `.md` 或 `.docx`。
- 转换后替换当前正文。
- `sourceType` 保留最初创建来源，`lastEditedVia` 更新为 `USER`。
- 写入新 revision 和时间线。

## 5. 导入与正文处理

### 5.1 Markdown 导入

支持两种入口：

- 上传 `.md` 文件。
- 粘贴 Markdown 或纯文本。

处理规则：

- 如正文第一行是一级标题，则默认提取为标题。
- 否则标题使用文件名或用户输入标题。
- `contentMarkdown` 保存原始 Markdown。
- `contentText` 从 Markdown 中提取纯文本。
- 正文图片第一版只允许受控引用；远程图片保留为文本链接或占位，避免绕过附件权限。
- 上传文件需校验扩展名、MIME、大小和字符编码；超出限制时拒绝导入，不创建半成品文档。

### 5.2 Word 导入

支持上传 `.docx`。

处理规则：

- 后端将 `.docx` 转换为 Markdown。
- 保留标题、段落、标题层级、列表、表格等常见结构。
- 图片处理采取保守策略：
  - 能安全提取并绑定到当前文档的图片，转为文档附件并使用受控引用。
  - 无法可靠处理的图片使用占位说明，不保存 base64。
- 原始 `.docx` 作为文档来源附件保留。
- 转换失败时文档不落库，返回明确错误。
- 仅支持 `.docx`，不支持 `.doc`、`.docm` 或含宏格式。
- 导入前需要校验文件大小、MIME、zip 解包安全和转换超时，避免超大文档或异常压缩包拖垮 API。

依赖建议：

- 后端可评估引入 `mammoth` 读取 `.docx`。
- HTML 到 Markdown 如需依赖，可评估 `turndown` 或在第一版先做受控简化转换。
- 依赖新增必须由主 agent 统一评审和修改 `package.json`。

## 6. 模型创建与更新

### 6.1 模型创建文档

模型可以通过 MCP 将对话结论、计划、方案、纪要等直接创建为文档。
这里的业务操作者仍是授权用户，MCP client 只是工具来源和入口，不替代用户身份；展示时应表达为“用户通过某个工具创建/修改”，例如“`Ada Zhang` 通过 `Codex` 创建”。

要求：

- 正文必须以 Markdown 输入。
- 必须携带 `organizationId`、`spaceId`、`idempotencyKey`。
- 支持关联版本、需求、事项、任务、Bug 或其他文档。
- 创建成功后标记：
  - `sourceType = MCP_CREATED`
  - `createdVia = MCP_CLIENT`
  - `createdMcpClientId = ...`
  - `lastEditedVia = MCP_CLIENT`
  - `lastEditedMcpClientId = ...`

### 6.2 模型追加内容

适用场景：把新的讨论结论追加到某篇文档末尾。

要求：

- 输入 `documentId`、`appendMarkdown`、`baseRevision`、`idempotencyKey`。
- 后端在当前正文末尾追加内容，并生成新 revision。
- 如果 `baseRevision` 过旧，返回冲突，不自动覆盖。

### 6.3 模型替换正文

适用场景：模型基于全文生成新的整理稿。

要求：

- 输入 `documentId`、完整 `contentMarkdown`、`baseRevision`、`idempotencyKey`。
- 后端整体替换正文。
- 必须写 revision、时间线和审计。
- 发生 revision 冲突时拒绝保存。

第一版不做复杂局部 patch。局部 patch 容易带来错误上下文覆盖和合并复杂度，后续如确有需要再单独设计。

## 7. 模型标记与可追溯性

文档需要同时保留“创建来源”和“最近编辑来源”。

示例展示：

- `Ada Zhang` 粘贴 Markdown 创建 · 5月26日 03:15；`Ada Zhang` 手动编辑 · 5月26日 03:30。
- `Ada Zhang` 粘贴 Markdown 创建 · 5月26日 03:15；`Ada Zhang` 通过 `Claude Code` 修改 · 5月27日 03:04。
- `Ada Zhang` 通过 `Codex` 创建 · 5月25日 03:15；`Ada Zhang` 手动编辑 · 5月26日 10:20。
- `Ada Zhang` 通过 `Codex` 创建 · 5月25日 03:15；`Ada Zhang` 通过 `Claude Code` 修改 · 5月27日 03:04。

展示口径：

- 用户名来自授权用户；如果用户已不可解析，前端降级显示“未知成员”。
- 具体工具名来自 MCP OAuth client，例如 `Codex`、`Claude Code`；如果 client 已不可解析，前端降级显示 `MCP`。
- `sourceType = MCP_CREATED` 说明文档由模型工具生成，不表示工具是业务创建人。

数据口径：

```ts
type DocumentSourceType =
  | "UPLOAD_DOCX"
  | "UPLOAD_MARKDOWN"
  | "PASTE_MARKDOWN"
  | "PASTE_TEXT"
  | "MCP_CREATED";

type DocumentActorType = "USER" | "MCP_CLIENT";

type DocumentStatus = "ACTIVE" | "ARCHIVED";

type DocumentChangeType =
  | "CREATED"
  | "IMPORTED"
  | "REIMPORTED"
  | "METADATA_UPDATED"
  | "CONTENT_EDITED"
  | "CONTENT_APPENDED"
  | "CONTENT_REPLACED"
  | "ARCHIVED"
  | "RESTORED"
  | "DELETED";
```

列表行只展示创建信息（创建人、创建工具/来源、创建时间）以突出沉淀来源，并通过来源图标区分用户与模型；详情页标题区和上下文栏展示完整来源信息（创建与最近编辑），避免用户只看到“模型生成”却无法判断具体用户和工具。

## 8. 数据模型草案

### 8.1 Document

```ts
type Document = {
  id: string;
  organizationId: string;
  spaceId: string;
  title: string;
  contentMarkdown: string;
  contentText: string;
  sourceType: DocumentSourceType;
  sourceAttachmentId?: string;
  status: DocumentStatus;
  revision: number;
  createdById: string;
  createdVia: DocumentActorType;
  createdMcpClientId?: string;
  lastEditedById: string;
  lastEditedVia: DocumentActorType;
  lastEditedMcpClientId?: string;
  lastEditedAt: string;
  archivedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

API / DTO 需要额外返回用于展示的派生字段：

```ts
type DocumentDto = Document & {
  createdByName?: string;
  createdMcpClientName?: string;
  lastEditedByName?: string;
  lastEditedMcpClientName?: string;
};
```

这些展示字段不要求冗余进 `documents` 表；后端查询时可根据 `createdById`、`lastEditedById` 从 `users`
补齐用户名，根据 `createdMcpClientId`、`lastEditedMcpClientId` 从 `mcp_oauth_clients` 补齐 client 名称。

默认建议第一版 `spaceId` 必填，只做空间级文档。组织级文档后续再扩展，避免第一版权限和检索上下文过宽。

### 8.2 DocumentRevision

```ts
type DocumentRevision = {
  id: string;
  organizationId: string;
  spaceId: string;
  documentId: string;
  revision: number;
  title: string;
  contentMarkdown: string;
  contentText: string;
  changeType: DocumentChangeType;
  actorType: DocumentActorType;
  actorUserId: string;
  mcpClientId?: string;
  requestId?: string;
  createdAt: string;
};
```

第一版不需要提供复杂 diff，但保存 revision 可以支持：

- 并发保护。
- 审计追溯。
- 后续恢复历史版本。
- 模型更新来源判断。

### 8.3 DocumentLink

```ts
type DocumentLinkTargetType =
  | "DOCUMENT"
  | "VERSION"
  | "REQUIREMENT"
  | "INTAKE_ITEM"
  | "WORK_ITEM";

type DocumentLink = {
  id: string;
  organizationId: string;
  spaceId: string;
  documentId: string;
  targetType: DocumentLinkTargetType;
  targetId: string;
  createdById: string;
  createdAt: string;
  deletedAt?: string;
};
```

规则：

- 关联目标必须和文档在同一组织、同一空间，除非后续明确支持跨空间文档。
- 关联文档也必须在同一空间。
- 删除关联采用软删除。
- 未删除记录内建议建立唯一约束：`documentId + targetType + targetId`。

### 8.4 DocumentChunk

为模型检索和正文命中片段服务，建议第一版引入轻量 chunk。

```ts
type DocumentChunk = {
  id: string;
  organizationId: string;
  spaceId: string;
  documentId: string;
  revision: number;
  ordinal: number;
  headingPath?: string;
  contentText: string;
  createdAt: string;
};
```

生成规则：

- 按 Markdown 标题和段落切分。
- 每次正文更新后重建当前 revision 的 chunks。
- 搜索命中返回 chunk 片段，而不是维护独立摘要。

## 9. 权限方案

第一版建议只做空间级文档权限：

- 空间成员可读空间内文档。
- `VIEWER` 只读。
- 非 `VIEWER` 空间成员可导入和创建文档。
- 创建者、文档最近负责人（如后续有 owner 字段）、`PM`、`SPACE_ADMIN` 可编辑文档。
- `SPACE_ADMIN`、`PM`、创建者可归档和删除文档。
- 评论权限复用文档读权限；如后续需要限制评论，再扩展。
- MCP 写操作即使拥有 scope，也必须通过同样的空间角色和对象权限裁决。

需要注意：模型写入时，真正操作者仍是授权用户，MCP client 只是来源和入口，不替代业务权限。

## 10. 标签、评论、附件和时间线

### 10.1 标签

文档标签复用当前空间标签能力。

需要扩展：

- `TagTargetType` 增加 `DOCUMENT`。
- 文档列表支持 `tagIds` 和 `tagMatch=ANY` 筛选。
- 标签筛选候选池增加 `DOCUMENT` scope。

### 10.2 评论

文档支持评论。

需要扩展：

- `CommentTargetType` 增加 `DOCUMENT`。
- 文档详情展示评论列表和评论输入。
- 模型可通过 MCP 给文档新增评论。

### 10.3 附件

文档支持附件，至少用于：

- 保留导入来源文件。
- 保存 Word 导入中提取出的图片。
- 用户补充附件。

需要扩展：

- `AttachmentTargetType` 增加 `DOCUMENT`。
- 附件上传下载继续走 API 内网 MinIO 链路，不签发浏览器直连 MinIO URL。

### 10.4 时间线

文档写操作需要写时间线：

- 用户导入文档。
- 用户粘贴创建文档。
- 模型创建文档。
- 用户编辑正文。
- 模型追加内容。
- 模型替换正文。
- 用户重新导入。
- 标签调整。
- 关联资源调整。
- 评论新增。
- 附件新增。
- 归档和恢复。

需要扩展：

- `TargetType` 增加 `DOCUMENT`，或新增文档专用 target 解析分支。
- 时间线标题需要展示模型来源和 MCP client 名称。

## 11. 搜索和模型上下文检索

### 11.1 用户搜索

文档首页支持：

- 标题搜索。
- 正文搜索。
- 标签筛选。
- 关联资源筛选。
- 来源筛选：用户导入、用户粘贴、模型创建、最近由模型修改。
- 状态筛选：活跃、已归档。

第一版推荐使用 PostgreSQL 全文检索或受控 `ILIKE` 起步。文档量和检索质量需求上来后，再评估 embedding / vector search。

### 11.2 模型检索

MCP 搜索需要返回适合模型消费的结果：

- 文档 ID。
- 标题。
- 来源和最近编辑来源。
- 关联资源基础信息。
- 命中 chunk 片段。
- 更新时间。

不返回维护型摘要字段。

`document.get` 支持：

- 返回全文 Markdown。
- 返回 chunks。
- 返回关联资源、标签、评论概览和时间线概览。

如文档过长，工具可支持 `contentMode = "full" | "chunks"` 或分页读取 chunks。

## 12. API 与契约草案

### 12.1 REST API

建议接口：

- `GET /spaces/:spaceId/document-folders`
- `POST /spaces/:spaceId/document-folders`
- `POST /spaces/:spaceId/document-folders/reorder`
- `PATCH /document-folders/:folderId`
- `POST /document-folders/:folderId/move`
- `POST /document-folders/:folderId/reorder`
- `DELETE /document-folders/:folderId`
- `GET /spaces/:spaceId/documents`
- `PATCH /spaces/:spaceId/documents/folder`
- `POST /spaces/:spaceId/documents/import-markdown`
- `POST /spaces/:spaceId/documents/import-docx`
- `POST /spaces/:spaceId/documents/paste`
- `GET /documents/:documentId`
- `PATCH /documents/:documentId/metadata`
- `PATCH /documents/:documentId/folder`
- `PATCH /documents/:documentId/content`
- `POST /documents/:documentId/content/append`
- `POST /documents/:documentId/reimport`
- `POST /documents/:documentId/archive`
- `POST /documents/:documentId/restore`
- `DELETE /documents/:documentId`
- `GET /documents/:documentId/revisions`
- `GET /documents/:documentId/links`
- `PATCH /documents/:documentId/links`
- `GET /documents/:documentId/chunks`
- `GET /document-links?targetType=...&targetId=...`

其中正文更新类接口必须携带 `baseRevision`。

### 12.2 MCP tools

建议第一版工具：

- `pdm.document_folder.list`
- `pdm.document_folder.create`
- `pdm.document_folder.update`
- `pdm.document_folder.move`
- `pdm.document_folder.delete`
- `pdm.document.search`
- `pdm.document.get`
- `pdm.document.create_from_markdown`
- `pdm.document.append_content`
- `pdm.document.replace_content`
- `pdm.document.update_metadata`
- `pdm.document.link_resources`
- `pdm.document.move_to_folder`

目录相关补充：

- `pdm.document.search` 支持 `folderId` 与 `includeDescendants`，用于搜索指定文件夹及其子树。
- `pdm.document.create_from_markdown` 支持 `folderId`，模型可直接把文档创建到目标目录。
- `pdm.document_folder.create` 创建根级目录时省略 `parentId`；`pdm.document_folder.move` 移动到根级时传 `parentId: null`。
- 拖拽落地使用 REST 契约：文件夹同级排序走 `POST /spaces/:spaceId/document-folders/reorder`，多个文档拖入文件夹走 `PATCH /spaces/:spaceId/documents/folder`，避免前端循环调用单项移动接口。
- 目录写工具复用 `mcp:write:document` scope；读目录复用 `mcp:read`。

文档评论不新增专用 MCP tool，复用既有 `pdm.comment.create`，但需要把 `DOCUMENT`
加入评论目标类型。

写工具通用要求：

- 必须携带 `organizationId`、`spaceId`、`idempotencyKey`。
- 更新正文必须携带 `baseRevision`。
- 支持 `dryRun`。
- 复用现有业务权限、审计、时间线和 realtime invalidation。

新增 MCP scope 建议：

- `mcp:read` 可覆盖文档读取和搜索。
- 新增 `mcp:write:document` 覆盖文档创建、追加、替换、元信息更新、关联资源调整。
- 文档评论可复用 `mcp:write:comment`。

## 13. 前端路由和组件

建议路由：

- `/documents`：文档首页。
- `/documents/:documentId`：文档详情/资源页。

主要组件（已实现）：

- `DocumentShell`：文档子系统外壳与共用顶栏，承载导入/粘贴对话框、返回工作台、Cmd+K；列表页渲染文档目录树，详情页不渲染文件夹树。
- `DocumentCreateProvider` / `useDocumentCreate`：列表页页面创建操作区触发 `DocumentShell` 内的导入/粘贴对话框。
- `DocumentsPage`、`DocumentList`（含 `DocumentRow`、`DocumentRowLinks`）：列表保留详情链接，默认不展示多选控件；点击“选择”进入选择模式后显示多选控件，文档拖拽手柄保持可用；拖拽已选文档时按当前选择批量移动，拖拽未选中文档时只移动该文档。
- `DocumentImportDialog`、`DocumentPasteDialog`。
- `SourceBadge`、`ActorBadge`：来源与操作者标记（详情页与原列表沿用）。
- `DocumentDetailPage`、`DocumentMarkdownViewer`、`DocumentTocRail`、`DocumentContextRail`：详情页在内容区顶部显式提供 sticky 返回文档列表入口，固定在文档子系统顶栏下方，并复用最近一次 `/documents` 列表 URL 作为返回目标。
- `DocumentManagementSections`：详情页评论与附件区。
- `DocumentDeleteDialog`。

文档历史版本 UI（`DocumentRevisionHistory`）后续再做；revision 已落库可支撑。

实现要求：

- 可见文案全部进入 `zh-CN` / `en-US`。
- UI E2E 使用 `data-testid`，不依赖中文/英文文案。
- 浅色/深色下 Markdown 正文、代码块、表格、引用、链接和标记徽章均可读。
- 列表排序透传后端 `sortBy` / `sortOrder`；日期分组与显示密度为前端能力，导入/粘贴入口位于列表页搜索框上方的页面创建操作区。
- 文档目录拖拽只在 `/documents` 列表页启用；虚拟视图不是 drop target。文件夹首版只支持单个文件夹拖动/排序，不做批量文件夹拖拽，避免多子树循环和排序冲突。
- 下拉控件统一复用 `SelectMenu`，与系统其他列表筛选保持一致。
- Cmd+K 增加当前空间“文档”分组；输入业务编号时继续优先走对象编号 lookup，输入普通关键词时可同时搜索文档标题和正文命中片段。
- Markdown 渲染器和清洗器如需新增依赖，必须由主 agent 统一评审。

## 14. 实时刷新

文档写操作需要接入现有 realtime invalidation：

失效 key 建议：

- `document-list`
- `document-directory`
- `document-detail`
- `document-links`
- `document-comments`
- `document-attachments`
- `document-timeline`
- `resource-documents`

刷新规则：

- 文档详情页收到实时事件后静默刷新非编辑区。
- 如果用户正在编辑正文，不覆盖未保存输入。
- 如果当前文档被模型更新，编辑区外可显示轻量提示：文档已有新版本。
- 保存时由 `baseRevision` 做冲突校验。

## 15. 实施计划

### DOC-A：事实源回写与范围冻结

目标：

- 将本文确认后的范围回写 Notion `03/04/04.1/04.2/04.3/05/06/13`。
- 明确文档第一版是空间级上下文库，不是在线协同文档系统。
- 冻结 `DOCUMENT` target、文档 source、actor、revision、link、chunk、MCP tool 和错误码。

验收：

- Notion 事实源已同步。
- `packages/shared` 待实现 schema 范围清晰。
- 待确认项已处理或显式标注为后置。

### DOC-B：数据模型、迁移与 shared 契约

目标：

- 新增 `documents`、`document_revisions`、`document_links`、`document_chunks`。
- 新增 `document_folders`，并在 `documents` 上增加可空 `folderId`。
- 扩展 `TargetType`、`CommentTargetType`、`AttachmentTargetType`、`TagTargetType` 支持 `DOCUMENT`。
- 新增 shared schema 和 OpenAPI 输出。
- 增加文档导入大小、正文大小和支持 MIME 的配置项。

重点：

- `spaceId` 第一版必填。
- `revision` 递增和 `baseRevision` 校验。
- 文档软删除、归档和索引。
- 文档标签、评论、附件、时间线目标解析。
- 目录树深度、同级重名、移动防循环、删除空目录约束。
- 文件夹根级语义必须明确：创建根级文件夹时不传 `parentId`；移动文件夹到根级时使用 `parentId: null`。
- 文档列表支持 `folderId`、`includeDescendants` 和 `unfiled`。
- 拖拽排序契约：文件夹同级重排使用 `POST /spaces/:spaceId/document-folders/reorder` 一次请求提交完整同级顺序；文档批量拖拽使用 `PATCH /spaces/:spaceId/documents/folder` 一次请求移动多个文档到目标文件夹。UI 首版不支持把文档拖到全部文档、我的文档、已归档等虚拟入口，也不把拖拽作为唯一移动方式。
- `document_links` 未删除记录唯一约束和按目标反查索引。
- `document_chunks` 按 `spaceId + documentId + revision + ordinal` 排序索引，以及按正文搜索所需索引。

验收：

- Prisma validate/generate 通过。
- shared 单测覆盖 schema。
- 迁移可在空库和已有库执行。

### DOC-C：后端文档领域与权限

目标：

- 新增 `document` 模块。
- 实现文档列表、详情、元信息更新、正文更新、追加、替换、归档、恢复、删除。
- 接入权限、时间线、审计和 realtime。

重点：

- `baseRevision` 冲突保护。
- 用户和 MCP 写入 actor/source 标记。
- 非 `VIEWER` 创建；创建者、`PM`、`SPACE_ADMIN` 编辑。
- 文档关联目标必须同空间。

验收：

- 后端单测覆盖权限、revision 冲突、模型修改标记、时间线和 realtime 发布。

### DOC-D：导入管线

目标：

- Markdown 文件上传导入。
- Markdown/纯文本粘贴创建。
- Word `.docx` 上传导入。
- 原始文件作为来源附件保留。
- 导入后生成 `contentText` 和 chunks。

重点：

- `.docx` 转 Markdown 的依赖评估和安全限制。
- 不保存 base64 图片。
- 导入失败不落半成品。
- MIME、大小和附件数量沿用现有附件限制。

验收：

- Markdown 导入保留标题、列表、表格、代码块等常见结构。
- Word 导入可生成可读 Markdown。
- 转换失败返回明确错误。
- 超大文件、不支持 MIME、`.docm` 或异常压缩包会被拒绝且不会创建文档。

### DOC-E：前端文档首页与详情阅读体验

目标：

- 实现 `/documents` 列表、搜索、筛选、导入入口。
- 实现 `/documents/:documentId` 阅读页。
- 实现 Notion 风阅读体验、目录、右侧上下文栏、来源标记、关联资源 chip。
- 实现 Markdown XSS 清洗、受控链接渲染和远程图片降级展示。

重点：

- 文档正文展示优先级高于编辑。
- 业务编号自动链接。
- 关联资源快速跳转。
- Cmd+K 能搜索并打开文档。
- 中英文、浅色/深色可读。

验收：

- 用户能导入文档并进入详情阅读。
- 用户能从文档跳转到关联需求、任务、Bug、版本和其他文档。

### DOC-F：用户轻量编辑与重新导入

目标：

- 提供编辑入口。
- 支持用户修改标题、正文 Markdown、标签、关联资源。
- 支持重新导入替换正文。

重点：

- 编辑模式不做协同。
- 保存使用 `baseRevision`。
- 冲突时阻止覆盖。
- 保存后写 revision 和时间线。

验收：

- 用户可修改文档。
- 模型更新后用户基于旧 revision 保存会被拒绝。
- 用户修改模型创建文档后，来源标记保持正确。

### DOC-G：MCP 文档工具

目标：

- 实现 `pdm.document_folder.list/create/update/move/delete`。
- 实现 `pdm.document.search/get/create_from_markdown/append_content/replace_content/update_metadata/link_resources/move_to_folder`。
- 接入 `mcp:write:document` scope。
- 写工具支持幂等、dryRun、baseRevision、审计、时间线和 realtime。
- 扩展既有 `pdm.comment.create` 支持文档评论。

重点：

- scope 不替代业务权限。
- `VIEWER` 即使拥有写 scope 也不能写。
- 编号 lookup 和文档搜索不泄露无权限对象。
- 搜索返回命中片段，不返回维护型摘要。
- 目录写入复用文档 scope 和业务权限，目录读工具走 `mcp:read`。

验收：

- MCP client 可创建文档、追加内容、替换正文。
- MCP client 可创建/移动/删除空文件夹，并可把文档创建或移动到指定文件夹。
- Web 页面可通过实时刷新看到 MCP 写入结果。
- 幂等冲突正确返回。

### DOC-H：资源上下文集成

目标：

- 在文档详情展示关联资源。
- 在需求、任务、Bug、事项、版本详情中展示关联文档入口。
- 支持从资源进入相关文档列表。

重点：

- 第一版复用现有详情页和详情抽屉，不强制重构为统一资源路由。
- 如新增统一资源页，必须先单独确认范围。

验收：

- 用户从文档能进入业务资源。
- 用户从业务资源能看到相关文档。

### DOC-I：测试、E2E 与发布前验收

目标：

- 补充 shared、API、Web 单测。
- 补充 Playwright UI/E2E。
- 验证导入、阅读、关联、用户编辑、MCP 更新、权限和实时刷新。

建议 E2E 主链路：

1. 用户登录并选择空间。
2. 上传 Markdown 创建文档。
3. 上传 Word 创建文档。
4. 文档关联需求和任务。
5. 从文档跳转到关联资源。
6. 用户编辑正文并保存。
7. MCP 创建文档。
8. MCP 追加文档内容。
9. MCP 替换文档正文。
10. 用户基于旧 revision 保存被冲突拦截。
11. VIEWER 无法修改文档。
12. 另一个用户页面通过 realtime 看到文档更新。
13. Markdown 渲染不会执行脚本或危险链接。
14. 不支持的 Word 格式、超大导入文件和异常压缩包被拒绝且不落半成品。

门禁：

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- 相关 Playwright E2E
- PostgreSQL + MinIO + API + Web 完整环境验证导入和附件链路

## 16. 错误码建议

- `DOCUMENT_NOT_FOUND`
- `DOCUMENT_ACCESS_DENIED`
- `DOCUMENT_EDIT_CONFLICT`
- `DOCUMENT_IMPORT_UNSUPPORTED_TYPE`
- `DOCUMENT_IMPORT_FAILED`
- `DOCUMENT_LINK_TARGET_INVALID`
- `DOCUMENT_LINK_CROSS_SPACE_DENIED`
- `DOCUMENT_ARCHIVED`
- `DOCUMENT_REVISION_NOT_FOUND`
- `MCP_DOCUMENT_SCOPE_REQUIRED`

## 17. 待确认项与本轮落地状态

以下是方案阶段需要用户最终确认的口径。已在本轮本地落地的项会明确标注为“本地已实现”；在回写 Notion 前，它仍不是正式需求事实源。

1. 文档第一版是否只做空间级，不做组织级文档？
   - 推荐：只做空间级。

2. 在线编辑是否只支持 Markdown 源码/轻量 Markdown 编辑，不做富文本？
   - 推荐：只支持 Markdown 编辑。

3. Word 导入图片第一版是否允许“尽力保留，失败则占位”，不作为阻塞？
   - 推荐：允许尽力处理，不因复杂图片导致整体方案变重。

4. 模型更新是否只支持追加和整篇替换，不做局部 patch？
   - 推荐：只支持追加和整篇替换。

5. 搜索第一版是否使用 PostgreSQL 全文检索和 chunks，不引入向量库？
   - 推荐：先不引入向量库。

6. 是否允许非 `VIEWER` 空间成员都创建文档？
   - 推荐：允许，文档是上下文沉淀入口，创建门槛不宜过高。

7. 是否需要文档编号，例如 `DOC-12`？
   - 推荐：第一版不做，先通过标题、标签、关联对象和搜索定位；如果后续会议沟通频繁引用文档，再补 `DOC-n`。

8. 文档正文和导入文件大小限制是多少？
   - 推荐：先沿用附件单文件 `20MB` 上限，正文 Markdown 落库前增加更小的可配置上限，具体数值在实现前按数据库和页面渲染成本确认。

9. 子系统左栏“文档目录”（本地已实现，待回写 Notion 后转为正式口径）
   - 落地状态：已在当前仓库实现空间级共享文件夹树，不再是待实现项；仅在 `/documents` 列表页作为文档库目录展示。
   - 详情页职责：`/documents/:documentId` 左侧展示当前文档的 Markdown 标题目录；右侧只保留关联资源、标签、评论、附件、时间线和创建/编辑元信息。文档文件夹归属通过“移动到文件夹”操作处理，不在详情页常驻文件夹树。
   - 已实现能力：创建文件夹、重命名、移动文件夹、同级批量重排、删除空文件夹、移动单个或多个文档到文件夹、导入/粘贴/模型创建时指定 `folderId`、按 `folderId`/子树搜索。
   - 目录交互：文件夹树默认折叠有子级的节点；当前选中文件夹或当前文档所属文件夹的祖先链自动展开，避免当前项不可见。用户手动展开/收起后，普通刷新不应重置其选择；树级“收起全部”仍保留当前项祖先链可见。“包含子目录”按钮在文件夹标题行常驻展示，未处于文件夹上下文时禁用并通过 tooltip/aria 说明。
   - 拖拽口径：文件夹拖拽首版只支持单个文件夹移动/排序；文档拖拽必须支持多选后批量拖到目标文件夹。批量文件夹拖拽首版不做，避免多子树循环和排序冲突。
   - 明确不做：文件夹级私有权限、多位置挂载、递归删除、目录外链分享、拖拽作为唯一操作路径。
   - MCP 落地：新增 `pdm.document_folder.*` 工具，扩展文档创建/搜索/移动工具，目录写入统一使用 `mcp:write:document`。

## 18. 推荐结论

文档页第一版应落在“上下文沉淀库”而不是“在线文档系统”：

- 导入和模型写入是主路径。
- 阅读、检索、关联跳转是核心体验。
- 在线编辑只保留必要入口。
- 模型创建和修改必须可见、可追溯、可审计。
- 文档与需求、任务、Bug、版本之间的关联比复杂编辑器更重要。

这个方向能服务当前“把大模型协作结论快速落地并作为后续上下文”的真实需求，同时避免把项目拖入完整文档协同平台的实现复杂度。
