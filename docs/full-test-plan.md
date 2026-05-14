# 全量测试计划

编制时间：2026-05-14
适用范围：Project Delivery Manager MVP + 专题 14 前端 IA/重设计/流程配置补正后的当前仓库。
测试目标：覆盖当前 Notion 事实源和 `packages/shared` 契约中定义的完整功能点，形成发布前可执行、可追溯、可回归的全量测试计划。

## 事实源

- Notion `03 产品方案`：MVP 编码范围、主流程、角色权限、默认流程、异常视图、SaaS 化边界。
- Notion `04.1 后端技术方案`：后端模块、数据隔离、Session 安全、流程动作、附件、审计、时间线。
- Notion `04.2 前端技术方案`：页面结构、应用壳、详情抽屉、Tiptap、流程配置全页、i18n、主题。
- Notion `04.3 跨端契约`：REST API、DTO、错误码、Zod schema、OpenAPI、附件和流程契约。
- Notion `05 里程碑与路线图`：M0-M4 阶段范围与验收入口。
- Notion `06 测试与验收`：验收事实源、自动化门禁、MVP 端到端主链路。
- Notion `13 开发实施计划`：M0-M4 执行状态、发布前真实 E2E 要求。
- Notion `14 前端重构与重设计专题`：新 IA、设计系统、11 个 MVP 页面、流程配置全页、UI E2E 扩充。
- 本地契约：`packages/shared/src/contracts.ts` 当前 79 个 API operation。
- 本地测试说明：`docs/testing.md`、`tests/e2e/README.md`。

## 接口覆盖口径

以下 79 个 shared API operation 必须全部被本计划矩阵覆盖；若后续新增、删除或改名，应同步更新本节、功能矩阵和自动化测试。

| 域                          | operationId                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth/user                   | `register`、`login`、`logout`、`getAuthSession`、`updateUserPreferences`、`changePassword`                                                                                                                             |
| organization                | `listOrganizations`、`createOrganization`、`getOrganization`、`updateOrganization`、`listOrganizationMembers`、`addOrganizationMember`、`updateOrganizationMember`、`removeOrganizationMember`                         |
| space/view                  | `listSpaces`、`createSpace`、`getSpace`、`updateSpace`、`getMyWorkbenchView`、`getSpaceOverview`、`getSpaceExceptionsView`                                                                                             |
| space member                | `listSpaceMembers`、`addSpaceMember`、`updateSpaceMember`                                                                                                                                                              |
| version                     | `listVersions`、`createVersion`、`getVersion`、`updateVersion`、`getVersionBoardView`                                                                                                                                  |
| requirement                 | `listRequirements`、`createRequirementDraft`、`getRequirement`、`updateRequirement`                                                                                                                                    |
| intake                      | `listIntakeItems`、`createIntakeItem`、`getIntakeItem`、`updateIntakeItem`、`acceptIntakeItem`、`deferIntakeItem`、`rejectIntakeItem`、`convertIntakeItemToWorkItems`                                                  |
| work item                   | `listWorkItems`、`createWorkItem`、`getWorkItem`、`updateWorkItem`、`executeWorkflowAction`                                                                                                                            |
| bug                         | `listBugs`、`createBug`、`getBug`、`updateBug`                                                                                                                                                                         |
| workflow                    | `listWorkflows`、`createWorkflow`、`getWorkflow`、`updateWorkflow`、`listWorkflowVersions`、`createWorkflowVersion`、`getWorkflowVersion`、`updateWorkflowVersion`、`publishWorkflowVersion`                           |
| workflow state/action/field | `createWorkflowState`、`updateWorkflowState`、`deleteWorkflowState`、`createWorkflowAction`、`updateWorkflowAction`、`deleteWorkflowAction`、`createActionFormField`、`updateActionFormField`、`deleteActionFormField` |
| workflow binding            | `listWorkflowBindings`、`createWorkflowBinding`、`updateWorkflowBinding`                                                                                                                                               |
| timeline/comment/attachment | `listTimeline`、`listWorkItemTimeline`、`listComments`、`createComment`、`listAttachments`、`presignAttachment`、`createAttachment`、`getAttachmentDownloadUrl`                                                        |

## 测试环境

### 基础要求

- Node.js `>=22`。
- pnpm 由 Corepack 管理，版本以 `package.json` 的 `pnpm@11.1.1` 为准。
- PostgreSQL 测试实例必须可丢弃，禁止连接开发库或生产库。
- 测试数据必须带唯一 `runId`，避免并行或重复执行时互相污染。
- API 默认端口 `3001`，Web 默认端口 `3000`。

### /tmp PostgreSQL 环境

本计划指定 PostgreSQL 数据目录放在 `/tmp`，推荐使用 `/tmp/crm-manager-pg`。

```bash
export PGDATA=/tmp/crm-manager-pg
export PGPORT=55432
export PGDATABASE=project_delivery_manager_test
export PGLOG=/tmp/crm-manager-pg.log

rm -rf "$PGDATA"
initdb -D "$PGDATA" -U postgres --auth=trust
pg_ctl -D "$PGDATA" -o "-p $PGPORT -k /tmp" -l "$PGLOG" start
createdb -h /tmp -p "$PGPORT" -U postgres "$PGDATABASE"

export DATABASE_URL="postgresql://postgres@127.0.0.1:$PGPORT/$PGDATABASE"
corepack pnpm --filter @project-delivery/api exec prisma migrate deploy --config ../../prisma.config.ts
corepack pnpm --filter @project-delivery/api prisma:generate
```

停止测试库：

```bash
pg_ctl -D /tmp/crm-manager-pg stop
```

如使用仓库内一键 E2E 编排，`corepack pnpm test:e2e:full` 会启动 disposable PostgreSQL 容器和 tmpfs 数据目录；若发布验收要求严格使用本地 `/tmp/crm-manager-pg`，应手动按上文启动 PG，再用相同 `DATABASE_URL` 启动 API/Web 并执行 Playwright。

### 手动全栈启动

终端 1：

```bash
export DATABASE_URL="postgresql://postgres@127.0.0.1:55432/project_delivery_manager_test"
PORT=3001 WEB_APP_URL=http://127.0.0.1:3000 corepack pnpm dev:api
```

终端 2：

