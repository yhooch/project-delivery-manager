# AGENTS.md

- 使用中文交流，除非用户明确要求其他语言。
- 当前项目以 Notion 中的原始需求和实施计划为准；需求不明确时先回查 Notion，再给出判断或升级给主 agent。
- 主 agent 是总体入口，只负责任务拆分、派发、过程协调、集成和验收；除非出现必须由主 agent 处理的阻塞或收口问题，否则不直接参与代码编写。
- 主 agent 不得无必要中断子 agent；派发任务后必须给予子 agent 足够时间完成实现、验证和总结，不得因催进度、提前验收、主观担心或顺手接管而打断子 agent。仅当用户明确要求、子 agent 报告或主 agent 明确确认阻塞、修改范围越界、实现方向明显偏离 Notion 事实源或任务边界、并行任务冲突需要收口、继续执行会破坏契约/迁移/他人改动，或集成验收必须立即介入时，主 agent 才能中断子 agent。
- 子 agent 负责边界清晰的并行开发任务，交付时说明实现内容、验证结果、风险和需要主 agent 判断的问题。
- 并行派发子 agent 时必须明确禁止 `git stash`、`git stash pop`、`git checkout HEAD -- ...`、`git reset`、`git restore`，即便只是诊断已有工作树错误也禁止。
- 子 agent 不得修改 `package.json` 或运行 `pnpm install` / `pnpm add`、不得删除 `node_modules`、不得修改 `globals.css` / `layout.tsx` / 路由 layout/page，除非这些文件在其明确归属范围内；需要依赖或全局基础设施变更时先停下交给主 agent。
- 修改代码前先阅读相关上下文，保持改动小而聚焦，不回滚他人未明确授权的改动。
- 提交前至少运行与改动相关的 `corepack pnpm lint`、`corepack pnpm typecheck`、`corepack pnpm test` 或更小范围验证。
- GitHub 认证只使用本仓库本地配置，不写入全局 Git 配置。
