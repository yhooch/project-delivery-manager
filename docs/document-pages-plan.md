# 项目空间文档页面树落地方案

状态：本地草案。Notion 回写不纳入本方案实施范围，由用户后期单独处理。

最后更新：2026-05-25。

## 1. 背景

当前系统已经具备需求、事项池、任务、Bug、流程、时间线、标签、用户可读业务编号和实时刷新能力；MCP 主体代码链路已实现，但仍待真实 OAuth / MCP Inspector 或等价客户端端到端验收。项目协作过程中仍存在一类资料不适合放入现有结构化对象：

- 会议记录、设计说明、排查记录、交付资料、操作手册、临时分析和项目知识沉淀。
- 不一定能归入单个需求、事项、任务或 Bug。
- 需要用户自由维护，也需要后续通过 MCP / 大模型读取、搜索、创建和更新。

因此新增「文档」能力，作为当前项目空间内的自由页面树。

## 2. 产品定位

「文档」是项目空间内的 Notion-like 自由页面树，用于沉淀项目相关记录和知识。

它不替代现有业务对象：

- 需求：回答做什么、为什么、业务规则是什么。
- 事项池：承接工作来源、纳入判断和拆解任务。
- 任务 / Bug：承接执行流转、责任人、状态和验收闭环。
- 文档：承接自由沉淀、项目知识和非结构化记录，并供人和 MCP 共同维护。

## 3. 信息架构

左侧导航「沉淀」分组建议调整为：

```text
沉淀
- 需求
- 事项池
- 文档      [+]
```

交互规则：

- 点击「文档」进入当前项目空间的文档页面树。
- 点击「文档」右侧 `+` 快速创建顶层文档。
- 文档页面内提供「新建文档」和「新建子文档」入口。
- 不只提供「创建文档」按钮，因为用户需要持续浏览、搜索和编辑已有文档。

## 4. V1 范围

V1 必须支持：

- 当前项目空间下创建文档。
- 文档父子层级。
- 页面标题编辑。
- Notion-like 块编辑正文。
- 页面树展示。
- 文档搜索，至少覆盖标题和正文纯文本。
- 最近更新时间和更新人展示。
- 归档和软删除。
- 自动保存。
- 文档附件上传、列表、预览 / 下载和移除。
- 正文图片块，图片必须来自当前文档附件。
- 文档可选关联需求、事项、任务、Bug 和版本。
- 文档关联对象按当前查看者权限裁剪，不能通过链接泄露无权对象信息。
- 文档创建、更新、附件变更、归档、删除和恢复写入时间线，并可进入空间最近动态。
- 文档创建者、`SPACE_ADMIN` 和 `PM` 可以给指定空间成员分配文档编辑权限，包含标题、正文和附件维护。
- 实时刷新文档树、标题、归档状态、当前文档内容和附件列表。
- MCP 读取、搜索、创建、更新、创建子文档和归档文档；MCP V1 不负责上传二进制附件。

V1 可以后置：

- 文档模板。
- 文档历史版本。
- 块级拖拽排序。
- 私有文档、空间外分享、访问白名单、块级权限等更复杂的文档权限模型。

## 5. 不做范围

V1 不做：

- 完整 Notion 克隆。
- 多人光标、CRDT / OT 协同编辑。
- 块级权限。
- 模板市场。
- 跨空间全局文档库。
- 独立审批流。
- 文档评论。
- 文档业务编号。
- 需求评审流或方案评审流。
- 用文档替代需求、事项、任务、Bug 或时间线事实源。

## 6. 编辑器方案

Web 端采用 Notion-like 块编辑体验，正文事实源使用结构化块内容，而不是 Markdown textarea。

建议数据口径：

```text
contentFormat = TIPTAP_JSON
contentJson
contentText
contentMarkdownCache
```

字段语义：

- `contentJson`：Web 块编辑器事实源。
- `contentText`：搜索、摘要和列表预览使用的纯文本投影。
- `contentMarkdownCache`：供 MCP 读取、导出和外部工具消费的 Markdown 投影。

V1 块能力建议：

- 段落。
- H1 / H2 / H3 标题。
- 有序列表和无序列表。
- 待办列表。
- 引用。
- 代码块。
- 分割线。
- 简单表格。
- 图片块，图片源必须是当前文档下的图片附件。
- 子页面链接。
- `/` 命令菜单。
- 常用 Markdown 快捷输入。

附件与图片规则：

- V1 支持文档附件，沿用现有附件上传、登记、列表和下载签名链路，但必须扩展 `AttachmentTargetType` 增加 `DOCUMENT`。
- 文档附件归属于 `organizationId + spaceId + documentId`，权限继承文档权限：查看附件需要 `canView`，上传和移除附件需要 `canManageAttachments`。
- 正文图片块不直接保存远程 URL、base64 或二进制内容；图片节点只保存 `attachmentId`、`alt`、`caption` 等元信息。
- 正文图片块 V1 只允许 `image/png`、`image/jpeg`、`image/gif`、`image/webp`。`image/svg+xml` 可作为普通附件上传和下载，但 V1 不作为正文图片或内嵌预览直接渲染。
- SVG 附件前端不展示预览入口；服务端生成 SVG 下载签名时必须强制 `Content-Disposition: attachment`，避免浏览器直接执行或渲染 SVG 内容。
- 图片附件必须满足正文图片 MIME 白名单，且 `attachment.targetType = DOCUMENT`、`attachment.targetId = documentId`。
- 普通文件附件在文档附件面板中维护；图片附件既可在附件面板展示，也可被正文图片块引用。
- V1 明确沿用当前附件基础限制：单文档最多 `20` 个附件，单文件最大 `20MB`；如果交付资料场景需要更大容量，后续以独立存储配额专题调整。
- 移除仍被正文引用的图片附件时，服务端应返回 `DOCUMENT_ATTACHMENT_IN_USE`，前端引导用户先删除正文图片块；不允许产生失效图片引用。
- 归档文档不影响附件访问权限；软删除文档或文档子树时，同步软删除对应文档附件并撤销后续下载签名能力。
- V1 不允许外链图片热加载，避免跨域追踪、权限绕过和内容失效问题。

