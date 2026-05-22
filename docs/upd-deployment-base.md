# UPD 部署底座说明

## 目标

生产 Compose 同时支持两种 API/Web 交付方式：

- 本地 build 部署：适合当前服务器直接从源码构建镜像。
- release 镜像部署：适合在线升级器把 API/Web 切到不可变 digest 镜像。

这两种方式共用 `docker-compose.prod.yml`。区别只在 `.env.prod` 中的镜像变量和 pull policy。

## 本地 build 部署

本地 build 部署使用默认镜像名，并让 Compose 根据 `build` 段构建 API/Web：

```env
PDM_RELEASE_ID=local-build
PDM_APP_VERSION=local-build
PDM_COMMIT=unknown
PDM_BUILD_TIME=unknown
PDM_RELEASE_CHANNEL=development
PDM_API_IMAGE=pdm-api:local
PDM_WEB_IMAGE=pdm-web:local
PDM_API_IMAGE_DIGEST=unknown
PDM_WEB_IMAGE_DIGEST=unknown
PDM_API_PULL_POLICY=build
PDM_WEB_PULL_POLICY=build
```

推荐命令：

```sh
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml build api web
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml up -d postgres minio minio-init
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml run --rm api corepack pnpm exec prisma migrate deploy --config prisma.config.ts
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml up -d
```

## release digest 部署

release 部署不在生产机上构建 API/Web，而是由在线升级器写入不可变镜像 digest：

```env
PDM_RELEASE_ID=2026.05.21-001
PDM_APP_VERSION=1.2.3
PDM_COMMIT=abc1234
PDM_BUILD_TIME=2026-05-22T00:00:00Z
PDM_RELEASE_CHANNEL=stable
PDM_API_IMAGE=registry.example.com/pdm/api@sha256:<api_digest>
PDM_WEB_IMAGE=registry.example.com/pdm/web@sha256:<web_digest>
PDM_API_IMAGE_DIGEST=sha256:<api_digest>
PDM_WEB_IMAGE_DIGEST=sha256:<web_digest>
PDM_API_PULL_POLICY=always
PDM_WEB_PULL_POLICY=always
```

推荐命令：

```sh
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml pull api web
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml up -d postgres minio minio-init
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml run --rm api corepack pnpm exec prisma migrate deploy --config prisma.config.ts
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml up -d
```

`PDM_APP_VERSION`、`PDM_COMMIT`、`PDM_BUILD_TIME`、`PDM_RELEASE_CHANNEL`、`PDM_API_IMAGE_DIGEST` 和 `PDM_WEB_IMAGE_DIGEST` 会映射为容器内的 `API_*` / `WEB_*` 版本证明字段。`PDM_API_IMAGE` 和 `PDM_WEB_IMAGE` 负责 Compose 实际运行的镜像引用；两者必须由升级器从同一份 manifest 写入，避免版本证明与运行镜像不一致。

## nginx 配置目录

生产 nginx 现在挂载目录，而不是单个配置文件：

```text
./deploy/nginx/active -> /etc/nginx/conf.d:ro
```

目录约定：

- `deploy/nginx/active`：当前生效配置，Compose 只挂载这个目录。
- `deploy/nginx/staging`：升级器写入候选配置并做 `nginx -t` 校验。
- `deploy/nginx/releases/<release-id>`：保存每次发布对应的 nginx 配置快照，便于回滚和审计。

当前默认配置位于 `deploy/nginx/active/default.conf`，其中 `/api/v1/realtime/events` 仍保留 `proxy_buffering off`，避免 SSE 被 nginx 缓冲。

历史单文件 `deploy/nginx.conf` 已删除，避免与 `deploy/nginx/active/default.conf` 出现双份配置。后续配置变更应进入 `deploy/nginx/active` 或由升级器生成到 staging/release 目录。

后续做原子切换时，升级器应先生成 staging 配置并校验，再复制或替换到 active，最后重载或重建 nginx 容器。

## release manifest 与包校验

UPD release 包的事实源是 `manifest.json`，当前 `manifestSchemaVersion` 固定为 `1`。manifest 必须包含：

- `version`、`commit`、`channel`、`publishedAt`。
- `minUpgradeableVersion`、`minUpdaterVersion`、`requiresMaintenance`、`riskLevel`。
- `images.api` 和 `images.web`，每个镜像都必须同时提供镜像引用和 `sha256:<hex>` digest。
- `dbSchemaMigrations`、`systemDataMigrations`，每个迁移引用记录 `id`、`path`、`kind`、`sha256`。
- `nginx` 配置块，包含 `configVersion`、`templatePath`、`sha256`、`requiredVariables`、`rollbackSupported`。
- `checksums`，覆盖 release notes、迁移文件、nginx 模板、hooks 等 manifest 外资产。

