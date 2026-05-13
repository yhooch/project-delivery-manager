# AGENTS.md

- 使用中文交流，除非用户明确要求其他语言。
- 当前项目以 Notion 中的原始需求和实施计划为准；需求不明确时先回查 Notion，再给出判断或升级给主 agent。
- 主 agent 负责任务派发、集成和验收；子 agent 负责边界清晰的并行开发任务。
- 修改代码前先阅读相关上下文，保持改动小而聚焦，不回滚他人未明确授权的改动。
- 提交前至少运行与改动相关的 `corepack pnpm lint`、`corepack pnpm typecheck`、`corepack pnpm test` 或更小范围验证。
- GitHub 认证只使用本仓库本地配置，不写入全局 Git 配置。