自动保存规则：

- 标题和正文编辑后 debounce 保存，建议默认 `800ms` 到 `1500ms`。
- 保存时不清空旧内容，不显示整页 loading。
- 保存失败展示轻量错误和重试入口。
- 保存失败时保留当前本地编辑内容，不回退到服务端旧内容。
- 离开页面前如仍有未提交变更，应尝试 flush；失败时提示用户仍有未保存内容。
- 用户正在编辑时，实时刷新不得覆盖未提交输入。
- 遇到 `DOCUMENT_UPDATE_CONFLICT` 时，前端必须保留本地内容，提示远端已有更新，并提供刷新查看远端版本、继续保留本地编辑、基于最新 `contentRevision` / `revision` 再次保存等明确动作；不得静默覆盖任一方内容。
- V1 不提供强制覆盖参数。前端不得在旧 `baseContentRevision` 或旧 `baseRevision` 上静默覆盖远端内容；如果后续支持覆盖，必须新增显式 `force` 参数和对应审计、提示、验收口径。

## 7. MCP 方案

MCP 端以受控增强 Markdown 作为主要交换格式，内部仍以 `contentJson` 为 Web 编辑事实源。

原因：

- 大模型更适合读写 Markdown。
- 结构化编辑器 JSON 对模型不友好。
- Markdown 与块结构不承诺 100% 无损互转。
- 服务端负责 Markdown 与受控 Tiptap JSON 的转换和校验。

V1 支持的 Markdown 子集：

- 段落、H1 / H2 / H3。
- 加粗、斜体、行内代码、链接。
- 有序列表、无序列表、待办列表。
- 引用、代码块、分割线。
- 简单 GFM 表格。
- 图片：仅支持 `![alt](attachment://<attachmentId>)`，且附件必须属于当前文档、MIME 类型必须为 `image/png`、`image/jpeg`、`image/gif` 或 `image/webp`。

V1 不支持的 Markdown 内容默认拒绝写入：

- HTML。
- iframe、script 或任意嵌入内容。
- 远程资源引用。
- base64 / data URL 图片。
- 无法映射到受控 Tiptap schema 的复杂块。

V1 不提供 `allowLossyConversion`。如果后续允许有损转换，必须新增显式参数、风险提示和验收口径。

建议新增 MCP tools：

```text
pdm.document.list
pdm.document.get
pdm.document.search
pdm.document.create
pdm.document.update
pdm.document.create_child
pdm.document.archive
```

MCP scope：

- 读类工具使用既有 `mcp:read`。
- 写类工具新增 `mcp:write:document`。
- `mcp:write:document` 只控制 MCP 文档写入口，不替代组织、项目空间、空间角色和对象权限裁决。
- 新增 `mcp:write:document` 时必须同步更新 shared `McpScopeSchema`、API `MCP_SCOPE_VALUES`、OAuth consent 文案、前端授权展示和 MCP scope 冻结测试。

MCP 写工具统一要求：

```text
organizationId
spaceId
idempotencyKey
targetSelectionSource
dryRun?
```

MCP 规则：

- MCP scope 只控制 MCP 入口能力，不替代业务权限。
- 最终读写仍由组织、项目空间、空间角色和对象权限裁决。
- MCP 创建 / 更新文档传入 Markdown。
- 服务端转换为受控 `contentJson`，同时生成 `contentText` 和 `contentMarkdownCache`。
- MCP 读取默认返回 Markdown，并可返回文档树、父子关系、附件元数据和关联对象摘要。
- MCP V1 更新文档采用整篇 Markdown 替换，并通过 `baseContentRevision` 做标题 / 正文冲突校验；不做字段级或块级 patch。
- MCP V1 不上传二进制附件，不返回下载签名；Markdown 图片只可保留或引用当前文档已有图片附件。
- MCP 返回附件元数据时只返回业务摘要，不返回 `fileKey`、预签下载 URL 或对象存储路径。
- MCP 创建文档时如包含 `attachment://` 图片引用，因目标文档尚未完成附件归属绑定，V1 默认拒绝；如后续支持预上传附件，必须新增显式附件绑定流程和验收口径。
- Markdown 超出 V1 支持子集时拒绝写入，不做默认有损转换。
- 写操作必须记录审计并触发 realtime invalidation。
- `dryRun = true` 时复用现有统一 `McpDryRunResultSchema`；文档工具不得新增一套独立 dry-run 响应格式。如后续需要返回 Markdown 预览，应先扩展 shared 通用 dry-run schema。
- MCP 文档写工具不能只依赖当前 MCP writable space role 判断，必须调用文档独立权限服务。
- `pdm.document.list`、`pdm.document.get`、`pdm.document.search` 读取结果必须按 `DocumentPermissionService.canView` 裁剪。
- `pdm.document.create` 按 `DocumentPermissionService.canCreate` 判断，`VIEWER` 不可创建文档。
- `pdm.document.create_child` 按 `DocumentPermissionService.canCreate` 判断，并要求父文档同空间且当前用户可查看父文档。
- `pdm.document.update` 按 `DocumentPermissionService.canEditContent` 判断；被显式授权的 `VIEWER` 可以通过 MCP 更新该文档标题、正文和已有附件图片引用。
- `pdm.document.archive` 按 `DocumentPermissionService.canArchive` 判断；显式编辑授权不授予归档权限。
- `targetSelectionSource` 仍遵循现有 MCP 写入目标选择策略：提交写入时只接受 `USER_EXPLICIT` 或符合单一可写空间规则的 `SINGLE_WRITABLE_SPACE`，不得把 `MCP_CONTEXT_FALLBACK` 当作提交写入目标。

