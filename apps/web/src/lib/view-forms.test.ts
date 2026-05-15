import { describe, expect, it } from "vitest";

import {
  M4_EXCEPTION_TYPE_OPTIONS,
  M4_STATUS_CATEGORY_OPTIONS,
  M4_WORK_ITEM_TYPE_OPTIONS,
  getM4ViewFilterControls,
  toSpaceExceptionsViewQuery,
  toSpaceOverviewViewQuery,
  toVersionBoardViewQuery,
  toWorkbenchViewQuery,
} from "./view-forms";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5F13";

describe("M4 view filter forms", () => {
  it("exposes enum-backed filter options from shared schemas", () => {
    expect(M4_STATUS_CATEGORY_OPTIONS.map((option) => option.value)).toEqual([
      "NOT_STARTED",
      "IN_PROGRESS",
      "WAITING",
      "VERIFYING",
      "DONE",
      "TERMINATED",
    ]);
    expect(M4_WORK_ITEM_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      "TASK",
      "BUG",
    ]);
    expect(M4_EXCEPTION_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      "overdue",
      "blocked",
      "pending_confirm",
      "pending_regression",
      "stale",
    ]);
  });

  it("returns the controls that apply to each M4 view", () => {
    expect(
      getM4ViewFilterControls("version-board").map((control) => control.id),
    ).toEqual(["assigneeId", "statusCategory", "workItemType"]);
    expect(
      getM4ViewFilterControls("space-exceptions").map((control) => control.id),
    ).toEqual([
      "versionId",
      "assigneeId",
      "statusCategory",
      "workItemType",
      "exceptionType",
    ]);
  });

  it("normalizes empty and ALL values before parsing shared query schemas", () => {
    expect(
      toWorkbenchViewQuery({
        assigneeId,
        exceptionType: "ALL",
        organizationId,
        page: "2",
        pageSize: "50",
        spaceId,
        statusCategory: "WAITING",
        versionId: " ",
        workItemType: "TASK",
      }),
    ).toEqual({
      assigneeId,
      organizationId,
      page: 2,
      pageSize: 50,
      spaceId,
      statusCategory: "WAITING",
      workItemType: "TASK",
    });
  });

  it("builds view-specific query payloads without path parameters", () => {
    expect(
      toSpaceOverviewViewQuery({
        organizationId,
        versionId,
      }),
    ).toEqual({ organizationId, versionId });
    expect(
      toVersionBoardViewQuery({
        assigneeId,
        organizationId,
        page: 1,
        pageSize: 20,
        spaceId,
        statusCategory: "IN_PROGRESS",
        workItemType: "BUG",
      }),
    ).toEqual({
      assigneeId,
      organizationId,
      page: 1,
      pageSize: 20,
      spaceId,
      statusCategory: "IN_PROGRESS",
      workItemType: "BUG",
    });
    expect(
      toSpaceExceptionsViewQuery({
        exceptionType: "blocked",
        assigneeId,
        organizationId,
        statusCategory: "WAITING",
        versionId,
        workItemType: "BUG",
      }),
    ).toEqual({
      assigneeId,
      exceptionType: "blocked",
      organizationId,
      page: 1,
      pageSize: 20,
      statusCategory: "WAITING",
      versionId,
      workItemType: "BUG",
    });
  });
});
