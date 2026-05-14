import { expect, test } from "@playwright/test";

import { e2eEnv } from "./support/m0-env";
import { skipWhenUiEnvironmentUnavailable } from "./support/ui-env";
import {
  disposeUiUser,
  registerLoginCreateOrgAndSpace,
  shortRunId,
  type UiTestUser,
} from "./support/ui-setup";

/**
 * Clicking "新建需求" on the requirements list calls the createDraft
 * endpoint and `router.push`s to `/requirements/[id]`, where the Notion-
 * shell editor takes over.
 */
test.describe("UI 需求 DRAFT 创建跳转", () => {
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

  test("点击 新建需求 → 创建 DRAFT → 跳转到 /requirements/[id]", async ({
    page,
  }) => {
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/requirements`);
    await expect(page.getByTestId("requirements-page")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("requirements-create-button").click();

    // After creating a DRAFT the router navigates to /requirements/[id].
    await expect(page).toHaveURL(/\/requirements\/[a-zA-Z0-9-]+$/u, {
      timeout: 15_000,
    });

    // The Notion editor shell renders the requirement detail wrapper.
    await expect(page.getByTestId("requirement-detail-page")).toBeVisible({
      timeout: 10_000,
    });
  });
});
