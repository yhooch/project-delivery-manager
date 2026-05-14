# Notion 14 前端重构与重设计专题 · 状态更新（2026-05-13）

> 本文档用于回写到 Notion `14 前端重构与重设计专题`。
> Notion MCP token 过期未能自动推送；用户重新授权后可让 Claude 直接推，或手动复制粘贴本文 `## ` 之后的内容。
> 更新对象页面 ID: `360313c6-f128-811f-8a91-db1b57ff622e`
> URL: https://www.notion.so/360313c6f128811f8a91db1b57ff622e

---

## 当前状态（替换页首"页面状态"段）

- 状态：阶段一~五全部已落地，dev 服务器跑得起来；lint / typecheck / test / build 全套门禁通过；测试规模 28 文件 / 79 用例
- 编制日期：2026-05-13
- 编制方：主 agent（含 4 轮并行子 agent 派发）
- 阶段进度：① 北极星与 IA → ② 设计系统骨架 → ③ 垂直切片 4 页 → ④ 横向铺开 11 页 + 真实 API 接入 → ⑤ 详情抽屉 / 表单 / 清理

---

## 已确认决策（沿用前次，未变更）

- 北极星：Linear 骨 + Notion 肌双语境
- 主品牌色：Indigo `#6366F1`
- 状态色：阻塞 `#F59E0B` · 延期 `#EF4444` · 待回归/待确认 `#3B82F6` · 已完成 `#22C55E` · 已取消 `#94A3B8`
- 字体：Inter (UI) + JetBrains Mono (等宽) via `next/font/google`
- 主导航：按动词分组（工作 / 推进 / 沉淀 / 配置）
- 默认落地页：我的工作台
- 详情范式：右侧抽屉（需求文档与流程配置例外用全屏）
- 命令面板：Cmd+K + 全局快捷键 G+I/G+V/G+R/G+B
- 异常视图：单页面 5 Tab
- 版本看板：按系统状态归类列展示
- 不更换技术栈：保持 Next.js + React + TS + shadcn 风组件 + Tailwind v4 + next-intl + next-themes + cmdk

---

## 阶段一：北极星 + IA 拍板（已完成）

详见专题页"## 阶段一已确认决策"与"## IA 重构方案"段（不变）。

---

## 阶段二：设计系统骨架 + 垂直切片（已完成）

### 落地的基础设施
- `apps/web/postcss.config.mjs` — Tailwind v4 plugin
- `apps/web/src/app/globals.css` — Tailwind v4 + 浅深色双主题 token + Indigo 品牌色 + 状态色
- `apps/web/src/app/[locale]/layout.tsx` — Inter + JetBrains Mono via `next/font/google`
- `apps/web/src/lib/utils.ts` — `cn()` 工具

### 新装的依赖
- 设计系统：`tailwindcss@^4` · `@tailwindcss/postcss@^4` · `tailwindcss-animate@^1` · `class-variance-authority@^0.7` · `clsx@^2` · `tailwind-merge@^3`
- 主题：`next-themes@^0.4`
- 命令面板：`cmdk@^1.1`
- shadcn 组件依赖：`@radix-ui/react-{avatar,dialog,dropdown-menu,label,scroll-area,separator,tabs,tooltip,slot,checkbox,popover,select,toast}`

### shadcn 风基础组件（`apps/web/src/components/ui/`）
- 通用：`button` · `input` · `label` · `textarea` · `badge` · `avatar` · `separator` · `kbd`
- 容器：`sheet`（侧边抽屉）· `dialog`（模态）· `tabs` · `dropdown-menu` · `tooltip` · `scroll-area`
- 命令：`command`（基于 cmdk）
- 业务：`status-badge`（状态分类色徽章）

### 应用壳组件（`apps/web/src/components/shell/`）
- `app-shell.tsx` — 总壳（含未登录跳转、无组织 onboarding）
- `top-bar.tsx` — 顶部（组织切换 / Cmd+K 提示 / 语言 / 主题 / 用户菜单）
- `sidebar.tsx` — 左侧导航（按动词分组、按角色权限渲染）
- `organization-switcher.tsx` — 组织 + 空间切换下拉
- `create-organization-dialog.tsx` — 创建组织
- `onboarding-empty.tsx` — 无组织空态
- `language-toggle.tsx` · `theme-toggle.tsx` · `user-menu.tsx`
- `command-palette.tsx` — Cmd+K 命令面板（已含真实搜索）

