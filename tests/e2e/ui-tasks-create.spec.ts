import { expect, test } from "@playwright/test";

import { e2eEnv } from "./support/m0-env";
import {
  buildUiRunId,
  skipWhenUiEnvironmentUnavailable,
} from "./support/ui-env";
import {
  disposeUiUser,
  registerLoginCreateOrgAndSpace,
  shortRunId,
  type UiTestUser,
} from "./support/ui-setup";

/**
 * Drives the "create task" dialog from the tasks page header. After
 * submission the dialog closes and the new row shows up in the list via
 * the page's onCreated refetch.
 */
test.describe("UI 任务创建 dialog", () => {
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

  test("打开 dialog → 填写标题 → 提交 → 列表刷新出现新任务", async ({
    page,
  }) => {
    const runId = buildUiRunId();
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    const title = `New UI Task ${runId}`;

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/work-items`);
    await expect(page.getByTestId("tasks-page")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("tasks-create-button").click();
    const dialog = page.getByTestId("create-task-dialog");
    await expect(dialog).toBeVisible();

    await page.getByTestId("create-task-title-input").fill(title);
    await page.getByTestId("create-task-submit").click();

    // Dialog closes once the API responds with 201.
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // List refetch — the new task appears as a row in the list. We match by
    // the row's visible title text so we do not have to know the API-issued
    // id up-front.
    const list = page.getByTestId("tasks-list");
    await expect(list).toBeVisible({ timeout: 10_000 });
    await expect(list.getByText(title, { exact: false })).toBeVisible({
      timeout: 10_000,
    });
  });
});