```bash
API_PROXY_TARGET=http://127.0.0.1:3001 corepack pnpm --filter @project-delivery/web dev --port 3000
```

终端 3：

```bash
E2E_M0_ENABLED=1 \
E2E_M3_ENABLED=1 \
E2E_M4_ENABLED=1 \
E2E_UI_ENABLED=1 \
E2E_DB_READY=1 \
E2E_API_URL=http://127.0.0.1:3001/api/v1 \
E2E_WEB_URL=http://127.0.0.1:3000 \
DATABASE_URL="postgresql://postgres@127.0.0.1:55432/project_delivery_manager_test" \
corepack pnpm test:e2e
```

## 测试数据基线

全量回归至少准备以下数据：

- 组织：`orgA`、`orgB`，用于租户隔离和同编码空间冲突验证。
- 用户：`owner`、`admin`、`pm`、`developer`、`tester`、`requirement`、`member`、`viewer`、`outsider`。
- 空间：每个组织至少 2 个空间，空间编码在不同组织允许重复。
- 空间角色：覆盖 `SPACE_ADMIN`、`PM`、`DEVELOPER`、`TESTER`、`REQUIREMENT`、`MEMBER`、`VIEWER`。
- 版本：每空间至少 2 个版本，覆盖 `PLANNED`、`IN_PROGRESS`、`RELEASED`、`ARCHIVED`。
- 需求：覆盖 `DRAFT`、`CONFIRMED`、`ARCHIVED`，包含空草稿、非空草稿、带图片附件、关联版本和负责人。
- 事项：覆盖 `PENDING`、`ACCEPTED`、`DEFERRED`、`REJECTED`、`CONVERTED`，包含一拆一和一拆多。
- 任务：覆盖默认开发任务流程、通用任务流程、阻塞、延期、待确认、待提测、测试退回、完成、取消。
- Bug：覆盖 Bug 默认流程、待确认、待修复、修复中、待回归、回归通过、已关闭、已拒绝、重新打开。
- 流程：默认三套流程、复制出的草稿、可发布草稿、发布失败草稿、停用流程版本、绑定任务/Bug。
- 附件：图片、PDF、文本、zip、超限大小、非法 MIME、超过 20 个附件。
- 评论与时间线：每类目标至少一条评论，动作、附件、评论、负责人变化均产生时间线。

## 门禁分层

### P0 默认门禁

每次合并前必须执行：

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

说明：默认 `test:e2e` 在未设置真实环境开关时会 skip，只能验证 skip 守卫和 spec 语法，不代表真实 E2E 已通过。

### P0 发布门禁

发布前必须执行真实全栈 E2E。本轮指定 PostgreSQL 在 `/tmp` 目录下时，优先使用上文手动全栈启动方式，然后执行：

```bash
E2E_M0_ENABLED=1 \
E2E_M3_ENABLED=1 \
E2E_M4_ENABLED=1 \
E2E_UI_ENABLED=1 \
E2E_DB_READY=1 \
E2E_API_URL=http://127.0.0.1:3001/api/v1 \
E2E_WEB_URL=http://127.0.0.1:3000 \
DATABASE_URL="postgresql://postgres@127.0.0.1:55432/project_delivery_manager_test" \
corepack pnpm test:e2e
```

若本机允许 Docker 且不要求复用 `/tmp/crm-manager-pg`，也可执行 `corepack pnpm test:e2e:full` 使用仓库一键编排的 disposable PostgreSQL 容器。

### P1 契约与迁移门禁

涉及 schema、接口或 DTO 变更时必须执行：

```bash
corepack pnpm --filter @project-delivery/api exec prisma validate --config ../../prisma.config.ts
corepack pnpm --filter @project-delivery/api exec prisma migrate status --config ../../prisma.config.ts
corepack pnpm --filter @project-delivery/api prisma:generate
corepack pnpm --filter @project-delivery/shared openapi:generate
```

要求：

- OpenAPI 可生成。
- 共享 schema 与 endpoint contracts 不引用未声明错误码。
- Prisma migration 可在空库上 `deploy` 成功。
- 新增 workspace 若声明 `test` 脚本，必须至少有最小测试，不允许空跑。

### P1 可访问性与视觉验收

自动化不完全覆盖的视觉和键盘体验必须手工验收：

- 浅色、深色、跟随系统。
- 中文、英文。
- 桌面和移动窄屏。
- Cmd+K、G+I/G+V/G+R/G+B、J/K、Enter、Esc。
- Dialog/Sheet 关闭后焦点回到触发按钮。
- 所有禁用按钮同时有视觉禁用和 `aria-disabled` 或原生 disabled。

## 全量功能测试矩阵

### M0 认证、Session 与工程基础

| ID      | 场景                  | 验证点                                                               | 层级           |
| ------- | --------------------- | -------------------------------------------------------------------- | -------------- |
| AUTH-01 | 注册成功              | 用户名密码注册成功，`users.name` 默认等于 username，返回统一响应     | API E2E/UI E2E |
| AUTH-02 | 注册校验              | 用户名长度/字符、密码长度、确认密码不一致返回统一错误                | Unit/API       |
| AUTH-03 | 重复用户名            | 第二次注册同名用户失败，不泄漏敏感信息                               | API            |
| AUTH-04 | 注册限流              | 按 IP 触发 `RATE_LIMITED`，HTTP 429，`retryAfterSeconds` 可展示      | API            |
| AUTH-05 | 登录成功              | 正确用户名密码建立 session，返回 AppSession                          | API E2E/UI E2E |
| AUTH-06 | 登录失败              | 用户不存在和密码错误均返回 `INVALID_CREDENTIALS`                     | API            |
| AUTH-07 | 登录限流              | 按 `username + IP` 触发 `RATE_LIMITED`                               | API            |
| AUTH-08 | Cookie 安全           | `HttpOnly`、`SameSite=Lax`，生产模式 `Secure`                        | API E2E        |
| AUTH-09 | Session 存储          | 数据库只保存 token hash，不保存明文 token                            | API/DB         |
| AUTH-10 | Session 轮换          | 重新登录产生新 session，旧 session 行为符合设计                      | API            |
| AUTH-11 | 登出                  | 当前 session 被撤销，后续受保护接口 401/403                          | API E2E        |
| AUTH-12 | 受保护资源            | 未登录访问 `/auth/session` 和业务接口被拒绝                          | API E2E        |
| AUTH-13 | 写接口 Origin/Referer | unsafe method 缺失或非法来源被拒绝，合法来源通过                     | API            |
| AUTH-14 | 修改密码              | 旧密码正确可修改，旧密码错误失败，确认密码校验                       | API/UI         |
| AUTH-15 | 用户偏好              | `locale`、`themeMode` 更新、刷新、跨设备 session 恢复                | API/UI         |
| AUTH-16 | AppSession 默认上下文 | recent org/space 合法时使用，不一致或无权限时重选一致上下文          | API            |
| AUTH-17 | 无组织空态            | 新用户无组织时展示创建组织/等待添加空态                              | UI E2E         |
| AUTH-18 | 统一响应              | 成功响应包含 `data/requestId`，错误响应包含 `code/message/requestId` | Unit/API       |
| AUTH-19 | 环境变量缺失          | 必填环境变量缺失有明确启动错误                                       | Manual         |
| AUTH-20 | requestId 日志        | 请求链路生成 requestId，并进入响应和日志                             | API            |
| AUTH-21 | 健康检查              | `GET /api/v1/health` 可用于 E2E 探测，API 启动后返回 2xx             | API/OPS        |

