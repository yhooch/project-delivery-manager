import { expect, test } from "./support/ui-test";

import { e2eEnv } from "./support/m0-env";
import {
  buildUiRunId,
  skipWhenUiEnvironmentUnavailable,
} from "./support/ui-env";
import {
  createTaskForUi,
  disposeUiUser,
  registerLoginCreateOrgAndSpace,
  shortRunId,
  type UiTestUser,
} from "./support/ui-setup";

/**
 * Opens the task list → clicks a pre-seeded row → switches to the comments
 * tab → submits a comment → asserts the new entry shows up in the list.
 * The TasksPage row click drives the detail sheet locally (no route nav).
 */
test.describe("UI 任务详情评论 Tab", () => {
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

  test("打开任务行 → 切换评论 Tab → 提交评论 → 列表出现新评论", async ({
    page,
  }) => {
    const runId = buildUiRunId();
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    const taskTitle = `Comment Task ${runId}`;
    const task = await createTaskForUi(user, taskTitle);

    // Tasks live under /work-items; the page redirects to a per-space URL
    // for spaces routing, but the TasksPage view-model is rendered through
    // the same component, so this gives us the row to click.
    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/work-items`);
    await expect(page.getByTestId("tasks-page")).toBeVisible({
      timeout: 15_000,
    });

    const row = page.getByTestId(`tasks-row-${task.id}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const sheet = page.getByTestId("task-detail-sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("task-comments-tab").click();
    const input = page.getByTestId("task-comments-input");
    await expect(input).toBeVisible();

    const body = `E2E comment ${runId}`;
    await input.fill(body);
    await page.getByTestId("task-comments-submit").click();

    // The newly created comment becomes the latest entry in the list. The
    // submit handler appends to the local state synchronously after the
    // request resolves, so the count grows by one.
    const list = page.getByTestId("task-comments-list");
    await expect(list).toBeVisible({ timeout: 10_000 });
    await expect(
      list.locator('[data-testid="task-comments-item"]', { hasText: body }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
