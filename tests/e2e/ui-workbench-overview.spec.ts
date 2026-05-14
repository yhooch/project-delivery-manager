import { expect, test, type Page, type Response } from "./support/ui-test";

import { e2eEnv } from "./support/m0-env";
import { skipWhenUiEnvironmentUnavailable } from "./support/ui-env";
import {
  disposeUiUser,
  registerLoginCreateOrgAndSpace,
  shortRunId,
  type UiTestUser,
} from "./support/ui-setup";

test.describe("UI 工作台与空间总览", () => {
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

  test("工作台与空间总览加载真实视图接口", async ({ page }) => {
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    const workbenchResponsePromise = waitForWorkbenchView(page, user);
    await page.goto(`${e2eEnv.webBaseURL}/zh-CN`);
    const workbenchResponse = await workbenchResponsePromise;

    expect(workbenchResponse.ok()).toBeTruthy();
    await expect(page.getByTestId("workbench-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("workbench-summary")).toBeVisible({
      timeout: 10_000,
    });

    const overviewResponsePromise = waitForSpaceOverviewView(page, user);
    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/overview`);
    const overviewResponse = await overviewResponsePromise;

    expect(overviewResponse.ok()).toBeTruthy();
    await expect(page.getByTestId("space-overview-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("space-overview-kpi-grid")).toBeVisible({
      timeout: 10_000,
    });
  });
});

function waitForWorkbenchView(
  page: Page,
  user: UiTestUser,
): Promise<Response> {
  return page.waitForResponse((response) => {
    if (response.request().method() !== "GET") {
      return false;
    }

    const url = new URL(response.url());

    return (
      url.pathname === "/api/v1/views/my-workbench" &&
      url.searchParams.get("organizationId") === user.organizationId &&
      url.searchParams.get("spaceId") === user.spaceId
    );
  });
}

function waitForSpaceOverviewView(
  page: Page,
  user: UiTestUser,
): Promise<Response> {
  return page.waitForResponse((response) => {
    if (response.request().method() !== "GET") {
      return false;
    }

    const url = new URL(response.url());

    return (
      url.pathname === `/api/v1/views/spaces/${user.spaceId}/overview` &&
      url.searchParams.get("organizationId") === user.organizationId
    );
  });
}
