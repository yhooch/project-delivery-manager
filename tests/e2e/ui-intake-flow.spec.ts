import { expect, test } from "./support/ui-test";

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

test.describe("UI 需求池页面主链路", () => {
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

  test("创建需求池条目 → 打开详情 → 接受 → 出现转任务入口", async ({
    page,
  }) => {
    const runId = buildUiRunId();
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    const title = `UI Intake ${runId}`;

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/intake-items`);
    await expect(page.getByTestId("intake-page")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("intake-create-button").click();
    const dialog = page.getByTestId("create-intake-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("create-intake-title-input").fill(title);
    await page
      .getByTestId("create-intake-description-input")
      .fill("UI E2E 覆盖需求池创建、筛选、详情和状态动作。");
    await page
      .getByTestId("create-intake-source-select")
      .selectOption("AD_HOC");
    await page
      .getByTestId("create-intake-priority-select")
      .selectOption("HIGH");
    await page.getByTestId("create-intake-submit").click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const list = page.getByTestId("intake-list");
    await expect(list).toBeVisible({ timeout: 10_000 });
    const row = list.locator("button", { hasText: title });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const sheet = page.getByTestId("intake-detail-sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText(title, { exact: false })).toBeVisible();

    await page.getByTestId("intake-accept-button").click();
    await expect(page.getByTestId("intake-convert-button")).toBeVisible({
      timeout: 10_000,
    });

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden({ timeout: 10_000 });

    await page.getByTestId("intake-filter-ACCEPTED").click();
    await expect(page.getByTestId("intake-list").getByText(title)).toBeVisible({
      timeout: 10_000,
    });
  });
});
