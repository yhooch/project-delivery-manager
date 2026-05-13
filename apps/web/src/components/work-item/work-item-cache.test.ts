import { describe, expect, it } from "vitest";

import {
  createWorkItemDetailCacheKey,
  createWorkItemListCacheKey,
  createWorkItemResourceCacheKey,
} from "./work-item-cache";

describe("work item cache helpers", () => {
  it("scopes list keys by spaceId and filters", () => {
    expect(
      createWorkItemListCacheKey({
        assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        priority: "HIGH",
        requirementId: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
        spaceId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        statusCategory: "IN_PROGRESS",
        versionId: "01ARZ3NDEKTSV4RRFFQ69G5FD1",
      }),
    ).toBe(
      [
        "work-items",
        "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        "01ARZ3NDEKTSV4RRFFQ69G5FD1",
        "01ARZ3NDEKTSV4RRFFQ69G5FC1",
        "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        "IN_PROGRESS",
        "HIGH",
      ].join(":"),
    );
  });

  it("scopes detail and resource keys by spaceId", () => {
    expect(
      createWorkItemDetailCacheKey(
        "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        "01ARZ3NDEKTSV4RRFFQ69G5FE1",
      ),
    ).toBe(
      "work-item-detail:01ARZ3NDEKTSV4RRFFQ69G5FA1:01ARZ3NDEKTSV4RRFFQ69G5FE1",
    );

    expect(
      createWorkItemResourceCacheKey(
        "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        "01ARZ3NDEKTSV4RRFFQ69G5FE1",
      ),
    ).toBe(
      "work-item-resources:01ARZ3NDEKTSV4RRFFQ69G5FA1:01ARZ3NDEKTSV4RRFFQ69G5FE1",
    );
  });
});