### 组织与租户边界

| ID     | 场景            | 验证点                                              | 层级           |
| ------ | --------------- | --------------------------------------------------- | -------------- |
| ORG-01 | 创建组织        | 登录用户创建组织并成为 `OWNER`                      | API E2E/UI E2E |
| ORG-02 | 组织列表        | 只返回当前用户有效成员组织                          | API/UI         |
| ORG-03 | 组织详情        | 成员可访问，非成员拒绝                              | API            |
| ORG-04 | 编辑组织        | `OWNER/ADMIN` 可更新名称、编码、状态，`MEMBER` 不可 | API/UI         |
| ORG-05 | 编码唯一        | 未删除组织编码唯一，冲突返回 `CONFLICT`             | API            |
| ORG-06 | 添加组织成员    | 支持 username/userId，目标用户必须存在              | API/UI         |
| ORG-07 | 重复添加成员    | 同一有效成员不可重复添加                            | API            |
| ORG-08 | 修改组织角色    | `OWNER/ADMIN` 可改，权限不足拒绝                    | API/UI         |
| ORG-09 | 禁用组织成员    | 禁用后不可访问组织和空间数据                        | API            |
| ORG-10 | 移除组织成员    | DELETE 软删除成员，列表和权限同步变化               | API/UI         |
| ORG-11 | 最后 OWNER 保护 | 禁用、降级、移除最后一个 `OWNER` 都失败             | API/UI         |
| ORG-12 | 跨组织访问      | orgA 用户访问 orgB 组织、空间和业务对象被拒绝       | API E2E        |
| ORG-13 | 组织切换        | Web 切换组织后空间、列表、看板和详情缓存隔离        | UI E2E         |
| ORG-14 | 创建组织限流    | 按 userId 限流，返回 `RATE_LIMITED`                 | API            |

### 项目空间与空间成员

| ID       | 场景             | 验证点                                                           | 层级       |
| -------- | ---------------- | ---------------------------------------------------------------- | ---------- |
| SPACE-01 | 创建空间         | `OWNER/ADMIN` 创建空间，创建人成为空间管理员                     | API E2E/UI |
| SPACE-02 | 空间列表         | 按组织返回可访问空间，不串组织                                   | API/UI     |
| SPACE-03 | 空间详情         | 返回 organizationId、负责人、状态、staleThresholdDays            | API/UI     |
| SPACE-04 | 更新空间         | 名称、编码、描述、负责人、状态、阈值可保存                       | API/UI     |
| SPACE-05 | 空间编码唯一     | 同组织内唯一，不同组织可重复                                     | API        |
| SPACE-06 | 添加空间成员     | 目标用户必须先是同组织成员                                       | API/UI     |
| SPACE-07 | 修改空间成员角色 | 覆盖 `SPACE_ADMIN/PM/DEVELOPER/TESTER/REQUIREMENT/MEMBER/VIEWER` | API/UI     |
| SPACE-08 | 禁用空间成员     | 禁用后列表和对象访问均拒绝                                       | API        |
| SPACE-09 | 非空间成员访问   | 非空间成员不能访问空间业务数据                                   | API E2E    |
| SPACE-10 | VIEWER 只读      | 可看不可写，前端隐藏或禁用写按钮，后端拒绝写请求                 | API/UI     |
| SPACE-11 | 阈值范围         | `staleThresholdDays` 合法范围 1-30，非法值失败                   | API/UI     |
| SPACE-12 | 默认流程初始化   | 创建空间后自动复制并发布开发任务、通用任务、Bug 三套默认流程     | API E2E    |
| SPACE-13 | 历史空间补齐     | 缺少默认流程的空间可兜底初始化                                   | API        |

### 版本

| ID         | 场景     | 验证点                                     | 层级   |
| ---------- | -------- | ------------------------------------------ | ------ |
| VERSION-01 | 创建版本 | 名称、目标、描述、负责人、时间、状态可创建 | API/UI |
| VERSION-02 | 版本列表 | 按空间过滤，不返回其他空间或组织数据       | API/UI |
| VERSION-03 | 版本详情 | 返回需求数、任务数、Bug 数、阻塞数所需字段 | API/UI |
| VERSION-04 | 更新版本 | 维护负责人、状态、目标时间、发布时间       | API/UI |
| VERSION-05 | 名称唯一 | 同空间版本名唯一，跨空间不冲突             | API    |
| VERSION-06 | 权限     | PM/SPACE_ADMIN 可维护，VIEWER 不可维护     | API/UI |
| VERSION-07 | 看板入口 | 版本下拉切换版本后看板按版本刷新           | UI E2E |

### 需求文档与 Tiptap