签名采用 Node 内置 Ed25519 detached signature。签名覆盖 `manifest.json` 文件字节；`manifest.checksums` 覆盖包内资产。生成包时可使用：

```sh
corepack pnpm upd:checksums -- --dir <release-dir>
corepack pnpm upd:pack -- --dir <release-dir> --input <manifest-input.json> --privateKey <ed25519-private.pem>
```

`manifest-input.json` 与最终 manifest 基本一致，但不需要填写 `checksums`、`nginx.sha256` 和迁移 `sha256`，脚本会从目录内容计算。校验包时可使用：

```sh
corepack pnpm upd:validate -- --dir <release-dir> --publicKey <ed25519-public.pem>
```

校验会拒绝以下情况：

- manifest JSON 不符合共享 Zod schema。
- checksummed 资产缺失或 sha256 不匹配。
- Ed25519 detached signature 缺失或无效（提供 public key 时强制校验）。
- 包中出现 `.env.prod`、私钥文件、token/password/secret/access key 赋值等疑似密钥泄露模式。
- API/Web digest 缺失，或镜像引用内的 digest 与 digest 字段不一致。
- nginx 模板 checksum 与 `nginx.sha256` 不一致。

共享错误码位于 `packages/shared/src/update.ts`，包括 `UPDATE_ACCESS_DENIED`、`PLATFORM_OPERATOR_REQUIRED`、`UPDATE_MANIFEST_INVALID`、`UPDATE_CHECKSUM_MISMATCH`、`UPDATE_SIGNATURE_INVALID`、`UPDATE_UPDATER_TOO_OLD`、`UPDATE_VERSION_INCOMPATIBLE`、`UPDATE_DIGEST_MISMATCH` 等。

## updater 状态目录

`pdm-updater` 不应让 API 层直接持有高权限。API 只读取持久化状态和 job 详情；真实 docker/nginx/pg/minio 执行由后续受控 updater 进程承接。

当前 foundation 提供本地 JSON 状态目录：

- 默认目录：`/tmp/pdm-updater/state`
- 覆盖环境变量：`PDM_UPDATER_STATE_DIR` 或 `UPDATER_STATE_DIR`
- `status.json`：当前 phase、active job、channel、版本信息。
- `jobs/<jobId>.json`：job manifest、步骤日志、command plan、备份/回滚元数据。
- `rollback.json`：回滚状态骨架。

CLI 示例：

```sh
corepack pnpm upd:state -- status
corepack pnpm upd:state -- dry-run --manifest <release-dir>/manifest.json
corepack pnpm upd:state -- job --id <job-id>
```

dry-run job 只生成 command plan/stub，例如 validate、backup、pull images、migrate、stage nginx，不执行真实命令。状态文件写入采用临时文件加 rename，API 重启后可以重新读取 `status.json` 和对应 job 文件。

## schema 与系统数据迁移

升级器执行数据库结构迁移时必须调用 Prisma 官方部署入口：

```sh
docker compose -p pdm-prod --env-file .env.prod -f docker-compose.prod.yml run --rm api corepack pnpm exec prisma migrate deploy --config prisma.config.ts
```

`prisma migrate deploy` 只负责 schema migration。系统数据迁移由 `scripts/upd/system-data.ts` 的 runner/plan 接管，并写入业务库中的 `system_data_migrations` 表。记录包含 `migration_id`、`checksum`、`status`、`applied_at`、`error_message`、`created_at`、`updated_at`；`migration_id` 唯一约束阻止同一迁移 id 被不同 checksum 重复记录，runner 发现 checksum drift 时必须阻断升级。

系统数据 migration 必须是幂等的：相同 id 和 checksum 已成功执行时跳过；相同 id 和 checksum 失败后可重试；相同 id 但 checksum 变化视为发布包不可信，不应继续执行。

破坏性 DB migration 不能被标记为自动可回滚。UPD 的回滚资产只能覆盖备份、镜像引用、nginx active 配置和 compose/env override；schema 级回退必须按人工 runbook 和备份恢复处理。

## GitHub Release provider 基础

GitHub provider 从环境读取：

- `UPD_GITHUB_OWNER` / `UPD_GITHUB_REPO`，或 `UPD_GITHUB_REPOSITORY=owner/repo`
- `UPD_RELEASE_CHANNEL`，默认 `stable`
- `UPD_GITHUB_TOKEN`，可选
- `UPD_GITHUB_API_BASE_URL`，默认 `https://api.github.com`

provider 当前只获取 latest 或 tag release 的 metadata 和 assets metadata，构造标准 GitHub API headers，并在日志/配置展示时脱敏 token。HTTP 401/403 映射为 `UPDATE_ACCESS_DENIED`，404 映射为 `UPDATE_MANIFEST_INVALID`，其他失败映射为 `UPDATE_PROVIDER_UNAVAILABLE`。
