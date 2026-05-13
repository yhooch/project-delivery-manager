import { describe, expect, it } from "vitest";

import {
  createMyWorkbenchViewCacheKey,
  createSpaceExceptionsViewCacheKey,
  createSpaceOverviewViewCacheKey,
  createVersionBoardViewCacheKey,
} from "./view-cache";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5F13";

describe("M4 view cache helpers", () => {
  it("scopes my workbench keys by organization, optional space, and filters", () => {
    expect(
      createMyWorkbenchViewCacheKey({
        assigneeId,
        exceptionType: "blocked",
        organizationId,
        page: 2,
        pageSize: 50,
        spaceId,
        statusCategory: "WAITING",
        versionId,
        workItemType: "BUG",
      }),
    ).toBe(
      [
        "m4-my-workbench",
        organizationId,
        spaceId,
        versionId,
        assigneeId,
        "WAITING",
        "BUG",
        "blocked",
        "page=2,pageSize=50,sortBy=default,sortOrder=default",
      ].join(":"),
    );

    expect(
      createMyWorkbenchViewCacheKey({
        organizationId,
      }),
    ).toContain("all-spaces");
  });

  it("scopes space overview and exceptions by space context", () => {
    expect(
      createSpaceOverviewViewCacheKey({
        organizationId,
        spaceId,
        versionId,
      }),
    ).toBe(["m4-space-overview", spaceId, organizationId, versionId].join(":"));

    expect(
      createSpaceExceptionsViewCacheKey({
        exceptionType: "ALL",
        organizationId,
        spaceId,
        statusCategory: "ALL",
        workItemType: "TASK",
      }),
    ).toBe(
      [
        "m4-space-exceptions",
        spaceId,
        organizationId,
        "all-versions",
        "all-assignees",
        "all-status-categories",
        "TASK",
        "all-exception-types",
        "page=1,pageSize=20,sortBy=default,sortOrder=default",
      ].join(":"),
    );
  });

  it("scopes version board keys by version and every active filter", () => {
    expect(
      createVersionBoardViewCacheKey({
        assigneeId,
        organizationId,
        page: 3,
        sortBy: "priority",
        sortOrder: "desc",
        spaceId,
        statusCategory: "IN_PROGRESS",
        versionId,
        workItemType: "TASK",
      }),
    ).toBe(
      [
        "m4-version-board",
        versionId,
        organizationId,
        spaceId,
        assigneeId,
        "IN_PROGRESS",
        "TASK",
        "page=3,pageSize=20,sortBy=priority,sortOrder=desc",
      ].join(":"),
    );
  });
});