| ID     | 场景            | 验证点                                                         | 层级           |
| ------ | --------------- | -------------------------------------------------------------- | -------------- |
| REQ-01 | 创建 DRAFT      | `POST /spaces/:spaceId/requirements` 可空 body，空间来自路径   | API E2E/UI E2E |
| REQ-02 | 空草稿列表      | 默认列表隐藏空 DRAFT，本人草稿可通过指定入口访问               | API/UI         |
| REQ-03 | 保存需求        | 标题、摘要、Tiptap JSON、纯文本、版本、优先级、负责人保存      | API/UI         |
| REQ-04 | 状态流转        | `DRAFT/CONFIRMED/ARCHIVED` 三态符合 MVP 口径                   | API/UI         |
| REQ-05 | 编辑器内容      | 基础编辑、表格、任务列表、链接、代码块保存和回读               | UI             |
| REQ-06 | 图片粘贴上传    | 粘贴图片走附件 presign/register，正文不保存 base64             | API/UI E2E     |
| REQ-07 | 图片上传失败    | 上传失败保留错误态，允许重试，不污染正文                       | UI             |
| REQ-08 | DRAFT 限制      | 图片上传必须绑定已有需求；需要草稿状态时返回明确错误           | API/UI         |
| REQ-09 | 版本筛选        | 按版本筛选需求                                                 | API/UI         |
| REQ-10 | 负责人筛选      | 按负责人筛选需求                                               | API/UI         |
| REQ-11 | 状态筛选        | 按状态筛选需求                                                 | API/UI         |
| REQ-12 | 详情属性        | 展示状态、ID、版本、负责人、优先级、附件数、作者、最后修改时间 | UI             |
| REQ-13 | 关联展示        | 需求详情展示关联任务和 Bug；MVP 内置关联为空时稳定空态         | UI/API         |
| REQ-14 | 权限            | REQUIREMENT/PM/SPACE_ADMIN 可维护；VIEWER 只读；非成员拒绝     | API/UI         |
| REQ-15 | 软删除草稿      | 用户取消空草稿后软删除，孤儿文件进入清理策略                   | API/Manual     |
| REQ-16 | 自定义内容 i18n | 用户自定义需求正文不被自动翻译                                 | UI             |

### 事项池

| ID        | 场景       | 验证点                                                                      | 层级       |
| --------- | ---------- | --------------------------------------------------------------------------- | ---------- |
| INTAKE-01 | 创建事项   | 标题、描述、来源类型、版本、需求、优先级、推进人                            | API/UI     |
| INTAKE-02 | 来源类型   | 覆盖所有 `IntakeSourceType` 枚举                                            | Unit/API   |
| INTAKE-03 | 列表筛选   | 按版本、需求、状态、优先级、推进人筛选                                      | API/UI     |
| INTAKE-04 | 更新事项   | 可更新来源对象、版本、需求、标题、优先级、推进人                            | API/UI     |
| INTAKE-05 | 纳入       | `PENDING -> ACCEPTED`，记录 acceptedAt 和时间线                             | API/UI     |
| INTAKE-06 | 暂缓       | `PENDING -> DEFERRED`，重复或非法状态失败                                   | API/UI     |
| INTAKE-07 | 拒绝       | `PENDING -> REJECTED`，重复或非法状态失败                                   | API/UI     |
| INTAKE-08 | 一拆一     | `ACCEPTED` 事项拆解 1 个任务，事项变 `CONVERTED`                            | API E2E/UI |
| INTAKE-09 | 一拆多     | 一次拆解多个任务，每个任务保留原事项关联                                    | API E2E/UI |
| INTAKE-10 | 未纳入拆解 | 非 `ACCEPTED` 拆解返回 `INTAKE_ITEM_NOT_ACCEPTED`                           | API        |
| INTAKE-11 | 重复拆解   | 已 `CONVERTED` 再拆解返回 `INTAKE_ITEM_ALREADY_CONVERTED`，不生成第二批任务 | API E2E    |
| INTAKE-12 | 权限       | MEMBER 可创建事项，PM/SPACE_ADMIN 可 triage，非成员拒绝                     | API/UI     |

### 任务与工作项

| ID      | 场景                 | 验证点                                                              | 层级           |
| ------- | -------------------- | ------------------------------------------------------------------- | -------------- |
| WORK-01 | 创建任务             | `TASK` 创建成功，绑定默认流程版本和初始状态                         | API E2E/UI E2E |
| WORK-02 | 禁止 M2 BUG 入口混用 | 工作项创建接口 task-only，Bug 走 Bug 入口                           | Unit/API       |
| WORK-03 | 列表筛选             | 按版本、负责人、状态分类、优先级、需求、事项筛选                    | API/UI         |
| WORK-04 | 详情                 | 返回 `PermissionSnapshot`、关联版本/需求/事项/提交人                | API/UI         |
| WORK-05 | 更新任务             | 标题、描述、负责人、优先级、截止时间、关联字段可更新                | API/UI         |
| WORK-06 | 负责人变更           | object_participants 更新 ASSIGNEE，时间线写入 ASSIGNEE_CHANGED      | API            |
| WORK-07 | 状态不可直接改       | 工作项状态只能通过流程动作推进                                      | API            |
| WORK-08 | 开始处理             | 默认开发任务从待处理到处理中                                        | API E2E/UI     |
| WORK-09 | 标记阻塞             | 必填阻塞原因，状态归类为 WAITING，写 blockedReason/blockedAt        | API/UI         |
| WORK-10 | 解除阻塞             | 清空当前阻塞说明并回到目标状态                                      | API/UI         |
| WORK-11 | 提交提测             | 必填提测说明，进入待提测/测试相关状态                               | API/UI         |
| WORK-12 | 测试退回             | TESTER/PM 可退回，必填退回原因                                      | API/UI         |
| WORK-13 | 测试通过             | 进入已完成，关闭时间与状态归类正确                                  | API/UI         |
| WORK-14 | 取消任务             | PM/SPACE_ADMIN 可取消，必填取消原因                                 | API/UI         |
| WORK-15 | 通用任务流程         | 开始处理、提交确认、确认完成、退回处理、取消任务完整覆盖            | API            |
| WORK-16 | 动作权限             | 负责人、PM、SPACE_ADMIN、TESTER 等角色命中规则；无权限动作不返回    | API/UI         |
| WORK-17 | 动作并发             | 当前状态已变化后旧 action 执行返回状态冲突                          | API            |
| WORK-18 | 详情抽屉             | 动作、评论、附件、时间线、关联 Tab 全部可用                         | UI E2E         |
| WORK-19 | 列表显示             | assignee/version 使用 lookups 显示真实姓名/版本名，不显示 ULID 末位 | UI             |