## 8. 数据模型草案

核心表：

```text
space_documents
- id
- organization_id
- space_id
- parent_document_id
- title
- content_format
- content_json
- content_text
- content_markdown_cache
- sort_order
- revision
- content_revision
- status: ACTIVE / ARCHIVED
- created_by_id
- updated_by_id
- content_updated_at
- content_updated_by_id
- created_at
- updated_at
- deleted_at
```

关联表：

```text
document_links
- id
- organization_id
- space_id
- document_id
- target_type: REQUIREMENT / INTAKE_ITEM / WORK_ITEM / VERSION
- target_id
- created_by_id
- created_at
- deleted_at
```

`document_links.target_type` 使用独立枚举 `DocumentLinkTargetType`，不得复用完整 `TargetType`，避免 `SPACE` 等非目标对象误入。Bug 通过 `WORK_ITEM` 承接；展示为 Bug 时必须校验目标 `workItem.type = BUG`。

编辑授权表：

```text
document_editors
- id
- organization_id
- space_id
- document_id
- user_id
- granted_by_id
- created_at
- deleted_at
```

`document_editors` 只表达文档编辑授权，不表达查看权限。查看权限默认授予当前空间内所有有效成员。

附件数据口径：

- 不新增独立 `document_attachments` 表，沿用现有 `attachments` 表。
- 扩展 Prisma 和 shared `AttachmentTargetType`：`REQUIREMENT | WORK_ITEM | DOCUMENT`。
- 文档附件记录固定满足 `target_type = DOCUMENT`、`target_id = documentId`、`organization_id = document.organization_id`、`space_id = document.space_id`。
- 附件存储路径建议使用 `attachments/document/<documentId>/<attachmentId>/<safeFileName>`，避免与需求、任务附件混用路径。
- 正文图片节点只保存附件引用，不复制附件元数据；渲染时按附件权限生成临时预览 / 下载 URL。
- 同一文档内的正文图片引用必须指向当前文档附件，不能引用其他文档、需求或任务附件。
- 附件列表、上传登记和删除响应对外使用 `DocumentAttachmentSummary` / `PublicAttachmentDto`，不得返回 `fileKey`、对象存储路径、上传 URL 或下载 URL。下载能力只通过短期签名接口获取。

约束建议：

- 文档必须属于 `organizationId + spaceId`。
- `parentDocumentId` 必须属于同一空间。
- 禁止形成父子循环。
- `revision` 表示文档聚合版本，每次标题、正文、父级、排序、归档状态、附件、链接或编辑授权变化后递增。
- `contentRevision` 只在标题或正文变化后递增，用于标题 / 正文自动保存的并发冲突判断。
- `updatedAt` / `updatedBy` 表示文档聚合最近变更，凡递增 `revision` 的操作都必须同步更新。
- `contentUpdatedAt` / `contentUpdatedBy` 只在标题或正文变化后更新，用于区分“内容最近编辑”和“附件/权限/链接等元数据变更”。
- 软删除不释放业务关系。
- 归档父文档时，子树从默认文档树中隐藏，但只修改父文档状态；子文档状态保持不变，数据不物理删除。
- 删除父文档时，V1 固定软删除整个子树，并软删除子树内全部文档附件。
- 删除文档附件前必须校验正文引用；仍被图片块引用时返回 `DOCUMENT_ATTACHMENT_IN_USE`，不得留下失效引用。
- V1 不新增文档业务编号；文档在时间线和搜索中使用标题、路径和 ULID 识别。
- `sortOrder` V1 建议使用整数步进排序，例如按 `1000` 递增；移动文档时只重排受影响兄弟节点。后续如拖拽频繁再评估 fractional indexing。
- 顶层文档以 `parent_document_id IS NULL` 表示。
- 空标题允许保存；展示时使用“未命名文档”作为 UI fallback，不把 fallback 写入标题字段。

并发控制建议：

- 标题 / 正文保存必须携带 `baseContentRevision`，服务端只在标题或正文已被他人更新时返回 `DOCUMENT_UPDATE_CONFLICT`。
- 附件上传 / 移除、链接维护、编辑授权维护、父级移动、排序和归档使用 `baseRevision` 或各自接口的版本参数；这些变更不得让未触碰正文的自动保存误冲突。
- 如果一次请求同时修改正文和非正文元数据，必须同时携带 `baseContentRevision` 和 `baseRevision`，服务端分别校验。
- 详情接口返回 `revision` 和 `contentRevision`。附件接口响应或随后的 realtime/detail 刷新必须让前端拿到最新 `revision`；正文自动保存继续使用最新 `contentRevision`。

索引建议：

