# HTTP Docker Compose 部署

本部署档面向 MVP 的 HTTP 单机 Docker Compose 上线：

- `nginx` 暴露 `http://<host>:80`
- `web` 在 Docker 内网运行 Next.js
- `api` 在 Docker 内网运行 NestJS
- `postgres` 使用命名卷持久化业务数据
- `minio` 使用命名卷持久化附件，并通过 `9000` 暴露 S3 API

## 1. 准备环境变量

```bash
cp .env.prod.example .env.prod
```

编辑 `.env.prod`，替换所有 `CHANGE_ME` 值。`WEB_APP_URL` 必须和用户浏览器实际打开的 origin 完全一致，例如：

```env
WEB_APP_URL=http://192.0.2.10
MINIO_PUBLIC_ENDPOINT=http://192.0.2.10:9000
SESSION_COOKIE_SECURE=false
```

HTTP 部署必须保留 `SESSION_COOKIE_SECURE=false`。如果设为 `true`，浏览器不会在 HTTP 下发送登录 Cookie。

## 2. 构建镜像

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build
```

## 3. 启动数据服务

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d postgres minio minio-init
```

## 4. 执行数据库迁移

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm api \
  corepack pnpm exec prisma migrate deploy --schema prisma/schema.prisma
```

## 5. 启动应用

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

## 6. 验证

```bash
curl http://<host>/api/v1/health
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

浏览器手工验证：

- 注册并登录，刷新后确认登录态保留。
- 创建组织、空间、版本、需求、事项、任务和 Bug。
- 执行流程动作。
- 上传和下载附件。
- 检查我的工作台、版本看板和异常视图。

## 运维命令

查看日志：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api web nginx
```

重启应用层：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml restart api web nginx
```

停止服务：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

不要执行 `down -v`，除非你明确要删除 PostgreSQL 和 MinIO 数据。