### 垂直切片 4 页
- `(auth)/login` + `(auth)/register` — Linear 风极简登录注册
- `(app)/page.tsx` → `MyWorkbench` — Inbox 风工作台
- `(app)/versions/page.tsx` → `VersionBoard` — 6 列系统状态归类看板
- `components/work-item/task-detail-sheet.tsx` — 统一详情抽屉（被 4+ 页面共用）

---

## 阶段三：横向铺开 11 个 MVP 页面（已完成）

### 路由对照表

| 路由 | 页面组件 | 接入服务 |
|---|---|---|
| `/` | `MyWorkbench` | viewService.getMyWorkbenchView |
| `/work-items` | `TasksPage` | workItemService.listWorkItems |
| `/bugs` | `BugsPage` | bugService.listBugs |
| `/intake-items` | `IntakePage` | intakeService.list/accept/defer/reject |
| `/requirements` | `RequirementsPage` | requirementService.listRequirements |
| `/requirements/[id]` | 旧 `requirement-{list,detail}-workspace`（保留） | requirementService.* |
| `/versions` | `VersionBoard` | viewService.getVersionBoardView + listVersions |
| `/exceptions` | `ExceptionsPage` | viewService.getSpaceExceptionsView |
| `/overview` | `SpaceOverview` | viewService.getSpaceOverviewView |
| `/workflow` | `WorkflowPage` | workflowService.listWorkflows |
| `/settings` | `SpaceSettingsPage` | spaceService.getSpace/updateSpace/listSpaceMembers |
| `/organization` | `OrganizationPage` | spaceService.listOrganizationMembers |

### 共享组件
- `components/v2/page-header.tsx` — 页面顶部
- `components/v2/work-item-row.tsx` — 列表行
- `components/v2/states.tsx` — `LoadingState / ErrorState / EmptyState / Skeleton / ListSkeleton`

### 翻译
- `apps/web/messages/{zh-CN,en-US}.json` 新增命名空间：`shell / workbench / versionBoard / taskDetail / tasks / bugs / intake / requirements / workflow / spaceSettings / organization / spaceOverview / spaceExceptions`

---

## 阶段四：真实 API 接入（已完成）

所有 11 页面统一遵守的接入模式：
1. `useSession()` 拿当前 `defaultOrganizationId / defaultSpaceId`
2. `useEffect + useState` 拉数据（无新依赖）
3. 加载渲染 `<LoadingState>` / `<ListSkeleton>`
4. 失败渲染 `<ErrorState onRetry={refetch}>`，错误码用 `getApiErrorMessageKey + useTranslations()`
5. 空数据渲染 `<EmptyState>`
6. 缺组织 / 缺空间引导用户先选

---

## 阶段五：详情抽屉真实化 + 创建/管理表单 + 清理（已完成）

### 详情抽屉真实化（`task-detail-sheet.tsx`）
- 动作 Tab：`getWorkItem` 拿 `PermissionSnapshot.availableActions` + `executeAction` 执行
- 评论 Tab：`listComments` + `createComment`
- 附件 Tab：`listAttachments` 列出（上传按钮仍 TODO 占位）
- 时间线 Tab：`listTimeline`
- 关联 Tab：占位 EmptyState（缺接口）

### 新增 ID→显示名缓存（`apps/web/src/lib/v2/lookups.ts`）
- 模块级 Map 缓存空间成员 / 版本
- 双形式：`useSpaceMembers / useVersions` (hook) + `getMembers / getVersions / getMemberById / getVersionById` (pure)
- 含 in-flight 去重

### 创建表单（agent B 产出）
- `components/work-item/create-task-dialog.tsx`
- `components/bug/create-bug-dialog.tsx`
- `components/intake/create-intake-dialog.tsx`
- `components/intake/convert-intake-dialog.tsx`（一拆多 modal）
- 需求改为先建 DRAFT 再 `router.push("/requirements/" + id)`

