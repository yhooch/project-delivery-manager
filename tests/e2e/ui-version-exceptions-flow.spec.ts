import { expect, test } from "./support/ui-test";

import { e2eEnv } from "./support/m0-env";
import {
  buildUiRunId,
  skipWhenUiEnvironmentUnavailable,
} from "./support/ui-env";
import {
  createTaskForUi,
  createVersionForUi,
  disposeUiUser,
  registerLoginCreateOrgAndSpace,
  shortRunId,
  type UiTestUser,
} from "./support/ui-setup";

test.describe("UI 版本看板与异常页", () => {
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

  test("预置逾期任务 → 版本看板出现卡片 → 异常页 Overdue 出现同一任务", async ({
    page,
  }) => {
    const runId = buildUiRunId();
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    const version = await createVersionForUi(user, `UI Version ${runId}`);
    const overdueDate = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const task = await createTaskForUi(user, `UI Overdue Task ${runId}`, {
      dueDate: overdueDate,
      priority: "HIGH",
      versionId: version.id,
    });

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/versions`);
    await expect(page.getByTestId("version-board-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("version-board-version-trigger"),
    ).toContainText(version.name, { timeout: 10_000 });

    const boardCard = page.getByTestId(`version-board-card-${task.id}`);
    await expect(boardCard).toBeVisible({ timeout: 10_000 });
    await boardCard.click();
    await expect(page.getByTestId("task-detail-sheet")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId("task-detail-sheet").getByText(task.title),
    ).toBeVisible();

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/exceptions`);
    await expect(page.getByTestId("exceptions-page")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("exceptions-tab-overdue").click();

    const overdueRow = page.getByTestId(`exceptions-row-overdue-${task.id}`);
    await expect(overdueRow).toBeVisible({ timeout: 10_000 });
    await overdueRow.click();
    await expect(page.getByTestId("task-detail-sheet")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId("task-detail-sheet").getByText(task.title),
    ).toBeVisible();
  });
});
