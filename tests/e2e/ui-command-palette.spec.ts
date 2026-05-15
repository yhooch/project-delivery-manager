import { expect, test } from "./support/ui-test";

import {
  buildUiRunId,
  skipWhenUiEnvironmentUnavailable,
} from "./support/ui-env";
import {
  createTaskForUi,
  disposeUiUser,
  openCommandPalette,
  registerLoginCreateOrgAndSpace,
  shortRunId,
  type UiTestUser,
} from "./support/ui-setup";

/**
 * Validates Cmd+K → query → grouped results → navigation. The current
 * `/work-items` landing redirects to a per-space route, so after selecting
 * the task entry we only assert the URL change rather than waiting for the
 * detail sheet to render (that flow is exercised in the comment spec where
 * we can directly click the task list row).
 */
test.describe("UI 命令面板（Cmd+K）", () => {
  let user: UiTestUser | null = null;

  test.beforeAll(async () => {
    await skipWhenUiEnvironmentUnavailable();
  });

  test.afterEach(async () => {
    if (user) {
      await disposeUiUser(user);
      user = null;
    }
  });

  test("Cmd+K 打开命令面板 → 输入查询 → 分组结果 → 选中任务跳转", async ({
    page,
  }) => {
    const runId = buildUiRunId();
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    const taskTitle = `Palette Task ${runId}`;
    await createTaskForUi(user, taskTitle);

    // Reload so the new task is visible to client-side caches/queries.
    await page.reload();

    await openCommandPalette(page);
    await expect(page.getByTestId("command-palette-input")).toBeVisible();

    // cmdk filters in-memory after we type ≥2 characters.
    await page.getByTestId("command-palette-input").fill("Palette");

    const tasksGroup = page.getByTestId("command-palette-group-tasks");
    await expect(tasksGroup).toBeVisible({ timeout: 10_000 });

    // The created task surfaces as a group entry with its synthetic code.
    const taskItem = tasksGroup.getByTestId("command-palette-item-task").first();
    await expect(taskItem).toBeVisible();
    await taskItem.click();

    // After selecting a task, the palette closes and we navigate to the
    // work-items area. The trailing path may further redirect to a
    // per-space variant, so we only assert that /work-items is included.
    await expect(page).toHaveURL(/\/work-items/u, { timeout: 10_000 });
  });
});
