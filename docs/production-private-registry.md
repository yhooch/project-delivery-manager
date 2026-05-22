# Production Private Registry Deploy

生产环境优先使用国内私有镜像仓库发布，避免部署服务器直接访问 Docker Hub 或在服务器上执行应用镜像构建。`docker save` / `docker load` 只作为私有仓库不可用时的兜底方案。

## Image Contract

`docker-compose.prod.registry.yml` 通过 `.env.prod` 中的镜像变量覆盖生产镜像：

- `API_IMAGE`
- `WEB_IMAGE`
- `POSTGRES_IMAGE`
- `MINIO_IMAGE`
- `MINIO_MC_IMAGE`
- `NGINX_IMAGE`

推荐命名：

```env
PRIVATE_REGISTRY=registry.cn-hangzhou.aliyuncs.com/your-namespace/crm-manager
APP_IMAGE_TAG=<git-commit-or-release-tag>
API_IMAGE=${PRIVATE_REGISTRY}/api:${APP_IMAGE_TAG}
WEB_IMAGE=${PRIVATE_REGISTRY}/web:${APP_IMAGE_TAG}
POSTGRES_IMAGE=${PRIVATE_REGISTRY}/postgres:16-alpine
MINIO_IMAGE=${PRIVATE_REGISTRY}/minio:latest
MINIO_MC_IMAGE=${PRIVATE_REGISTRY}/minio-mc:latest
NGINX_IMAGE=${PRIVATE_REGISTRY}/nginx:1.27-alpine
```

`latest` 只保留给当前 MinIO 既有部署口径；后续同步到私有仓库时，应改为明确的 MinIO release tag。

## Prepare Registry Images

在网络可用的构建机或 CI 上登录私有仓库后执行：

```bash
docker pull postgres:16-alpine
docker tag postgres:16-alpine "${POSTGRES_IMAGE}"
docker push "${POSTGRES_IMAGE}"

docker pull minio/minio:latest
docker tag minio/minio:latest "${MINIO_IMAGE}"
docker push "${MINIO_IMAGE}"

docker pull minio/mc:latest
docker tag minio/mc:latest "${MINIO_MC_IMAGE}"
docker push "${MINIO_MC_IMAGE}"

docker pull nginx:1.27-alpine
docker tag nginx:1.27-alpine "${NGINX_IMAGE}"
docker push "${NGINX_IMAGE}"

docker compose --env-file .env.prod \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.registry.yml \
  build api web

docker compose --env-file .env.prod \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.registry.yml \
  push api web
```

## Deploy On Server

生产服务器只拉取私有仓库镜像并禁止本机 build：

```bash
docker login <private-registry-host>

docker compose -p pdm-prod --env-file .env.prod \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.registry.yml \
  pull

docker compose -p pdm-prod --env-file .env.prod \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.registry.yml \
  up -d postgres minio minio-init --no-build

docker compose -p pdm-prod --env-file .env.prod \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.registry.yml \
  run --rm --no-deps api corepack pnpm exec prisma migrate deploy --config prisma.config.ts

docker compose -p pdm-prod --env-file .env.prod \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.registry.yml \
  up -d --no-build
```

升级时必须继续带上 `docker-compose.prod.registry.yml`。如果漏带该 override，Compose 会回退到 `docker-compose.prod.yml` 中的公共镜像和本地构建路径。

## Fallback

仅当私有仓库不可用时，才回退到旧方案：

1. 在网络可用机器构建 API/Web 并拉取公共基础镜像。
2. `docker save` 导出镜像包。
3. 上传到生产服务器。
4. 生产服务器 `docker load`。
5. 使用环境专属 override 固定本地镜像 tag 后再启动。
