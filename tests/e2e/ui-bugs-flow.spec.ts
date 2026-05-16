import { expect, test, type Request } from "./support/ui-test";

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

test.describe("UI Bug 页面主链路", () => {
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

  test("创建 Bug → 列表刷新 → 打开详情抽屉 → 切换详情 Tab", async ({
    page,
  }) => {
    const runId = buildUiRunId();
    user = await registerLoginCreateOrgAndSpace({
      page,
      runId: shortRunId(),
    });

    const title = `UI Bug ${runId}`;

    await page.goto(`${e2eEnv.webBaseURL}/zh-CN/bugs`);
    await expect(page.getByTestId("bugs-page")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("bugs-create-button").click();
    const dialog = page.getByTestId("create-bug-dialog");
    await expect(dialog).toBeVisible();

    await page.getByTestId("create-bug-title-input").fill(title);
    await page
      .getByTestId("create-bug-steps-input")
      .fill("1. 打开 UI E2E 页面\n2. 创建缺陷\n3. 校验列表和详情");
    await page
      .getByTestId("create-bug-severity-select")
      .selectOption("CRITICAL");
    await page.getByTestId("create-bug-priority-select").selectOption("URGENT");

    const createBugResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/v1/spaces/") &&
        response.url().endsWith("/bugs"),
    );
    await page.getByTestId("create-bug-submit").click();
    const createBugResponse = await createBugResponsePromise;
    expect(createBugResponse.ok()).toBeTruthy();
    const createBugPayload = (await createBugResponse.json()) as {
      data?: { id?: string };
    };
    const bugId = createBugPayload.data?.id;
    if (!bugId) {
      throw new Error("Bug 创建响应必须返回 data.id");
    }

    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const list = page.getByTestId("bugs-list");
    await expect(list).toBeVisible({ timeout: 10_000 });
    const row = list.locator("button", { hasText: title });
    await expect(row).toBeVisible({ timeout: 10_000 });

    const forbiddenWorkItemDetailRequests: string[] = [];
    const onRequest = (request: Request) => {
      const requestUrl = request.url();
      if (
        request.method() === "GET" &&
        requestUrl.match(new RegExp(`/api/v1/work-items/${bugId}(?:[?#]|$)`))
      ) {
        forbiddenWorkItemDetailRequests.push(requestUrl);
      }
    };
    page.on("request", onRequest);

    const bugDetailResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().match(new RegExp(`/api/v1/bugs/${bugId}(?:[?#]|$)`)) !==
          null,
    );

    await row.click();

    const sheet = page.getByTestId("task-detail-sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText(title, { exact: false })).toBeVisible();
    const bugDetailResponse = await bugDetailResponsePromise;
    expect(bugDetailResponse.ok()).toBeTruthy();

    await page.getByTestId("task-attachments-tab").click();
    await expect(page.getByTestId("task-attachments-panel")).toBeVisible();
    await page.getByTestId("task-timeline-tab").click();
    await expect(page.getByTestId("task-timeline-panel")).toBeVisible();
    await page.getByTestId("task-detail-tab").click();
    await expect(
      page.getByTestId("task-links-section"),
    ).toBeVisible();

    page.off("request", onRequest);
    expect(
      forbiddenWorkItemDetailRequests,
      "Bug 详情不得使用任务详情接口 GET /work-items/:bugId",
    ).toEqual([]);
  });
});