### 管理表单（agent C 产出）
- `components/workflow/create-workflow-dialog.tsx`（新建+编辑+复制版本）
- `components/space/add-space-member-dialog.tsx`（含组织成员 typeahead）
- `components/space/edit-space-member-role-dialog.tsx`
- `components/organization/add-org-member-dialog.tsx`
- 空间设置基础信息可保存
- 组织成员"禁用即移除" + 最后 OWNER 保护

### 命令面板真实搜索（主线产出）
- 打开时预取 25 条/类（任务/Bug/需求/事项）
- cmdk 内置 fuzzy filter（用 `value={code+" "+title}`）
- 按类分组展示
- ≥2 字符进入搜索视图，<2 显示导航/空间切换/创建/偏好

### Dead code 清理
- 删除 sub-space 路由：`(app)/spaces/[spaceId]/{,bugs,exceptions,intake-items,requirements,versions,work-items,workflow}/page.tsx`
- 删除 6 个老 workspace + 测试：`bug-workspace / intake-workspace / version-workspace / work-item-workspace / workflow-workspace / space-exceptions-workspace`
- 删除 dashboard-workspace + 测试 + space-overview-workspace + m4-view-foundation + tests + view/index.ts
- 删除老 shell 子件：language-switch / theme-switch / logout-button / sidebar-nav / space-switcher
- 删除 mock-entities.ts（无人引用）；mock-data.ts 精简为只保留 `MockWorkItem` 视图模型类型

### 测试规模变化
- 阶段二开始时：36 文件 / 114 用例
- 当前：28 文件 / 79 用例（净减 8 文件 / 35 用例都是删 dead code workspace 的测试）

---

## 子 agent 派发教训（重要 · 下次防范）

阶段五并行派发 4 个 agent 后，发现以下 4 个关键文件被某个 agent 反向回退：
- `apps/web/package.json`（移除 `tailwindcss / @tailwindcss/postcss / tailwindcss-animate / next-themes`）
- `apps/web/src/app/globals.css`（回退到 3000 行的 hand-rolled CSS）
- `apps/web/src/app/[locale]/layout.tsx`（移除 `next/font` 字体加载）
- `apps/web/src/app/[locale]/(app)/page.tsx`（改回 `<DashboardWorkspace />`）

最可能原因：某 agent 用 `git stash` / `git checkout` 验证 baseline 时把工作树反向 reset 了。

**下次派发 agent 必须显式声明禁止：**
- `git stash` / `git checkout HEAD -- ...` / `git reset` / `git restore`
- 修改 `package.json` 或运行 `pnpm install` / `pnpm add`
- 删除 `node_modules`
- 修改 `globals.css` / `layout.tsx` / 路由 layout / 路由 page.tsx 除非该文件在其归属清单内

如发现需要安装新依赖或修改全局基础设施，必须停止并向主 agent 提交变更建议。

---

## 仍存在的遗留（按优先级）

### 🔴 阻塞功能完整度（接 backend / 补 service 方法即可）
| 项 | 阻塞原因 | 接的 service |
|---|---|---|
| 详情抽屉关联 Tab | 缺 `listLinks` API | 新增 link-service |
| 附件上传按钮 | agent A 占位 TODO | `attachment-service.presignUpload + register` |
| 流程"复制为新版本"选源版本 | `workflow-service` 缺 `listWorkflowVersions` | 后端补接口 |
| 组织成员真删除 | `session-service` 缺 `removeOrganizationMember` | 后端补接口（contracts 有 endpoint） |
| 组织信息编辑 | `session-service` 缺 `updateOrganization` 包装方法 | session-service 补 |
| 工作项 list 行的 assignee/version/code 显示 | view DTO 不返回这些字段，list 页面仍显示 ULID 末位（抽屉里已用 lookups 解决） | 后端在 view DTO 嵌套，或前端在 list 里也用 lookups |