- `space_documents(organization_id, space_id, parent_document_id, status, deleted_at, sort_order)`，支撑文档树和同级排序。
- `space_documents(organization_id, space_id, updated_at)`，支撑最近更新列表。
- `space_documents(organization_id, space_id, deleted_at, title)`，支撑标题搜索和列表筛选。
- `document_links(document_id, target_type, target_id, deleted_at)`，支撑链接去重和目标反查。
- `document_editors(document_id, user_id, deleted_at)`，支撑编辑授权去重和权限判断。
- 复用 `attachments(organization_id, space_id, target_type, target_id, deleted_at, created_at)`，支撑文档附件列表。

唯一约束建议：

- `document_links` 中未删除的同一 `document_id + target_type + target_id` 不重复。
- `document_editors` 中未删除的同一 `document_id + user_id` 不重复。

## 9. API 草案

建议新增 REST API：

```text
GET    /spaces/:spaceId/documents
GET    /spaces/:spaceId/documents/tree
POST   /spaces/:spaceId/documents
GET    /documents/:documentId
PATCH  /documents/:documentId
DELETE /documents/:documentId
POST   /documents/:documentId/children
GET    /spaces/:spaceId/documents/search
GET    /documents/:documentId/links
PATCH  /documents/:documentId/links
GET    /documents/:documentId/editors
PATCH  /documents/:documentId/editors
```

文档附件复用通用附件 API，但必须支持 `targetType = DOCUMENT`：

```text
GET    /attachments?targetType=DOCUMENT&targetId=:documentId
POST   /attachments/presign
POST   /attachments
GET    /attachments/:attachmentId/download-url
DELETE /attachments/:attachmentId
```

如当前附件契约没有删除入口，V1 文档附件专题必须同步新增软删除接口；删除仍被正文图片块引用的附件时返回 `DOCUMENT_ATTACHMENT_IN_USE`。

附件删除接口契约建议：

```typescript
type DeleteAttachmentResponse = {
  deleted: true;
  attachmentId: string;
  targetType: AttachmentTargetType;
  targetId: string;
  deletedAt: string;
  documentRevision?: number;
};
```

- `DELETE /attachments/:attachmentId` 必须使用 `WriteOriginGuard`。
- V1 删除能力只支持 `targetType = DOCUMENT` 的附件。若附件属于 `REQUIREMENT` 或 `WORK_ITEM`，在对应业务对象删除语义未单独评估前必须返回 `ATTACHMENT_DELETE_UNSUPPORTED_TARGET`，不得静默删除。
- 删除接口执行软删除，不物理删除对象存储文件；对象清理可由后续异步清理任务承接。
- 文档附件删除前必须通过 `DocumentPermissionService.canManageAttachments` 校验。
- 文档附件删除前必须校验正文引用，仍被引用时返回 `DOCUMENT_ATTACHMENT_IN_USE`。
- 删除接口需补 shared contract、`ATTACHMENT_DELETE_UNSUPPORTED_TARGET` / `DOCUMENT_ATTACHMENT_IN_USE` 错误码、审计、realtime、Web service 和 E2E 测试。

文档附件上传和移除会递增文档 `revision`，但不递增 `contentRevision`。附件接口响应或随后的 realtime/detail 刷新必须让前端拿到最新 `revision`，正文自动保存不得因为附件变更产生误冲突。

列表查询参数：

- `status?: ACTIVE | ARCHIVED`，默认 `ACTIVE`。
- `parentDocumentId?: string | null`，可选用于按父级分页加载。
- `query?: string`，可选用于标题和正文纯文本搜索。

`PATCH /documents/:documentId` 支持：

- 标题更新。
- 正文更新。
- 父级移动。
- 排序。
- 归档状态更新。
- 标题或正文更新必须携带 `baseContentRevision`，服务端发现标题 / 正文版本不一致时返回 `DOCUMENT_UPDATE_CONFLICT`。
- 父级移动、排序或归档状态更新必须携带 `baseRevision`，服务端发现聚合版本不一致时返回 `DOCUMENT_UPDATE_CONFLICT`。

删除语义：

- `DELETE /documents/:documentId` 执行软删除。
- 归档用于从默认文档树隐藏但可恢复；软删除用于删除入口。
- 恢复归档文档走 `PATCH /documents/:documentId`，传 `status = ACTIVE` 和当前 `baseRevision`。
- 删除父文档时，V1 固定软删除其全部子树，并软删除子树内全部文档附件。

编辑授权语义：

- `GET /documents/:documentId/editors` 返回当前文档的显式编辑授权用户列表。
- `PATCH /documents/:documentId/editors` 以全量替换方式维护编辑授权，必须携带 `baseRevision`。
- 只有文档创建者、`SPACE_ADMIN` 和 `PM` 可以维护编辑授权。
- 授权目标必须是同一空间内的有效成员。
- 授权编辑只允许编辑标题、正文和附件，不授予归档、删除、移动父级或继续分配权限。

附件权限语义：

- 列表、预览和下载文档附件需要 `DocumentPermissionService.canView`。
- 预签上传、登记附件和删除附件需要 `DocumentPermissionService.canManageAttachments`。
- `canManageAttachments` 默认与 `canEditContent` 同步：文档创建者、`SPACE_ADMIN`、`PM` 和被显式授权编辑的空间成员具备该能力。
- 附件 API 对 `DOCUMENT` 目标不得走 `TargetResolverService.canWriteTarget` 的通用写权限，必须转发到 `DocumentPermissionService`。

## 10. Shared 契约草案

