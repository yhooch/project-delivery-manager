import { describe, expect, it } from "vitest";

import {
  createBugDetailCacheKey,
  createBugListCacheKey,
  createBugResourceCacheKey,
  createTaskDetailCacheKey,
  createTaskListCacheKey,
  createTaskResourceCacheKey,
  createWorkflowBindingsCacheKey,
  createWorkflowDetailCacheKey,
  createWorkflowListCacheKey,
  createWorkflowVersionCacheKey,
} from "./work-item-cache";

const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const workflowId = "01ARZ3NDEKTSV4RRFFQ69G5FC0";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FC1";

describe("M3 work item cache helpers", () => {
  it("scopes task keys by spaceId and filters", () => {
    expect(
      createTaskListCacheKey({
        assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        priority: "HIGH",
        requirementId: "01ARZ3NDEKTSV4RRFFQ69G5FC2",
        spaceId,
        statusCategory: "IN_PROGRESS",
        versionId: "01ARZ3NDEKTSV4RRFFQ69G5FC3",
      }),
    ).toContain(spaceId);
    expect(createTaskDetailCacheKey(spaceId, workItemId)).toContain(spaceId);
    expect(createTaskResourceCacheKey(spaceId, workItemId)).toContain(spaceId);
  });

  it("scopes bug keys by spaceId and M3 bug filters", () => {
    expect(
      createBugListCacheKey({
        priority: "URGENT",
        relatedTaskId: workItemId,
        severity: "CRITICAL",
        spaceId,
        statusCategory: "VERIFYING",
      }),
    ).toBe(
      [
        "bugs",
        spaceId,
        "all-versions",
        "all-requirements",
        workItemId,
        "all-assignees",
        "VERIFYING",
        "URGENT",
        "CRITICAL",
      ].join(":"),
    );
    expect(createBugDetailCacheKey(spaceId, workItemId)).toContain(spaceId);
    expect(createBugResourceCacheKey(spaceId, workItemId)).toContain(spaceId);
  });

  it("scopes workflow keys by spaceId", () => {
    expect(
      createWorkflowListCacheKey({
        spaceId,
        status: "ACTIVE",
      }),
    ).toBe(["workflows", spaceId, "ACTIVE"].join(":"));
    expect(createWorkflowDetailCacheKey(spaceId, workflowId)).toContain(spaceId);
    expect(createWorkflowVersionCacheKey(spaceId, workflowVersionId)).toContain(
      spaceId,
    );
    expect(
      createWorkflowBindingsCacheKey({
        isDefault: true,
        priority: "HIGH",
        spaceId,
        workItemType: "BUG",
      }),
    ).toBe(["workflow-bindings", spaceId, "BUG", "HIGH", "true"].join(":"));
  });
});
