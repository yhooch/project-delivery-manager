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

历史单文件 `deploy/nginx.conf` 已不再被生产 Compose 挂载，后续配置变更应进入 `deploy/nginx/active` 或由升级器生成到 staging/release 目录。

后续做原子切换时，升级器应先生成 staging 配置并校验，再复制或替换到 active，最后重载或重建 nginx 容器。
