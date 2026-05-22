# HTTP Compose 部署与 UPD 验收骨架

## 范围

本文描述单机 HTTP Compose 生产部署。事实源仍是 release manifest、`docker-compose.prod.yml`、`.env.prod`、release override、updater 状态目录和 `deploy/nginx/active`。

## release override

基础 Compose 文件保持稳定，升级器只写 release override 或等价环境文件：

- `PDM_RELEASE_ID`、`PDM_APP_VERSION`、`PDM_COMMIT`、`PDM_BUILD_TIME`、`PDM_RELEASE_CHANNEL`
- `PDM_API_IMAGE=registry.example.com/pdm/api@sha256:<digest>`
- `PDM_WEB_IMAGE=registry.example.com/pdm/web@sha256:<digest>`
- `PDM_API_IMAGE_DIGEST=sha256:<digest>`
- `PDM_WEB_IMAGE_DIGEST=sha256:<digest>`
- `PDM_API_PULL_POLICY=always`
- `PDM_WEB_PULL_POLICY=always`

API/Web 镜像必须使用不可变 digest。版本证明环境变量必须来自同一份 manifest，不能手工拼接。

## nginx active 目录

生产 nginx 只挂载：

```text
./deploy/nginx/active:/etc/nginx/conf.d:ro
```

升级器流程：

1. 校验 manifest 中 nginx 模板 checksum。
2. 渲染到 `deploy/nginx/staging/default.conf`。
3. 拒绝未替换的 `{{VAR}}` 或 `${VAR}`。
4. 校验 staging/active/release 路径在白名单内。
5. 使用同版本 `nginx:1.27-alpine` 对 staging 执行 `nginx -t`。
6. 将配置快照保存到 `deploy/nginx/releases/<release-id>`。
7. 原子替换 `deploy/nginx/active`，reload nginx。
8. 检查 HTTP 入口健康；失败时按 rollback plan 恢复上一份 active 配置并 reload。

`deploy/nginx.conf` 已删除，避免与 active 配置重复。

## updater 状态与备份路径

默认状态目录：

```text
/tmp/pdm-updater/state
```

默认备份目录：

```text
/tmp/pdm-updater/backups/<release-id>
```

备份计划至少覆盖：

- PostgreSQL dump。
- MinIO bucket 数据。
- `docker-compose.prod.yml`、release override、`.env.prod` 的脱敏快照。
- 当前 API/Web 镜像引用。
- `deploy/nginx/active` 当前配置。

日志只能记录脱敏元数据，不能输出 `TOKEN`、`PASSWORD`、`SECRET`、`ACCESS_KEY` 等明文。

## 凭据边界

升级 token 只允许保存在 updater 进程运行环境或专用密钥文件中。不得写入：

- 业务数据库。
- 前端构建产物或 `NEXT_PUBLIC_*`。
- Notion 文档。
- release manifest、release notes、release 包资产。

API 层只读取 updater 状态和 job 详情，不直接持有 docker/nginx/pg/minio 高权限。

## 迁移顺序

发布执行顺序：

1. 校验 release manifest、签名、checksums、镜像 digest。
2. 生成备份计划并落盘备份元数据。
3. 拉取 API/Web digest 镜像。
4. 执行 `prisma migrate deploy`。
5. 执行幂等 system data migrations，并写入 `system_data_migrations`。
6. 渲染并验证 nginx staging。
7. 切换服务并 reload nginx。
8. 执行入口健康检查和核心回归。

破坏性 DB migration 不视为自动可回滚。回滚只能自动恢复镜像、nginx active 配置和备份资产引用；数据库回退需要人工确认并从备份恢复。

## 验收骨架

成功分支：

- dry-run job 能生成 validate、backup、pull images、`prisma migrate deploy`、system-data、stage nginx、healthcheck command plan。
- `system_data_migrations` 对相同 id/checksum 重复执行为 skip。
- nginx 模板 checksum 正确、变量全部替换、staging 通过 `nginx -t` plan。
- backup plan 覆盖 pg/minio/compose/env/image refs/nginx active，日志元数据脱敏。

核心失败分支：

- manifest asset checksum mismatch 阻断升级。
- system data migration id 相同但 checksum 变化阻断升级。
- nginx 模板存在未替换变量阻断升级。
- nginx staging 路径越过白名单阻断升级。
- 入口健康检查失败时执行 nginx active rollback plan。
- 备份路径不在允许根目录时阻断升级。