```typescript
type DocumentStatus = "ACTIVE" | "ARCHIVED";

type DocumentContentFormat = "TIPTAP_JSON";

type DocumentSummary = {
  id: string;
  organizationId: string;
  spaceId: string;
  parentDocumentId?: string;
  title: string;
  status: DocumentStatus;
  sortOrder: number;
  revision: number;
  contentRevision: number;
  updatedAt: string;
  updatedBy?: {
    id: string;
    username: string;
    name: string;
  };
  contentUpdatedAt?: string;
  contentUpdatedBy?: {
    id: string;
    username: string;
    name: string;
  };
};

type DocumentPermissionSnapshot = {
  canView: boolean;
  canEditContent: boolean;
  canManageAttachments: boolean;
  canManageEditors: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canMove: boolean;
};

type DocumentTreeNode = DocumentSummary & {
  children: DocumentTreeNode[];
};

type DocumentDetail = DocumentSummary & {
  contentFormat: DocumentContentFormat;
  contentJson: Record<string, unknown>;
  contentText: string;
  contentMarkdownCache?: string;
  attachmentCount: number;
  permissions: DocumentPermissionSnapshot;
};

type PublicAttachmentDto = {
  id: string;
  targetType: AttachmentTargetType;
  targetId: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedById: string;
  createdAt: string;
};

type DocumentAttachmentSummary = PublicAttachmentDto & {
  targetType: "DOCUMENT";
  isEmbeddableImage: boolean;
  referencedInContent: boolean;
};

// DocumentAttachmentSummary / PublicAttachmentDto intentionally excludes fileKey.

type DocumentLinkTargetType =
  | "REQUIREMENT"
  | "INTAKE_ITEM"
  | "WORK_ITEM"
  | "VERSION";

type DocumentLinkTargetSummary = {
  type: DocumentLinkTargetType;
  id: string;
  title?: string;
  displayCode?: string;
  workItemType?: "TASK" | "BUG";
};

type AccessibleDocumentLinkDto = {
  id: string;
  documentId: string;
  targetType: DocumentLinkTargetType;
  targetId: string;
  target: DocumentLinkTargetSummary;
  createdAt: string;
};

type InaccessibleDocumentLinkDto = {
  id: string;
  documentId: string;
  inaccessible: true;
  createdAt: string;
};

type DocumentLinkDto =
  | AccessibleDocumentLinkDto
  | InaccessibleDocumentLinkDto;

type DocumentEditorGrant = {
  id: string;
  documentId: string;
  user: {
    id: string;
    username: string;
    name: string;
  };
  grantedById: string;
  createdAt: string;
};

type CreateDocumentRequest = {
  parentDocumentId?: string;
  title?: string;
};

type UpdateDocumentRequest = {
  baseRevision?: number;
  baseContentRevision?: number;
  title?: string;
  contentJson?: Record<string, unknown>;
  parentDocumentId?: string | null;
  sortOrder?: number;
  status?: DocumentStatus;
};

type ListDocumentsQuery = {
  status?: DocumentStatus;
  parentDocumentId?: string | null;
  query?: string;
  page?: number;
  pageSize?: number;
};

type ListDocumentsResponse = {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
};

type DocumentTreeResponse = {
  items: DocumentTreeNode[];
};

type SearchDocumentsResponse = ListDocumentsResponse;

type ReplaceDocumentLinksRequest = {
  baseRevision: number;
  links: Array<{
    targetType: DocumentLinkTargetType;
    targetId: string;
  }>;
};

type ReplaceDocumentLinksResponse = {
  document: DocumentDetail;
  links: DocumentLinkDto[];
};

type ReplaceDocumentEditorsRequest = {
  baseRevision: number;
  userIds: string[];
};

type ReplaceDocumentEditorsResponse = {
  document: DocumentDetail;
  editors: DocumentEditorGrant[];
};

type McpWriteTargetSelectionSource =
  | "USER_EXPLICIT"
  | "SINGLE_WRITABLE_SPACE"
  | "MCP_CONTEXT_FALLBACK";

type McpListDocumentsRequest = {
  spaceId: string;
  status?: DocumentStatus;
  parentDocumentId?: string | null;
  query?: string;
  page?: number;
  pageSize?: number;
};

type McpGetDocumentRequest = {
  documentId: string;
  includeLinks?: boolean;
  includeAttachments?: boolean;
};

type McpSearchDocumentsRequest = {
  spaceId: string;
  query: string;
  status?: DocumentStatus;
  page?: number;
  pageSize?: number;
};

type McpDocumentMarkdownDetail = DocumentSummary & {
  contentMarkdown: string;
  attachments?: DocumentAttachmentSummary[];
  links?: DocumentLinkDto[];
  permissions: DocumentPermissionSnapshot;
};

type McpListDocumentsResponse = ListDocumentsResponse;
type McpSearchDocumentsResponse = SearchDocumentsResponse;
type McpGetDocumentResponse = McpDocumentMarkdownDetail;

type McpCreateDocumentRequest = {
  organizationId: string;
  spaceId: string;
  idempotencyKey: string;
  targetSelectionSource: McpWriteTargetSelectionSource;
  parentDocumentId?: string;
  title?: string;
  contentMarkdown: string;
  dryRun?: boolean;
};

type McpCreateChildDocumentRequest = {
  organizationId: string;
  spaceId: string;
  idempotencyKey: string;
  targetSelectionSource: McpWriteTargetSelectionSource;
  parentDocumentId: string;
  title?: string;
  contentMarkdown: string;
  dryRun?: boolean;
};

type McpUpdateDocumentRequest = {
  organizationId: string;
  spaceId: string;
  idempotencyKey: string;
  targetSelectionSource: McpWriteTargetSelectionSource;
  documentId: string;
  baseContentRevision: number;
  title?: string;
  contentMarkdown: string;
  dryRun?: boolean;
};

type McpArchiveDocumentRequest = {
  organizationId: string;
  spaceId: string;
  idempotencyKey: string;
  targetSelectionSource: McpWriteTargetSelectionSource;
  documentId: string;
  baseRevision: number;
  dryRun?: boolean;
};

type McpDocumentCommittedResponse = {
  dryRun?: false;
  committed: true;
  document: McpDocumentMarkdownDetail;
};

type McpWriteDocumentResponse =
  | McpDryRunResult
  | McpDocumentCommittedResponse;
```