### Bug

| ID     | 场景       | 验证点                                               | 层级       |
| ------ | ---------- | ---------------------------------------------------- | ---------- |
| BUG-01 | 创建 Bug   | 独立入口创建 `BUG`，`bugId === workItemId`           | API E2E/UI |
| BUG-02 | Bug 字段   | 严重程度、复现步骤、期望结果、实际结果保存和回读     | API/UI     |
| BUG-03 | Bug 列表   | 按版本、负责人、状态、严重程度、关联任务筛选         | API/UI     |
| BUG-04 | 更新 Bug   | 修复说明、回归结论、回归人、回归时间、关联任务可更新 | API/UI     |
| BUG-05 | 类型校验   | `/bugs/:id` 必须对应 `type=BUG` 的 work item         | API        |
| BUG-06 | 确认缺陷   | TESTER/PM/SPACE_ADMIN 可确认，选择修复负责人         | API/UI     |
| BUG-07 | 拒绝缺陷   | 必填拒绝原因，进入已拒绝                             | API/UI     |
| BUG-08 | 开始修复   | 负责人/DEVELOPER/PM/SPACE_ADMIN 可执行               | API/UI     |
| BUG-09 | 提交回归   | 必填修复说明，进入待回归                             | API/UI     |
| BUG-10 | 回归通过   | 必填回归结论，进入回归通过                           | API/UI     |
| BUG-11 | 回归不通过 | 必填不通过原因，回到修复中                           | API/UI     |
| BUG-12 | 关闭缺陷   | TESTER/PM/SPACE_ADMIN 可关闭                         | API/UI     |
| BUG-13 | 重新打开   | 已关闭 Bug 可按权限重新打开，必填重开原因            | API/UI     |
| BUG-14 | 关联一致性 | Bug 的版本、需求、相关任务与工作项一致可追溯         | API/UI     |

### 流程配置与动作执行

| ID    | 场景             | 验证点                                                                              | 层级       |
| ----- | ---------------- | ----------------------------------------------------------------------------------- | ---------- |
| WF-01 | 默认流程模板     | 三套默认流程状态、动作、表单字段和权限矩阵完整                                      | Unit/API   |
| WF-02 | 流程列表         | 按空间返回定义列表，权限过滤正确                                                    | API/UI     |
| WF-03 | 新建流程         | 创建流程定义，编码唯一                                                              | API/UI     |
| WF-04 | 编辑流程定义     | 修改名称、描述，编码规则符合约束                                                    | API/UI     |
| WF-05 | 版本列表         | 查看 `DRAFT/PUBLISHED/DISABLED` 版本，按 version desc                               | API/UI     |
| WF-06 | 复制版本         | 复制默认或已发布版本为草稿，源版本下拉默认最新 PUBLISHED                            | API/UI     |
| WF-07 | 草稿编辑         | DRAFT 可编辑状态、动作、动作表单字段                                                | API/UI     |
| WF-08 | 已发布只读       | PUBLISHED 所有写按钮禁用，后端也拒绝直接修改                                        | API/UI     |
| WF-09 | 停用版本         | PUBLISHED 可停用，历史工作项继续展示和流转                                          | API        |
| WF-10 | 禁用默认绑定保护 | 停用默认流程前必须指定新默认，否则禁止新建对应工作项                                | API        |
| WF-11 | 状态 CRUD        | code/name/category/isStart/isEnd/order 增改删                                       | API/UI     |
| WF-12 | 动作 CRUD        | fromState/toState/roles/actorRelations/requiresComment/order 增改删                 | API/UI     |
| WF-13 | 表单字段 CRUD    | key/label/fieldType/required/options/order 增改删                                   | API/UI     |
| WF-14 | 发布成功         | 有唯一开始状态、至少一个结束状态、非结束状态出动作、目标存在、无孤立状态            | API/UI     |
| WF-15 | 发布失败         | 无开始、多个开始、无结束、孤立状态、目标不存在、非结束无出动作均失败                | API/UI     |
| WF-16 | 绑定 CRUD        | 流程绑定任务或 Bug，默认绑定唯一，停用版本不可用于新建                              | API/UI     |
| WF-17 | 动作可见性       | 当前状态不可用动作不返回给前端                                                      | API/UI     |
| WF-18 | 动作表单校验     | 必填字段缺失、类型错误、选项非法失败                                                | API/UI     |
| WF-19 | 动作评论校验     | `requiresComment=true` 时缺评论失败                                                 | API/UI     |
| WF-20 | 动作执行副作用   | 更新状态、状态归类、lastStatusChangedAt、lastActionAt、时间线，返回最新动作         | API E2E/UI |
| WF-21 | 动作权限关系     | 空间角色 OR `WorkflowActorRelation` 命中即可执行，枚举不与 object participants 混用 | API        |
| WF-22 | 流程配置全页     | `/workflow/[workflowId]` 顶栏、版本切换、发布/停用/复制、状态/动作/字段列表完整可用 | UI E2E     |

### 评论、附件、时间线和审计

