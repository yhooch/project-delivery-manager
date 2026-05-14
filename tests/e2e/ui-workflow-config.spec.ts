import { expect, test } from "@playwright/test";

import { e2eEnv } from "./support/m0-env";
import { skipWhenUiEnvironmentUnavailable } from "./support/ui-env";
import {
  disposeUiUser,
  listWorkflowDefinitionsForUi,
  registerLoginCreateOrgAndSpace,
  shortRunId,
  type UiTestUser,
} from "./support/ui-setup";

test.describe("UI 流程配置页", () => {
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

  test("流程列表 → 配置页 → 状态/动作/绑定区块与发布校验可见", async ({
    page,
  }) => {
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });
    const workflows = await listWorkflowDefinitionsForUi(user);
    test.skip(workflows.length === 0, "当前空间没有初始化任何流程定义。");
    const workflow = workflows[0]!;

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/workflow`);
    await expect(page.getByTestId("workflow-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`workflow-card-${workflow.id}`)).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId(`workflow-card-configure-${workflow.id}`).click();

    await expect(page).toHaveURL(new RegExp(`/workflow/${workflow.id}$`, "u"), {
      timeout: 10_000,
    });
    await expect(page.getByTestId("workflow-config-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("workflow-config-version-select"),
    ).toBeVisible();
    await expect(
      page.getByTestId("workflow-config-version-status"),
    ).toBeVisible();
    await expect(page.getByTestId("workflow-state-table")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("workflow-action-list")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("workflow-binding-table")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("workflow-config-copy-draft")).toBeVisible();
    await expect(page.getByTestId("workflow-config-publish")).toBeVisible();
    await expect(page.getByTestId("workflow-config-disable")).toBeVisible();
  });
});