错误码建议：

- `DOCUMENT_NOT_FOUND`
- `DOCUMENT_ACCESS_DENIED`
- `DOCUMENT_PARENT_INVALID`
- `DOCUMENT_PARENT_CYCLE`
- `DOCUMENT_UPDATE_CONFLICT`
- `DOCUMENT_CONTENT_INVALID`
- `DOCUMENT_MARKDOWN_UNSUPPORTED`
- `DOCUMENT_MARKDOWN_CONVERSION_FAILED`
- `DOCUMENT_ATTACHMENT_IN_USE`
- `DOCUMENT_LINK_TARGET_NOT_FOUND`
- `DOCUMENT_LINK_TARGET_ACCESS_DENIED`
- `DOCUMENT_EDITOR_INVALID`
- `DOCUMENT_EDITOR_ACCESS_DENIED`

新增文档错误码时，必须同步更新：

- shared `ApiErrorCodeSchema`。
- contracts `errorCodes`。
- Web `zh-CN` / `en-US` 错误文案。
- MCP business error schema 和相关契约测试。

新增 `DOCUMENT` 附件目标时，必须同步更新：

- Prisma `AttachmentTargetType` enum 和迁移。
- shared `AttachmentTargetTypeSchema`、附件请求 / 响应 schema、`PublicAttachmentDto` / `DocumentAttachmentSummary`、删除响应 schema、`ATTACHMENT_DELETE_UNSUPPORTED_TARGET` 错误码和附件契约测试。
- API 附件目标解析、上传登记、下载签名、软删除、引用检查和清理逻辑。
- API 对 SVG 下载签名必须支持强制 `Content-Disposition: attachment`；前端对 SVG 附件只展示下载动作，不展示预览动作。
- Web 附件 service、上传控件、预览 / 下载动作和 i18n。

实现前需冻结权限错误口径：文档自身权限不足推荐返回 `DOCUMENT_ACCESS_DENIED`；空间成员或组织访问不足继续返回现有 `SPACE_ACCESS_DENIED` / `ORGANIZATION_ACCESS_DENIED`。

链接权限规则：

- 创建或替换文档链接时，当前用户必须对目标对象具备读权限。
- 链接目标必须与文档处于同一 `organizationId + spaceId`。
- 读取文档链接时，服务端必须按当前查看者权限二次解析目标摘要。
- 当前查看者无目标权限时，不返回 `targetType`、`targetId`、目标标题、编号、摘要或所属对象细节；可隐藏该链接，或只返回 `id + documentId + inaccessible: true + createdAt` 的占位链接。
- 编号 lookup、MCP 读取和 Web 展示均不得通过文档链接泄露无权对象存在性。

## 11. 权限口径

文档权限使用独立 `DocumentPermissionService`，不复用现有 `TargetResolverService` 的通用写权限。原因是文档允许“默认空间成员查看 + 指定用户编辑”，并且 `VIEWER` 在被显式授权后可以编辑该文档标题、正文和附件，这与当前业务对象的通用写权限口径不同。

权限能力拆分为：

- `canView`
- `canCreate`
- `canEditContent`
- `canManageAttachments`
- `canManageEditors`
- `canArchive`
- `canDelete`
- `canMove`

V1 建议：

- 非组织成员不可访问。
- 非空间成员不可访问。
- 当前空间内所有有效成员默认可查看 `ACTIVE` 和 `ARCHIVED` 文档，包括 `VIEWER`；软删除文档不可通过普通读取入口访问。
- 非 `VIEWER` 的有效空间成员可以创建文档，创建者自动具备该文档编辑权和编辑授权管理权。
- `SPACE_ADMIN`、`PM` 可查看、编辑、上传 / 移除附件、归档、删除、移动和管理全部文档编辑授权。
- 文档创建者可以编辑、上传 / 移除附件、归档、删除、移动自己创建的文档，并可以给同空间指定成员分配或移除编辑权限。
- 普通 `MEMBER` 不默认拥有所有文档编辑权；只能编辑自己创建的文档，或编辑被创建者、`SPACE_ADMIN`、`PM` 显式授权的文档。
- 被授予编辑权限的指定用户可以编辑文档标题、正文和附件，但不能归档、删除、移动文档或继续分配编辑权限。
- `VIEWER` 默认只读；如果被文档创建者、`SPACE_ADMIN` 或 `PM` 显式授予编辑权限，V1 允许其编辑该文档标题、正文和附件，但不获得其他业务对象写权限。

后续可扩展：

- 私有文档。
- 空间外分享。
- 访问白名单。
- 块级权限。

V1 不建议引入上述扩展，避免权限复杂度超过当前主要目标。

## 12. 实时刷新与审计

实时刷新：

