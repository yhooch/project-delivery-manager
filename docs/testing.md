# 测试说明

## 单元/契约测试

运行：

```bash
corepack pnpm test
```

根脚本会执行各 workspace 的 `test` 脚本。当前启用 `test` 脚本的
workspace（API、Web、shared）都有测试文件，因此不再使用
`--passWithNoTests`；如果新增无测试 workspace，不要直接加空跑测试脚本，
应先补最小测试，或暂不声明 `test` 脚本。

## M0 E2E

运行：

```bash
corepack pnpm test:e2e
```

E2E 使用 Playwright，测试文件位于 `tests/e2e/`。默认情况下，M0 主链路会跳过，避免在 API、Web 或测试数据库尚未准备好时产生假失败。
`corepack pnpm test:e2e:full` 会自动启动一次性测试环境并启用
M0/M3/M4/UI 主链路。

Playwright API request 不会自动像浏览器页面一样带上来源信息。M0 E2E 会在 `POST` / `PATCH` 等 unsafe methods 上带 `Origin` 与 `Referer`，默认取 `E2E_WEB_URL` 的 origin，用于满足 API 的写请求 Origin 防护。

生产模式 API 会给 session cookie 设置 `Secure`。当验收环境使用 HTTP localhost 时，E2E 会从登录响应的 `Set-Cookie` 中提取 cookie name/value，并在后续请求显式带 `Cookie` header；这只影响测试请求，不改变 API guard 或 cookie 策略。

### 启用条件

执行真实 M0 主链路前需要满足：

- API 已启动并暴露 `GET /api/v1/health`。
- API 连接的是可丢弃的测试数据库，不要使用开发或生产数据。
- 测试数据库已执行 Prisma migration。
- 如需把 Web 可用性作为前置条件，Web 已启动。

示例：

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/project_delivery_manager_test"
corepack pnpm --filter @project-delivery/api prisma:migrate
PORT=3001 DATABASE_URL="$DATABASE_URL" corepack pnpm dev:api
```

另开终端执行：

```bash
E2E_M0_ENABLED=1 \
E2E_DB_READY=1 \
E2E_API_URL=http://127.0.0.1:3001/api/v1 \
corepack pnpm test:e2e
```

如果需要检查 Web 前置条件：

```bash
corepack pnpm dev:web

E2E_M0_ENABLED=1 \
E2E_DB_READY=1 \
E2E_REQUIRE_WEB=1 \
E2E_WEB_URL=http://127.0.0.1:3000 \
corepack pnpm test:e2e
```

### Skip 机制

M0 E2E 会在以下情况明确跳过并返回成功：

- 未设置 `E2E_M0_ENABLED=1`。
- 未设置 `E2E_DB_READY=1`。
- API health 不可访问。
- 设置了 `E2E_REQUIRE_WEB=1` 但 Web 不可访问。

已纳入 M0 的 API 端点返回 `404` 或 `501` 会失败，用于防止路由误删后仍然绿灯。

### 覆盖的 M0 骨架步骤

- 注册新用户：`POST /auth/register`
- 登录并建立 session：`POST /auth/login`
- 读取当前 session：`GET /auth/session`
- 创建组织：`POST /organizations`
- 更新用户偏好：`PATCH /users/me/preferences`
- 登出：`POST /auth/logout`
- 登出后受保护接口拒绝访问：`GET /auth/session` 应返回 `401` 或 `403`

测试请求和响应会使用 `packages/shared/src` 中的契约 schema 做基础校验。

## M3 E2E

M3 主链路测试位于 `tests/e2e/m3-main-flow.api.spec.ts`。它使用独立的
`E2E_M3_ENABLED=1` 开关，不依赖 `E2E_M0_ENABLED`；`test:e2e:full` 会默认启用它。

覆盖范围包含流程动作、Bug、时间线、权限、空间/租户隔离、审计日志，
并补充了两个验收链路：

- 需求图片附件：创建需求草稿、获取上传预签名 URL、登记图片附件、列表回读、需求详情回读和下载 URL。
- 事项拆解多任务：创建并接受 intake item，一次转换为两个任务，校验任务关联 intake/需求/版本/负责人，并验证重复转换被拒绝。

## M4/MVP E2E

M4/MVP 主链路测试位于 `tests/e2e/m4-mvp-main-flow.api.spec.ts`。它是 Playwright API E2E，不要求默认启动浏览器或 Web dev server；默认 `corepack pnpm test:e2e` 未设置真实环境开关时会明确跳过并返回成功。

### 启用条件

执行真实 M4/MVP E2E 前需要满足：

- API 已启动并暴露 `GET /api/v1/health`。
- API 连接的是可丢弃的 PostgreSQL 测试数据库，不要使用开发或生产数据。
- 测试数据库已执行 Prisma migration。
- 如需把 Web 可用性作为前置条件，Web 已启动并设置 `E2E_REQUIRE_WEB=1`。

默认本地连接串可使用：

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/project_delivery_manager"
```