| ID          | 场景           | 验证点                                                         | 层级       |
| ----------- | -------------- | -------------------------------------------------------------- | ---------- |
| COMMENT-01  | 评论目标       | 支持 `REQUIREMENT/INTAKE_ITEM/WORK_ITEM`，非法目标失败         | API        |
| COMMENT-02  | 创建评论       | 有权限用户可评论，写入 COMMENTER 参与关系和时间线              | API/UI E2E |
| COMMENT-03  | 评论列表       | 按目标分页、按时间展示，不跨对象串数据                         | API/UI     |
| COMMENT-04  | 评论权限       | VIEWER 可否评论按后端 `canComment`，非成员拒绝                 | API/UI     |
| ATTACH-01   | 预签名         | `targetType/targetId/fileName/mimeType/size` 必填并绑定目标    | API/UI     |
| ATTACH-02   | MIME 白名单    | 图片、PDF、Office、文本/Markdown/CSV、zip 通过，非法 MIME 失败 | API        |
| ATTACH-03   | 大小限制       | 单文件 20MB 限制生效                                           | API/UI     |
| ATTACH-04   | 数量限制       | 单对象最多 20 个附件                                           | API        |
| ATTACH-05   | 登记附件       | 上传后 register 二次校验对象、权限、MIME、size、数量           | API/UI     |
| ATTACH-06   | 附件列表       | 目标对象附件列表和 previewUrl 回读                             | API/UI     |
| ATTACH-07   | 下载 URL       | 每次按当前权限签发，5 分钟有效                                 | API/UI     |
| ATTACH-08   | 上传 URL       | 预签名上传 URL 10 分钟有效                                     | API        |
| ATTACH-09   | 孤儿文件       | 未登记文件或草稿删除后失去引用文件进入清理策略                 | Manual/API |
| TIMELINE-01 | 创建事件       | 创建需求、事项、任务、Bug 写 CREATED                           | API        |
| TIMELINE-02 | 更新事件       | 关键字段变更写 UPDATED 或专用事件                              | API        |
| TIMELINE-03 | 动作事件       | 流程动作写 STATUS_CHANGED/ACTION_EXECUTED                      | API E2E    |
| TIMELINE-04 | 附件/评论事件  | 附件和评论分别写 ATTACHMENT_ADDED/COMMENTED                    | API        |
| TIMELINE-05 | 排序           | 时间线按创建时间倒序，分页稳定                                 | API/UI     |
| TIMELINE-06 | 不可篡改       | 普通用户不能修改历史事件                                       | API        |
| AUDIT-01    | 登录登出审计   | LOGIN/LOGOUT 可追溯                                            | API/DB     |
| AUDIT-02    | 权限拒绝审计   | ACCESS_DENIED 写入组织边界和 requestId                         | API/DB     |
| AUDIT-03    | 关键写操作审计 | CREATE/UPDATE/DELETE/ROLE_CHANGED/SESSION_REVOKED 可追溯       | API/DB     |

### 聚合视图

| ID      | 场景             | 验证点                                                      | 层级       |
| ------- | ---------------- | ----------------------------------------------------------- | ---------- |
| VIEW-01 | 我的工作台组织级 | `organizationId` 必填，不传 `spaceId` 返回组织内可见待办    | API E2E/UI |
| VIEW-02 | 我的工作台空间级 | 传 `spaceId` 后按空间收窄                                   | API E2E/UI |
| VIEW-03 | 我的任务/Bug     | 展示分配给自己的任务和 Bug                                  | API/UI     |
| VIEW-04 | 待处理动作       | 展示待自己执行的流程动作                                    | API/UI     |
| VIEW-05 | 即将到期         | dueDate 近期待办正确归类                                    | API/UI     |
| VIEW-06 | 阻塞中           | 阻塞状态按流程状态事实源归类                                | API/UI     |
| VIEW-07 | 最近动态         | 最近时间线按组织/空间上下文展示                             | API/UI     |
| VIEW-08 | 空间总览         | 版本进度、KPI、异常分布、最近时间线                         | API/UI     |
| VIEW-09 | 版本看板         | 6 个系统状态列，任务/Bug 按状态分类归列                     | API E2E/UI |
| VIEW-10 | 看板筛选         | 按负责人、状态归类筛选                                      | API/UI     |
| VIEW-11 | 看板刷新         | 动作执行后卡片列变化正确                                    | API E2E/UI |
| VIEW-12 | 延期异常         | 截止已过且未完成/未终止进入 overdue                         | API/UI     |
| VIEW-13 | 阻塞异常         | 阻塞状态进入 blocked                                        | API/UI     |
| VIEW-14 | 待确认异常       | 待确认类状态进入 pending_confirm                            | API/UI     |
| VIEW-15 | 待回归异常       | Bug 待回归进入 pending_regression                           | API/UI     |
| VIEW-16 | 长时间未流转     | 按 `lastStatusChangedAt` 和空间阈值计算 stale，不扫描时间线 | API E2E/UI |
| VIEW-17 | 阈值更新刷新     | 修改 `staleThresholdDays` 后异常视图按新阈值刷新            | API E2E/UI |
| VIEW-18 | 视图隔离         | 我的工作台、总览、看板、异常视图不展示其他组织数据          | API E2E/UI |

### Web IA、页面与交互

| ID    | 场景                | 验证点                                                             | 层级          |
| ----- | ------------------- | ------------------------------------------------------------------ | ------------- |
| UI-01 | 登录页              | `/zh-CN/login` 和 `/en-US/login` 可访问，表单、错误、主题/语言可用 | UI E2E        |
| UI-02 | 注册页              | 注册成功自动登录，进入应用壳或无组织空态                           | UI E2E        |
| UI-03 | 应用壳              | 未登录重定向，登录后显示 top bar、sidebar、用户菜单                | UI            |
| UI-04 | 左侧导航            | 工作/推进/沉淀/配置分组，OWNER/ADMIN 可见组织入口                  | UI            |
| UI-05 | 组织切换器          | 展示组织、空间、创建组织、创建空间入口                             | UI E2E        |
| UI-06 | 命令面板            | Cmd+K 打开，少于 2 字符展示导航/创建/切空间/偏好/最近打开          | UI E2E        |
| UI-07 | 命令搜索            | 输入 >=2 字符展示任务/Bug/需求/事项结果并可跳转                    | UI E2E        |
| UI-08 | 最近打开            | localStorage 持久化、复合去重、倒序、上限 5-7，空时不展示          | UI            |
| UI-09 | 全局快捷键          | G+I/G+V/G+R/G+B 在非输入状态跳转                                   | UI            |
| UI-10 | 列表键盘导航        | J/K 选择、Enter 打开、Esc 关闭、焦点回收                           | UI/Manual     |
| UI-11 | 工作台页面          | KPI chip、三组任务、最近动态、缺字段降级为 `-`                     | UI            |
| UI-12 | 任务页              | 分桶筛选、创建 dialog、行点击抽屉、加载/错误/空态                  | UI E2E        |
| UI-13 | Bug 页              | 分桶筛选、创建 dialog、行点击抽屉、Bug 字段展示                    | UI            |
| UI-14 | 事项池页            | 纳入/暂缓/拒绝/拆解任务 dialog、加载/错误/空态                     | UI            |
| UI-15 | 需求列表页          | 状态筛选、新建 DRAFT、跳转详情                                     | UI E2E        |
| UI-16 | 需求详情页          | Notion 风外壳、属性条、Tiptap、图片上传                            | UI E2E/Manual |
| UI-17 | 版本看板页          | 版本下拉、6 列、顶栏新建任务、列内加号预填版本                     | UI E2E        |
| UI-18 | 异常视图页          | 5 Tab、每类空态/错误/数据态                                        | UI            |
| UI-19 | 空间总览页          | KPI、版本进度、异常分布、最近时间线                                | UI            |
| UI-20 | 流程列表页          | 新建、编辑元数据、复制版本、配置跳转                               | UI            |
| UI-21 | 流程配置全页        | 状态/动作/字段编辑、发布校验、只读态、返回                         | UI E2E        |
| UI-22 | 空间设置页          | 基础信息、阈值、成员新增/编辑角色                                  | UI            |
| UI-23 | 组织页              | 组织信息、成员新增/改角色/移除、最后 OWNER 禁用态                  | UI            |
| UI-24 | 详情抽屉            | 动作、评论、附件、时间线、关联 Tab，权限按钮显隐                   | UI E2E        |
| UI-25 | Loading/Error/Empty | 所有 11 个 MVP 页面都有稳定加载、错误重试、空态                    | UI            |
| UI-26 | data-testid         | E2E selector 使用 kebab-case 业务语义，不依赖中英文文案            | Review        |