- 文档创建、标题更新、正文更新、附件上传 / 移除、移动父级、排序、归档、删除和关联对象变化后发布 realtime invalidation。
- V1 扩展全局 `TargetType` 增加 `DOCUMENT`，用于时间线、最近动态和实时事件目标。
- V1 扩展 `AttachmentTargetType` 增加 `DOCUMENT`；不扩展 `CommentTargetType`、`ObjectParticipantTargetType` 或 `TagTargetType` 增加 `DOCUMENT`。
- 文档相关 invalidation key 建议为 `document-tree`、`document-detail`、`document-search`、`document-links`、`document-editors`、`attachments`、`timeline`、`workbench`、`space-overview`。
- 新增文档相关 invalidation key 必须同步更新 shared `RealtimeInvalidationKeySchema` 和相关契约测试。
- `hints` 可携带 `documentId`、`parentDocumentId`、`spaceId` 和 `attachmentId`，不得携带正文内容、附件文件名或附件摘要。
- 文档树页面静默刷新，不重置搜索词、展开状态和当前选中文档。
- 当前文档正在编辑时，不覆盖未保存输入。
- MCP 写入后，Web 文档树和当前文档能静默感知变化。

`DOCUMENT` 进入全局 `TargetType` 后，必须同步更新：

- Prisma `TargetType` enum 和迁移。
- shared `TargetTypeSchema`、`TimelineTargetSchema`、`RealtimeTargetSchema`。
- `TargetResolverService`，支持文档目标解析和文档查看权限判断。
- `RealtimePermissionService`，文档事件按 `DocumentPermissionService.canView` 判断。
- 空间最近动态查询的 `RECENT_ACTIVITY_TARGET_TYPES`。
- 最近动态 target identity 查询，文档展示标题或“未命名文档”，不生成 `displayCode`。
- timeline mapper，`DOCUMENT` 不参与业务编号格式化。
- Web timeline link，`DOCUMENT` 跳转 `/documents/:documentId`。
- Web timeline 展示文案和 i18n。
- MCP `pdm.timeline.list` 的目标类型校验和输出 schema。

审计与时间线：

- 文档创建、更新、附件上传 / 移除、归档、删除和 MCP 写操作写审计。
- 审计记录至少包含 `source`、用户、组织、空间、目标文档、操作类型和 requestId；附件操作可包含 `attachmentId`，但避免在 realtime hints 中携带附件文件名。
- 文档创建、标题更新、正文更新、附件上传 / 移除、归档、恢复、删除、移动父级和编辑授权变更写入用户可见时间线。
- 时间线 `target.type = DOCUMENT`，`target.id = documentId`；文档没有 `displayCode`，时间线目标展示文档标题或“未命名文档”。
- 文档时间线事件复用现有 `TimelineEventType`：创建使用 `CREATED`，标题/正文/附件/移动/授权/归档/恢复使用 `UPDATED`，删除使用 `UPDATED` 并在 metadata 中记录 `operation = "SOFT_DELETED"`。
- 空间总览或最近动态可以展示当前用户有权查看的文档事件；无权查看文档内容的用户不得看到正文或链接目标细节。

## 13. 前端页面方案

建议路由：

```text
/documents
/documents/[documentId]
```

页面结构：

```text
左侧：文档树 / 搜索 / 新建文档
右侧：标题 / 元信息 / 块编辑器 / 附件面板 / 自动保存状态
```

空态：

- 当前空间没有文档时，展示「创建第一篇文档」。
- 空态文案说明文档用于沉淀会议记录、设计说明、排查记录、交付资料和项目知识。
- 新建空文档允许标题为空，列表和树中展示「未命名文档」。

搜索：

- V1 搜索默认只返回 `ACTIVE` 文档。
- 归档文档通过 `status=ARCHIVED` 的列表或搜索入口查看。
- V1 可使用 PostgreSQL `ILIKE` 覆盖标题和 `contentText`；后续数据量增长后再评估全文索引。
- 搜索输入和结果刷新不得重置当前文档树展开状态。

组件建议：

- `DocumentPage`
- `DocumentTree`
- `DocumentEditor`
- `DocumentTitleEditor`
- `DocumentAutosaveStatus`
- `DocumentAttachmentPanel`
- `DocumentLinkPanel`
- `BlockEditorCore`

建议复用现有需求编辑器基础能力，但抽出通用编辑器核心：

```text
BlockEditorCore
RequirementEditorShell
DocumentEditorShell
```

文档附件前端建议复用现有任务 / 需求附件上传和预览基础能力，但独立封装 `DocumentAttachmentPanel`，避免把任务详情页的业务标签、计数和权限判断带入文档页面。

## 14. 验收标准

功能验收：

