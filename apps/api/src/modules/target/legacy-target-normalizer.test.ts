import { describe, expect, it } from "vitest";

import {
  legacyRequirementRealtimeHints,
  normalizeLegacyRequirementTarget,
  withDocumentRequirementInvalidates,
} from "./legacy-target-normalizer";

describe("legacy target normalizer", () => {
  it("keeps legacy REQUIREMENT input while exposing document canonical hints", () => {
    expect(
      normalizeLegacyRequirementTarget({
        targetId: "01H00000000000000000000001",
        targetType: "REQUIREMENT",
      }),
    ).toEqual({
      targetId: "01H00000000000000000000001",
      targetType: "REQUIREMENT",
      canonicalTargetType: "DOCUMENT",
      targetKind: "REQUIREMENT",
    });
  });

  it("emits document realtime target with requirement compatibility hints", () => {
    expect(
      legacyRequirementRealtimeHints({
        spaceId: "01H00000000000000000000002",
        targetId: "01H00000000000000000000001",
        targetType: "REQUIREMENT",
      }),
    ).toEqual({
      spaceId: "01H00000000000000000000002",
      targetId: "01H00000000000000000000001",
      targetType: "DOCUMENT",
      canonicalTargetType: "DOCUMENT",
      requirementId: "01H00000000000000000000001",
      targetKind: "REQUIREMENT",
    });

    expect(
      legacyRequirementRealtimeHints({
        spaceId: "01H00000000000000000000002",
        targetId: "01H00000000000000000000001",
        targetType: "WORK_ITEM",
        workItemType: "BUG",
      }),
    ).toEqual({
      spaceId: "01H00000000000000000000002",
      targetId: "01H00000000000000000000001",
      targetType: "WORK_ITEM",
      workItemType: "BUG",
    });
  });

  it("extends requirement invalidations with document caches during compatibility", () => {
    expect(
      withDocumentRequirementInvalidates(
        "REQUIREMENT",
        ["comments", "timeline", "requirement-detail"],
        ["document-comments", "document-timeline", "document-detail"],
      ),
    ).toEqual([
      "comments",
      "timeline",
      "requirement-detail",
      "document-comments",
      "document-timeline",
      "document-detail",
    ]);
  });
});
