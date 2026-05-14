import { expect, test } from "@playwright/test";

import { e2eEnv } from "./support/m0-env";
import { skipWhenUiEnvironmentUnavailable } from "./support/ui-env";
import {
  disposeUiUser,
  registerLoginCreateOrgAndSpace,
  shortRunId,
  type UiTestUser,
} from "./support/ui-setup";

test.describe("UI 空间设置与组织管理", () => {
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

  test("空间基础信息/阈值/成员列表与组织 Owner 保护可见", async ({ page }) => {
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/settings`);
    await expect(page.getByTestId("space-settings-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("space-settings-name-input")).toHaveValue(
      user.spaceName,
    );
    await expect(page.getByTestId("space-settings-code-input")).not.toHaveValue(
      "",
    );

    await page.getByTestId("space-settings-threshold-input").fill("4");
    await page.getByTestId("space-settings-threshold-submit").click();
    await expect(
      page.getByTestId("space-settings-threshold-input"),
    ).toHaveValue("4", { timeout: 10_000 });

    const spaceMemberList = page.getByTestId("space-settings-members-list");
    await expect(spaceMemberList).toBeVisible({ timeout: 10_000 });
    await expect(
      spaceMemberList.getByText(user.username, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("space-settings-add-member-button"),
    ).toBeVisible();

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/organization`);
    await expect(page.getByTestId("organization-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("organization-add-member-button"),
    ).toBeVisible();
    const ownerRow = page.locator('[data-testid^="organization-member-"]', {
      hasText: user.username,
    });
    await expect(ownerRow).toBeVisible({ timeout: 10_000 });
    await expect(
      ownerRow.locator('[data-testid^="organization-member-remove-"]'),
    ).toBeDisabled();
  });
});
