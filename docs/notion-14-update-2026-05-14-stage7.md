# Notion 14 前端重构与重设计专题 · 阶段七更新（2026-05-14）

> 本文档用于回写到 Notion `14 前端重构与重设计专题`。
> Notion MCP token 在准备 update 时过期；用户重新授权后让 Claude 把下面 `# 阶段七…` 段落插入到 14 主页`# 用户验证清单` 之前。
> 更新对象页面 ID: `360313c6-f128-811f-8a91-db1b57ff622e`
> URL: https://www.notion.so/360313c6f128811f8a91db1b57ff622e

---

# 阶段七（2026-05-14）遗留项收口

本轮主 agent 拍板顺序，串行起始后并行派发 5 个子 agent。未违反 14 教训中任何禁令。

## 工程去库存

- **`WorkItemViewModel` 迁出** —— 新增 `apps/web/src/lib/v2/work-item-view-model.ts` 独立承载；批量重写 7 处 import；删除 `apps/web/src/lib/v2/mock-data.ts`
- **命令面板"最近打开"微调** —— 上限 10 → 6；分组优先级：空搜索时"最近打开"置顶，≥2 字符入搜索后让位给实体结果；`type:id` 复合去重；fetch 后过期清理；抽 `apps/web/src/components/shell/recent-opens.ts` 助手模块。顺手补齐 `shell.command.*` 缺失翻译（`create`/`themeLight`/`themeDark`/`themeSystem` 等）。

## 需求详情 Notion 风内部布局

- `requirement-detail-workspace.tsx` 重写为 Notion 文档范式：大字标题、属性条（状态徽章/ID/版本/负责人/优先级/附件计数）、透明软分隔、胡杨够 Tiptap 插槽。保留全部业务逻辑与图片上传链路。
- `requirement-content-editor-slot.tsx` 的 m1 风 className（`editor-slot` / `tiptap-toolbar` 等）全量转换为 Tailwind v4 + shadcn `Button`，使用语义 token，深色不退化。

## 路由修复（本轮发现的隐藏 bug）

- `/settings` 先前仍指向旧 `SpaceManagementWorkspace`（m1 风）——已改为指向新 `SpaceSettingsPage`。
- `/work-items` / `/bugs` / `/workflow` / `/intake-items` 四个路由仍使用旧 Landing 组件 redirect 到**已删除的** `/spaces/[id]/...` 路由——已改为直指新 IA 页面组件。
- 删除 7 个孤儿组件：`space-management-workspace.tsx` / `organization-members-panel.tsx` / `requirement-list-workspace.tsx` / `work-item-landing.tsx` / `bug-landing.tsx` / `workflow-landing.tsx` / `intake-landing.tsx`。

## 核心业务组件单测

- 新增 5 个 `.test.tsx`：`task-detail-sheet.test.tsx` (12) / `bugs-page.test.tsx` (8) / `tasks-page.test.tsx` (8) / `my-workbench.test.tsx` (8) / `command-palette.test.tsx` (7) = **+43 用例**。
- 新增基础设施：`apps/web/vitest.config.ts` test projects 拆分节点 / jsdom；`apps/web/vitest.setup.ts` 安装 @testing-library/jest-dom + RTL cleanup + matchMedia/ResizeObserver/IntersectionObserver stub；`apps/web/src/types/vitest-jest-dom.d.ts` 补类型。
- vitest 总规模：**33 文件 / 122 用例全绿**（从 28 / 79 增量）。

## LinksPanel EmptyState bug 修复（本轮发现）

- `task-detail-sheet.tsx` LinksPanel 之前 unconditionally push reporter 行，导致"所有 relation id 都缺失"时仍会渲染一行"—"而不是专题 14 约定的 `EmptyState`。修复：reporter push 改为 `if (detail.reporterId)`；修订 12 个用例中的 1 个以断言修复后行为。

## Playwright UI E2E 扩充

- 新增 5 场景：组织切换器 + 创建组织、Cmd+K 搜索 + 跳转、详情抽屉评论提交、任务创建 dialog 提交、需求 DRAFT 创建跳转。总规模 11 → **16 用例**。
- 新增 `tests/e2e/support/ui-setup.ts` 复用 setup。
- 项目组件全面补齐 `data-testid`，selector 不依赖文案。命名约定已同步到「06 测试与验收」。

## 门禁总结

- "Test Files 33 passed (33) / Tests 122 passed (122)"
- lint / typecheck / build 全绿
- 11 个 MVP 路由全部生成，重定向陷阱清零

## 文档回写

- `04.2 前端技术方案` 补设计 token / 命令面板规范 / 详情抽屉范式 / lookups 口径 / 后端补齐。
- `06 测试与验收` 补新 IA 视觉验收项 / 可访问性与键盘导航 / `data-testid` 命名约定 / 门禁与自动化测试规模。

---

## 仍存在的遗留（下一轮可选）

### 🟢 工程质量
- `Requirement` shared schema 缺 `createdAt/updatedAt/authorId` 字段，需求详情属性条暂未显示"最后修改时间/作者"。补需要同步 `packages/shared/src/requirement.ts` + 后端 + Prisma schema。
- 现有 vitest 79 用例多为 lib 工程基线，新加的 43 用例为组件层（共 33 文件 / 122 用例）；后续可继续按页面/组件覆盖率补。
- UI E2E 默认环境下走 skip 守卫；要在 `E2E_UI_ENABLED=1 + E2E_DB_READY=1` 真跑通需要起 PostgreSQL + API + Web 全栈。
