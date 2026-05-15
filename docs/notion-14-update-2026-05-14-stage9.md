# Notion 14 前端重构与重设计专题 · 阶段九回写稿（2026-05-14）

> 本文档用于回写到 Notion `14 前端重构与重设计专题`（页面 ID `360313c6-f128-811f-8a91-db1b57ff622e`）。
> Notion MCP token 在准备 update 时过期；用户重新授权后让 Claude 应用下方两个 content_updates。

---

## update #1：替换「## 状态」段（在「# 阶段九」内）

### old_str

```
## 状态

- [x] 偏差认定（2026-05-14）
- [x] 补正范围拟定（2026-05-14）
- [x] 主 agent TaskList 已创建（Task #10~#14）
- [ ] 用户拍板启动实现
- [ ] 实现
- [ ] 验收 + 回写
```

### new_str

```
## 状态

- [x] 偏差认定（2026-05-14）
- [x] 补正范围拟定（2026-05-14）
- [x] 主 agent TaskList 已创建（Task #10~#14）
- [x] 用户拍板启动实现（2026-05-14）
- [x] 实现（2026-05-14）
- [x] 验收 + 回写（2026-05-14）

## 实现交付（2026-05-14）

commit `7079398 feat(workflow): add full-page workflow config UI`（13 files / +2964 / -5）

### 新建文件

- `apps/web/src/app/[locale]/(app)/workflow/[workflowId]/page.tsx` 动态路由 server page
- `apps/web/src/components/workflow/workflow-config-page.tsx` 主体
- `workflow-state-list.tsx` / `workflow-state-dialog.tsx`
- `workflow-action-list.tsx` / `workflow-action-dialog.tsx`
- `workflow-form-field-list.tsx` / `workflow-form-field-dialog.tsx`
- `workflow-config-page.test.tsx`（13 用例）

### 修改文件

- `workflow-page.tsx` 卡片「配置」改为 `Link` 跳转 `/workflow/[id]`；「编辑」作为独立按钮进现有 dialog
- `workflow-page.test.tsx` +2 用例覆盖跳转与 dialog
- `apps/web/messages/{zh-CN,en-US}.json` 新增 `workflow.config.*` 命名空间

### 意外结论

- `apps/web/src/lib/workflow-service.ts` 本轮**零改动** —— 主 agent 初评记忆中该服务只服 5 个函数（阶段六 commit 描述只提到阶段六新增的 2 个）；`git log` 确认 M2-M4 commit `27ba26b` 已交付全部 21 个 service 函数与 513 行单测。Task #11 实际未产生代码，但原需求在实现前已被满足

### 04.2「最小可维护版」逐条对照

| # | 验收项 | 状态 |
| --- | --- | --- |
| 1 | 顶栏：流程名 + 版本下拉（version desc）+ 发布/停用/复制 + 返回 | ✅ |
| 2 | 状态列表 + 行编辑/删除 + 底部新增 dialog | ✅ |
| 3 | 动作列表 + 行编辑/删除 + 展开表单字段 | ✅ |
| 4 | 字段子表 + 增改删 dialog | ✅ |
| 5 | 已发布版本只读：所有写按钮 disabled + 提示 | ✅ |
| 6 | 发布前校验（无状态/无 isStart/无 isEnd/from、to 引用不存在）+ 不调 service | ✅ |
| 卡片配置→Link | 卡片「配置」改为 `<Link asChild>` 跳转 `/workflow/[id]` | ✅ |
| 卡片编辑保留 | 「编辑」独立按钮仍走现有 dialog | ✅ |

### 门禁总结

- lint / typecheck（4 项目）/ vitest 全绿
- vitest：shared 14 / api 96 / web **194**（+15）= **304 用例**
- web 文件数：41 → 42

### 已知 polish（后续）

- 删除按钮未加 confirm dialog（MVP 可接受；后续体验优化补）
- 状态数 = 0 时「新增动作」按钮仍可点，提交后由后端 zod 拒掉并在 dialog 内友好报错（软 UX 缺陷，后续可加前端 predisable）

### 子 agent 遵守声明

本轮调用 1 个全栈 agent 串行完成 5 任务。Agent 明文声明未触及禁令清单（含 stage-8 后强化的 git stash/pop 禁令）。主 agent prompt 里补了「pre-existing 工作树 clean」事先告知，避免 agent 被诱导去诊断 pre-existing 错误。
```

---

## update #2：替换「# 下一轮建议」段顶部 P0 项

### old_str

```
# 下一轮建议

## P0（待用户拍板启动）

- **阶段九：流程配置补正** —— 偏差已认定、范围已拟定、Task #10~#14 已列出。纯前端补齐，不动 schema / API。

## v1.1 backlog
```

### new_str

```
# 下一轮建议

阶段九已收口（commit `7079398`，详见上文「# 阶段九」）。当前仅剩：

## v1.1 backlog
```