如果需要临时 PostgreSQL 数据目录，可优先使用 `/tmp/crm-manager-pg`。数据库初始化方式取决于本机 PostgreSQL 安装；完成后在 API workspace 执行迁移：

```bash
corepack pnpm --filter @project-delivery/api prisma:migrate
PORT=3001 DATABASE_URL="$DATABASE_URL" corepack pnpm dev:api
```

另开终端执行 M4/MVP E2E：

```bash
E2E_M4_ENABLED=1 \
E2E_DB_READY=1 \
DATABASE_URL="$DATABASE_URL" \
E2E_API_URL=http://127.0.0.1:3001/api/v1 \
corepack pnpm test:e2e tests/e2e/m4-mvp-main-flow.api.spec.ts
```

需要同时检查 Web 前置条件时：

```bash
corepack pnpm dev:web

E2E_M4_ENABLED=1 \
E2E_DB_READY=1 \
E2E_REQUIRE_WEB=1 \
E2E_WEB_URL=http://127.0.0.1:3000 \
E2E_API_URL=http://127.0.0.1:3001/api/v1 \
corepack pnpm test:e2e tests/e2e/m4-mvp-main-flow.api.spec.ts
```

### 环境变量

- `E2E_M4_ENABLED=1`：启用 M4/MVP 真实 E2E；未设置时跳过并成功。
- `E2E_DB_READY=1`：确认 API 指向已迁移、可丢弃的测试数据库。
- `DATABASE_URL`：API 和需要直接校验数据库的 E2E 使用的 PostgreSQL 连接串；推荐本地默认值为 `postgresql://postgres:postgres@localhost:5432/project_delivery_manager`。
- `E2E_API_URL`：API base URL，默认 `http://127.0.0.1:3001/api/v1`。
- `E2E_WEB_URL`：Web base URL，默认 `http://127.0.0.1:3000`。
- `E2E_REQUIRE_WEB=1`：要求 E2E 前置探测 Web 可访问；未设置时 M4 API E2E 不依赖 Web。
- `E2E_REQUEST_TIMEOUT_MS`：API/Web 探测超时时间，默认 `5000`。

### Skip 机制

M4/MVP E2E 会在以下情况明确跳过并返回成功：

- 未设置 `E2E_M4_ENABLED=1`。
- 未设置 `E2E_DB_READY=1`。
- API health 不可访问。
- 设置了 `E2E_REQUIRE_WEB=1` 但 Web 不可访问。

### 覆盖范围

- 我的工作台：按组织、空间、版本过滤，校验我的任务和待处理流程动作。
- 待处理流程动作：校验可执行动作、执行路径和角色/负责人触发的动作待办。
- 版本看板：校验列、过滤条件、版本内工作项和租户内数据边界。
- 异常视图：校验 blocked、pending_confirm、pending_regression；覆盖 WAITING 非阻塞不进入异常、VERIFYING 非待确认/非待回归不进入异常。
- 阈值配置：创建空间后更新 `staleThresholdDays`，并在空间总览响应中断言生效。
- 组织切换/租户隔离：校验 `recentOrganizationId` / `recentSpaceId` 的默认上下文，以及跨组织上下文访问被拒绝。
- 中文/英文和浅色/深色：通过用户偏好接口覆盖 `zh-CN` / `en-US` 与 `LIGHT` / `DARK`。

关键响应均使用 `packages/shared/src` 中的 shared schema 解析校验。