### 国际化与主题

| ID       | 场景       | 验证点                                              | 层级          |
| -------- | ---------- | --------------------------------------------------- | ------------- |
| I18N-01  | 中文默认   | 默认 `zh-CN` 路径和文案正确                         | UI            |
| I18N-02  | 英文路径   | `/en-US` 路径文案、枚举、错误、表单校验为英文       | UI E2E        |
| I18N-03  | 语言切换   | 切换后不重置当前路由，不丢当前页面上下文            | UI            |
| I18N-04  | 偏好持久化 | 刷新和重新登录后保持语言偏好                        | API/UI        |
| I18N-05  | 用户内容   | 需求正文、评论、附件名、标题不自动翻译              | UI            |
| I18N-06  | 缺失 key   | 开发期或测试期失败，生产回退符合设计                | Unit/UI       |
| THEME-01 | 浅色       | 登录页、应用壳、表格、抽屉、弹窗、看板、Tiptap 可读 | UI/Manual     |
| THEME-02 | 深色       | 全页面可读，状态色和语义 token 正确                 | UI E2E/Manual |
| THEME-03 | 跟随系统   | `SYSTEM` 模式随系统切换                             | UI            |
| THEME-04 | 持久化     | 刷新和重新登录后保持主题偏好                        | API/UI        |
| THEME-05 | 无明显闪烁 | next-themes 初始化无明显布局跳动或主题闪烁          | Manual        |

### 数据一致性、缓存和软删除

| ID      | 场景                         | 验证点                                                   | 层级   |
| ------- | ---------------------------- | -------------------------------------------------------- | ------ |
| DATA-01 | 组织边界                     | 所有空间内对象可严格推导 organizationId                  | API/DB |
| DATA-02 | 空间成员前置                 | 空间成员必须先是同组织成员                               | API    |
| DATA-03 | 业务唯一约束                 | 组织/空间内唯一约束不造成跨组织冲突                      | API/DB |
| DATA-04 | 软删除唯一                   | soft-delete 后同一业务编码可按设计重建                   | API/DB |
| DATA-05 | object_participants 生命周期 | 创建、负责人变更、评论、关联、解除关联、成员禁用均正确   | API    |
| DATA-06 | 工作项和 Bug 主键            | Bug 详情主键等于工作项 ID                                | API/DB |
| DATA-07 | 状态归类一致                 | `currentStateId` 与 `statusCategory` 始终一致            | API/DB |
| DATA-08 | 阻塞事实源                   | 阻塞以流程状态为准，不存在独立 boolean 冲突              | API/DB |
| DATA-09 | 时间线一致                   | 时间线事件与实际状态变化一致                             | API/DB |
| DATA-10 | 前端缓存 key                 | 缓存包含 organizationId/spaceId，切组织/空间不复用旧数据 | UI     |
| DATA-11 | lookups 缓存                 | 成员和版本 lookup in-flight 去重，切空间后数据正确       | UI     |
| DATA-12 | recent cookie                | recent org/space 只作为默认选择，不作为授权事实源        | API/UI |

### 非功能测试

| ID      | 场景         | 验证点                                                                           | 层级             |
| ------- | ------------ | -------------------------------------------------------------------------------- | ---------------- |
| PERF-01 | 数据基线     | 单组织 20 用户、5 空间、每空间 10 版本、200 任务、100 Bug、100 需求、5000 时间线 | API/Manual       |
| PERF-02 | 常用列表     | 列表接口 P95 < 500ms                                                             | Manual/Benchmark |
| PERF-03 | 看板/异常    | 看板和异常视图 P95 < 800ms                                                       | Manual/Benchmark |
| PERF-04 | 页面首屏     | 本地首屏可接受，无明显阻塞                                                       | Manual           |
| SEC-01  | 密码安全     | argon2id，不落明文                                                               | API/DB           |
| SEC-02  | CSRF 基线    | 写接口 Origin/Referer 防护                                                       | API              |
| SEC-03  | 权限越权     | 非组织/非空间/无角色/VIEWER 写操作全拒绝                                         | API E2E          |
| SEC-04  | 文件访问     | 下载 URL 每次鉴权，过期后不可用                                                  | API              |
| SEC-05  | 错误不泄漏   | 认证、权限、对象不存在不泄漏敏感内部信息                                         | API              |
| OPS-01  | 迁移空库     | `/tmp` 空库 migrate deploy 成功                                                  | Manual           |
| OPS-02  | 迁移重复执行 | migrate deploy 可重复执行且 status clean                                         | Manual           |
| OPS-03  | 生成产物     | Prisma generate、OpenAPI generate 成功                                           | CI               |
| OPS-04  | 进程清理     | E2E 后 API/Web/PG 可完全停止，无孤儿进程                                         | Manual           |

## 端到端主链路

### FULL-01 MVP 主业务闭环