- 用户可在「沉淀 > 文档」创建顶层文档。
- 用户可创建子文档。
- 文档树正确展示父子层级。
- 用户可编辑标题和正文块。
- 用户可上传、查看、预览 / 下载和移除文档附件。
- 文档附件 V1 按单文档最多 `20` 个、单文件最大 `20MB` 校验，超限返回清晰错误。
- 用户可在正文中插入当前文档图片附件作为图片块。
- 正文图片块只引用当前文档图片附件；引用其他目标附件、非图片附件或不存在附件时保存失败。
- 正文图片块只允许 `png/jpeg/gif/webp`，SVG 只能作为普通附件强制下载，不展示预览按钮，不作为正文图片或内嵌预览渲染。
- 文档附件列表、创建响应和 MCP 附件摘要均不得返回 `fileKey`、对象存储路径、上传 URL 或下载 URL。
- 删除仍被正文图片块引用的附件时返回 `DOCUMENT_ATTACHMENT_IN_USE`，不会留下失效图片引用。
- `DELETE /attachments/:attachmentId` 在 V1 只删除文档附件；需求或任务附件调用该接口时返回 `ATTACHMENT_DELETE_UNSUPPORTED_TARGET`。
- 刷新后标题、内容、层级和最近更新时间保持。
- 搜索可命中文档标题和正文。
- 用户可归档或删除文档。
- 归档父文档后，子树从默认文档树中隐藏，恢复父文档后子树按原状态重新可见。
- 删除父文档时子树一起软删除，并在确认弹窗中展示影响范围。
- 文档可关联需求、事项、任务、Bug 和版本。
- 文档关联目标按当前用户权限裁剪；无权目标不得泄露标题、编号或存在性。
- 文档创建者、`SPACE_ADMIN`、`PM` 可给指定空间成员分配编辑权限；被授权用户可编辑标题、正文和附件。
- 文档创建者、`SPACE_ADMIN`、`PM` 和被授权编辑者可上传 / 移除文档附件。
- 文档变更和附件变更写入时间线或空间最近动态，当前空间成员可按查看权限看到文档活动。

权限验收：

- `VIEWER` 默认只能查看，不能创建、编辑、归档或删除。
- `VIEWER` 被文档创建者、`SPACE_ADMIN` 或 `PM` 显式授予编辑权限后，只能编辑该文档标题、正文和附件。
- 未获编辑授权的 `VIEWER` 可以查看和下载有权文档附件，但不能上传或移除附件。
- 非空间成员不能访问文档。
- 跨组织、跨空间不能访问文档。
- MCP scope 不足时不能调用写工具。
- MCP 有写 scope 但业务权限不足时仍不能写。

MCP 验收：

- MCP 可读取文档为 Markdown。
- MCP 读取文档时，正文图片以 `attachment://<attachmentId>` 表示，并可按参数返回附件元数据。
- MCP 可搜索文档。
- MCP 可用 Markdown 创建文档。
- MCP 可创建子文档，并校验父文档同空间且当前用户可查看父文档。
- MCP 可用 Markdown 更新文档。
- MCP 可归档文档，且必须满足 `canArchive`。
- 被显式授权的 `VIEWER` 在具备 `mcp:write:document` scope 时，可通过 MCP 更新该文档标题、正文和已有附件图片引用。
- 未被显式授权的 `VIEWER` 即使具备 `mcp:write:document` scope，也不可通过 MCP 更新文档。
- 被显式授权的 `VIEWER` 不可通过 MCP 归档文档。
- MCP 重试相同 `idempotencyKey` 不重复创建。
- MCP `dryRun = true` 返回统一 `McpDryRunResult`，不创建文档、不返回伪造文档详情。
- MCP 使用旧 `baseContentRevision` 更新标题 / 正文，或使用旧 `baseRevision` 归档文档时返回 `DOCUMENT_UPDATE_CONFLICT`。
- Markdown 超出 V1 支持子集时返回可解释的转换错误，不写入半成品内容。
- MCP Markdown 写入远程图片、base64 图片、非当前文档附件图片或非图片附件引用时返回可解释错误。
- MCP 读取文档链接时不得泄露当前 token 无权访问的目标对象。
- MCP 写入后 Web 端通过实时刷新可见。

体验验收：

- 自动保存不清空内容。
- 自动保存失败时保留本地编辑内容并提供重试。
- 他人上传 / 移除附件、维护链接或编辑授权时，不应导致当前用户未触碰同一正文版本的自动保存误报 `DOCUMENT_UPDATE_CONFLICT`。
- 附件、链接、授权等聚合变更更新 `updatedAt / updatedBy`，但不更新 `contentUpdatedAt / contentUpdatedBy`。
- 实时刷新不关闭当前文档，不重置搜索词和文档树展开状态。
- 用户正在编辑时不会被远端刷新覆盖未保存输入。
- 导航、空态、自动保存状态、错误提示和文档菜单均具备 `zh-CN` / `en-US` 文案。
- 中文、英文、浅色和深色模式下均可读。

## 15. 实施拆分建议

建议作为新专题 `DOC`：

- `DOC-A` 本地事实源草案冻结与契约细化。
- `DOC-B` shared schema、Prisma 模型和迁移。
- `DOC-C` 文档 CRUD、页面树、权限和搜索 API。
- `DOC-D` Web 导航入口、文档树和空态；包含 `/documents`、`/documents/[documentId]`、左侧导航「沉淀 > 文档」入口、导航项右侧 `+` 创建顶层文档、Sidebar 测试。
- `DOC-E` Notion-like 块编辑器和自动保存。
- `DOC-F` 文档附件、正文图片块、`AttachmentTargetType = DOCUMENT`、附件面板和附件权限。
- `DOC-G` 文档链接、编辑授权、时间线/最近动态和实时刷新。
- `DOC-H` MCP document tools 和 Markdown 转换。
- `DOC-I` 测试、E2E、MCP 端到端验收。

Notion 回写不作为 DOC 专题任务；完整落地和验收后，由用户后期单独处理。

## 16. 已确认口径

- V1 支持文档附件。
- V1 暂时不考虑文档评论。
- 文档变更和附件变更必须写入时间线或空间最近动态。
- V1 不新增文档业务编号。
- 当前空间所有有效成员默认有文档查看权限。
- 文档创建者、`SPACE_ADMIN`、`PM` 可以给指定空间成员分配文档编辑权限；被授权用户只获得该文档标题、正文和附件维护权。
- Notion 回写不纳入本方案实施范围，完整落地和验收后由用户后期单独处理。