### 🟡 体验完善
- 需求 Notion 风全屏编辑器外壳（当前进入 `/requirements/[id]` 仍是旧编辑器视觉）
- 替换自写 `theme-script.ts + theme-provider.tsx` 为已装的 `next-themes`
- 命令面板"最近打开"列表（localStorage 即可）
- 我的工作台缺 `pendingConfirmCount` 字段时降级展示

### 🟢 工程质量
- `MockWorkItem` 重命名为 `WorkItemViewModel`（涉及 7 处 import）
- 新组件 / 页面单测（当前 79 用例都是 lib + 工程基线）
- E2E 适配新 UI（旧 E2E 走旧选择器）
- `04.2 前端技术方案` 回写：补设计 token 表、组件覆写规范、命令面板规范、抽屉范式
- `06 测试与验收` 回写：补新页面的可用性、可访问性、键盘导航验收项
- 删除剩余 mock-data.ts（待抽屉接口全接通后即可）

---

## 用户验证清单

dev server 启动：
```bash
pkill -f "next dev"; pkill -f "next-server"
rm -rf /home/broadxt/.tmpe/crm_manager/apps/web/.next
cd /home/broadxt/.tmpe/crm_manager
corepack pnpm dev
```

视觉验证：
- [ ] `/zh-CN/login` 浅色 + 深色 都能切，Indigo 主色按钮
- [ ] 注册→自动登录后落到 onboarding 空态（无组织）或工作台（有组织）
- [ ] 顶部组织切换器下拉显示组织列表 + 空间列表 + 创建组织
- [ ] Cmd+K 打开命令面板，输入 ≥2 字符进入搜索视图（任务/Bug/需求/事项）
- [ ] 顶部语言切换、主题切换生效，刷新保持
- [ ] 左侧导航：工作 / 推进 / 沉淀 / 配置 4 组
- [ ] 我的工作台显示 4 个 KPI chip + 三组任务 + 最近动态侧栏
- [ ] 任务列表 / Bug 列表 状态分桶可切，点击行打开抽屉
- [ ] 抽屉：动作按钮按权限渲染、评论可发、附件可看（缺真上传）、时间线可看
- [ ] 事项池：纳入/暂缓/拒绝可执行；已纳入事项可"拆解任务"一拆多
- [ ] 需求列表：状态筛选；点击进入旧编辑器路由
- [ ] 流程页：4 张卡片，"新建流程"/"复制为新版本" dialog 可用
- [ ] 异常视图：5 Tab，每 Tab 显示对应类型工作项
- [ ] 空间总览：版本进度 + 4 KPI + 异常分布 + 最近时间线
- [ ] 空间设置：基础信息可保存、阈值可改、成员列表
- [ ] 组织页：成员列表，最后一个 OWNER 移除按钮禁用
- [ ] 版本看板：选版本下拉 + 6 列卡片
- [ ] 切深色后所有页面仍可读，主题色一致
- [ ] 切英文后所有 UI 文案翻译完整

功能验证（需后端运行 + 真实数据）：
- [ ] 创建任务/Bug/事项/需求 真实写入
- [ ] 流程动作执行后状态、时间线、看板列同步刷新
- [ ] Bug 修复→提交回归→关闭 全流程可走
- [ ] 异常视图阈值修改后 stale 列表刷新
- [ ] 多组织切换后看板/工作台数据不串

---

## 下一轮建议

按"价值/风险/成本"打分推荐顺序：

1. **接 backend 缺的 API**（最高价值）：让 attach-upload / removeOrganizationMember / updateOrganization / listWorkflowVersions / listLinks 可用
2. **list 行用 lookups 解决 ID→人/版本显示**（小工作量、高视觉收益）
3. **重命名 MockWorkItem → WorkItemViewModel**（一次性 refactor）
4. **替换自写 ThemeProvider 为 next-themes**（去技术债）
5. **需求 Notion 风全屏编辑器外壳**
6. **新组件/页面单测**
7. **E2E 适配新 UI**
8. **04.2 / 06 文档回写**

每一项都可以再次用并行 agent 推进，但**必须严格执行禁令清单**（见上文"教训"段）。
