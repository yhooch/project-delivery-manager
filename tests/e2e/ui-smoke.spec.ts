import { expect, test } from "./support/ui-test";

import { e2eEnv } from "./support/m0-env";
import { buildUiRunId, skipWhenUiEnvironmentUnavailable } from "./support/ui-env";

test.describe("UI smoke 主链路", () => {
  test.beforeAll(async () => {
    await skipWhenUiEnvironmentUnavailable();
  });

  test("注册 → 进入应用壳 → 主题/语言切换可用", async ({ page }) => {
    const runId = buildUiRunId();
    const username = `ui${runId}`;
    const password = `Aa${runId}!1`;

    // Step 1: Register a fresh user via the UI.
    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/register`);
    await page.fill("#register-username", username);
    await page.fill("#register-password", password);
    await page.fill("#register-confirm-password", password);
    await page.getByTestId("register-submit").click();

    // After register the app shell loads (no organization → onboarding empty state).
    // `localePrefix: "always"` keeps the /zh-CN prefix for the default locale.
    await expect(page).toHaveURL(`${e2eEnv.webBaseURL}/zh-CN`, {
      timeout: 10_000,
    });
    // Theme/language toggles are part of the shell top bar.
    await expect(page.getByTestId("theme-toggle")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("language-toggle")).toBeVisible();

    // Step 2: Switch theme to dark and verify the <html> class flips.
    await page.getByTestId("theme-toggle").click();
    await page.getByRole("menu").getByRole("menuitem").nth(2).click();
    await expect(page.locator("html")).toHaveClass(/dark/u, { timeout: 3_000 });

    // Step 3: Switch language to English; URL gains the /en-US prefix.
    await page.getByTestId("language-toggle").click();
    await page.getByRole("menu").getByRole("menuitem").nth(1).click();
    await expect(page).toHaveURL(/\/en-US(?:\/.*)?$/u, { timeout: 5_000 });

    // Step 4: Theme persists after the locale switch (dark class survives navigation).
    await expect(page.locator("html")).toHaveClass(/dark/u);
  });

  test("登录页表单可见", async ({ page }) => {
    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/login`);
    await expect(page.locator("#login-username")).toBeVisible();
    await expect(page.locator("#login-password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
  });
});
