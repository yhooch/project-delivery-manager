import { expect, test } from "./support/ui-test";

import { e2eEnv } from "./support/m0-env";
import {
  buildUiRunId,
  skipWhenUiEnvironmentUnavailable,
} from "./support/ui-env";

/**
 * Covers the "首次登录 → 创建第一个组织" smoke path. Once an organization
 * exists, the switcher transitions from the static "暂无组织" stub to a
 * static label that shows the freshly created name. With a single org the
 * shell intentionally renders the static variant rather than a select, so
 * we assert the visible name instead of a dropdown option.
 */
test.describe("UI 组织切换器 / 创建组织", () => {
  test.beforeAll(async () => {
    await skipWhenUiEnvironmentUnavailable();
  });

  test("注册 → 通过 onboarding 创建组织 → 切换器展示新名称", async ({ page }) => {
    const runId = buildUiRunId();
    const username = `org${runId}`.slice(0, 28);
    const password = `Aa${runId}!1`;
    const orgName = `Org ${runId}`;

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/register`);
    await page.fill("#register-username", username);
    await page.fill("#register-password", password);
    await page.fill("#register-confirm-password", password);
    await page.getByTestId("register-submit").click();

    // No org yet → the onboarding empty state renders with a "create org"
    // CTA at the center.
    await expect(page.getByTestId("onboarding-empty")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId("onboarding-create-org-button"),
    ).toBeVisible();

    // Open the create-org dialog and submit a fresh organization.
    await page.getByTestId("onboarding-create-org-button").click();
    await expect(page.getByTestId("create-org-dialog")).toBeVisible();
    await page.getByTestId("create-org-name-input").fill(orgName);
    await page
      .getByTestId("create-org-code-input")
      .fill(`o${runId}`.slice(0, 32));
    await page.getByTestId("create-org-submit").click();

    // Dialog closes, session refreshes — the switcher should now show the
    // new org name. With a single org the shell renders the static variant
    // (no <select>), so we read the visible name directly.
    await expect(page.getByTestId("create-org-dialog")).toBeHidden({
      timeout: 10_000,
    });
    await expect(page.getByTestId("org-switcher-current-name")).toHaveText(
      orgName,
      { timeout: 10_000 },
    );
  });
});
