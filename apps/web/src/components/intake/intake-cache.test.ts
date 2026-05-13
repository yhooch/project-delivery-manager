import { describe, expect, it } from "vitest";

import {
  createIntakeItemDetailCacheKey,
  createIntakeItemListCacheKey,
  createIntakeItemResourceCacheKey,
  createIntakeRelatedWorkItemsCacheKey,
} from "./intake-cache";

describe("intake cache helpers", () => {
  it("keeps every key scoped by space", () => {
    const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5F16";

    expect(
      createIntakeItemListCacheKey({
        priority: "HIGH",
        requirementId: "01ARZ3NDEKTSV4RRFFQ69G5F13",
        spaceId,
        status: "ACCEPTED",
        versionId: "01ARZ3NDEKTSV4RRFFQ69G5F12",
      }),
    ).toContain(spaceId);
    expect(createIntakeItemDetailCacheKey(spaceId, intakeItemId)).toContain(
      spaceId,
    );
    expect(createIntakeItemResourceCacheKey(spaceId, intakeItemId)).toContain(
      spaceId,
    );
    expect(createIntakeRelatedWorkItemsCacheKey(spaceId, intakeItemId)).toContain(
      spaceId,
    );
  });
});