1. 用户注册并自动登录。
2. 创建组织并成为 `OWNER`。
3. 创建项目空间，自动初始化默认流程。
4. 添加组织成员：项目经理、开发、测试、需求、成员、只读。
5. 添加空间成员并分配角色。
6. 创建版本。
7. 创建需求 DRAFT，保存为有效需求，粘贴上传图片。
8. 创建事项，关联版本和需求。
9. 项目经理纳入事项。
10. 事项拆解为多个开发任务。
11. 开发开始处理任务。
12. 开发标记阻塞并解除阻塞。
13. 开发提交提测。
14. 测试退回。
15. 开发再次提交提测。
16. 测试通过，任务完成。
17. 测试创建 Bug，关联版本、需求和任务。
18. 测试确认缺陷并分配开发。
19. 开发开始修复并提交回归。
20. 测试回归不通过，退回修复中。
21. 开发再次提交回归。
22. 测试回归通过并关闭 Bug。
23. 项目经理查看我的工作台、空间总览、版本看板、异常视图。
24. 项目经理修改长时间未流转阈值，异常视图刷新。
25. 全部关键动作在时间线可追溯。
26. 切换英文后系统 UI、枚举、校验和错误展示为英文。
27. 切换深色后工作台、看板、详情抽屉、异常视图、Tiptap 可读。
28. 切换到另一个组织，确认列表、看板、详情、缓存均不串数据。

### FULL-02 流程配置闭环

1. 空间管理员进入流程列表。
2. 查看默认流程和版本列表。
3. 从已发布版本复制草稿。
4. 新增状态。
5. 新增动作。
6. 新增动作表单字段。
7. 发布前制造校验错误并确认前端/后端均阻止。
8. 修复错误后发布成功。
9. 已发布版本进入只读态。
10. 绑定新流程为任务或 Bug 默认流程。
11. 新建任务或 Bug 使用新流程。
12. 停用旧版本，历史工作项仍可展示。

### FULL-03 权限与租户隔离闭环

1. 创建 `orgA` 和 `orgB`。
2. 在两个组织创建同编码空间，确认不冲突。
3. `orgA` 用户访问 `orgB` 空间、需求、任务、Bug、附件、视图均被拒绝。
4. `VIEWER` 可看不可写。
5. `DEVELOPER` 只看到和自己相关的任务/Bug 修复动作。
6. `TESTER` 可看 Bug 和待测/待回归任务，并执行测试动作。
7. `REQUIREMENT` 可维护需求、创建事项。
8. `PM/SPACE_ADMIN` 可管理空间内业务对象和流程。
9. 禁用空间成员后，即使命中 object_participants 也不可访问。
10. 移除组织成员后，组织和空间访问全部失效。

## 自动化测试增补建议

当前仓库已有 shared/API/Web vitest，以及 14 个 Playwright spec 文件 / 21 个 Playwright 用例，其中 UI E2E 为 11 个 spec / 12 个用例。已补齐 Bug、需求池、版本看板、异常页、空间设置、组织管理和流程配置页的基础 UI 主链路；为达到本计划“全量功能点无遗漏”的发布目标，仍建议补齐以下自动化用例：

- API E2E：M1 组织/空间/版本/需求完整链路，独立覆盖最后 OWNER、空间成员必须属于组织、需求图片、空 DRAFT 隐藏。
- API E2E：M2 事项池 CRUD、纳入/暂缓/拒绝、一拆多、重复拆解拒绝。
- API E2E：流程配置全页背后的状态/动作/字段 CRUD、发布失败矩阵、停用默认流程保护。
- API E2E：附件 MIME/大小/数量/下载 URL 权限与时效。
- API E2E：审计日志关键写操作和 ACCESS_DENIED 追溯。
- UI E2E：需求图片粘贴上传和失败重试。
- UI E2E：版本看板顶栏/列内新建任务并校验版本预填。
- UI E2E：异常阈值修改后 stale 列表刷新。
- UI E2E：流程配置全页发布/停用实际执行、表单字段新增/编辑/删除。
- UI E2E：组织页成员添加/移除成功路径和失败回滚。
- UI E2E：空间设置成员添加、角色编辑、禁用成功路径和 VIEWER 写按钮禁用。
- UI E2E：英文 + 深色覆盖工作台、看板、抽屉、异常视图、需求编辑器。
- UI E2E：全局快捷键和列表键盘导航焦点回收。
- 性能脚本：按 20 人团队数据基线生成测试数据并采集列表、看板、异常视图 P95。

## 验收退出标准

全部满足后方可判定全量测试通过：

- P0 默认门禁全绿。
- P0 发布门禁真实执行，不是 skip。
- `/tmp` PostgreSQL 空库迁移和重复迁移通过。
- M0-M4 全量功能矩阵 P0/P1 场景均有自动化或手工验收记录。
- 所有 API 响应通过 shared schema 或等价断言校验。
- 租户隔离、权限、流程动作、附件、安全类场景无阻塞缺陷。
- 中文/英文、浅色/深色、核心键盘路径通过。
- 性能基线无明显超标；若超标，需记录原因和是否阻塞发布。
- 未关闭缺陷均有等级、影响范围、规避方式和负责人。

## 缺陷分级

- P0 阻塞：数据串租户、权限越权、登录/创建组织/创建空间/主链路不可用、迁移失败、真实 E2E 无法执行。
- P1 严重：流程动作错误、事项重复拆解、附件安全限制失效、最后 OWNER 保护失效、看板/异常核心数据错误。
- P2 一般：局部表单校验、文案、空态、错误态、键盘体验、视觉不一致。
- P3 轻微：非核心布局 polish、低频提示文案、非阻塞可访问性细节。

## 回归策略

- 认证、权限、租户隔离、迁移、shared contracts 变更：全量 P0 + 对应模块 P1 + 真实 E2E。
- Prisma schema 或 migration 变更：空库 migrate deploy、migrate status、Prisma generate、相关 API E2E。
- Workflow 变更：默认流程、流程配置、动作执行、Bug/任务流转、异常视图全回归。
- Attachment/Tiptap 变更：需求图片、工作项附件、下载 URL、MIME/大小/数量限制全回归。
- Web IA/路由变更：11 个 MVP 页面、命令面板、应用壳、E2E selector、i18n/theme 全回归。
- i18n/theme 变更：中英文、浅深色、登录前后、持久化、缺 key 检查全回归。
