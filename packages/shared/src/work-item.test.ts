import { describe, expect, it } from "vitest";

import {
  BugViewSchema,
  GetBugResponseSchema,
  ListBugsResponseSchema,
  UpdateBugRequestSchema,
  resolveBugLifecycleBucket,
} from "./work-item.ts";

const bug = {
  bugDetail: {
    severity: "CRITICAL",
    workItemId: "01PRZ3NDEKTSV4RRFFQ69G5FAP",
  },
  currentStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
  id: "01PRZ3NDEKTSV4RRFFQ69G5FAP",
  lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
  organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
  priority: "HIGH",
  reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
  statusCategory: "IN_PROGRESS",
  tags: [],
  title: "Login regression",
  type: "BUG",
  workflowVersionId: "01JRZ3NDEKTSV4RRFFQ69G5FAJ",
} as const;

const permissions = {
  availableActions: [],
  canComment: true,
  canEdit: true,
  canUploadAttachment: true,
} as const;

describe("work item contracts", () => {
  it("keeps bug list items lightweight but requires permissions on bug detail", () => {
    expect(BugViewSchema.parse(bug)).toEqual(bug);
    expect(
      ListBugsResponseSchema.parse({
        items: [bug],
        page: 1,
        pageSize: 20,
        total: 1,
      }).items[0]?.permissions,
    ).toBeUndefined();
    expect(() => GetBugResponseSchema.parse(bug)).toThrow();
    expect(
      GetBugResponseSchema.parse({
        ...bug,
        permissions,
      }).permissions,
    ).toEqual(permissions);
  });

  it("does not infer pending regression from VERIFYING category alone", () => {
    expect(
      resolveBugLifecycleBucket({
        stateCode: "QA_VERIFY",
        statusCategory: "VERIFYING",
      }),
    ).toBe("fixing");
    expect(
      resolveBugLifecycleBucket({
        stateCode: "PENDING_REGRESSION",
        statusCategory: "VERIFYING",
      }),
    ).toBe("pendingRegression");
    expect(
      resolveBugLifecycleBucket({
        stateCode: "pending_regression",
        statusCategory: "VERIFYING",
      }),
    ).toBe("pendingRegression");
    expect(
      resolveBugLifecycleBucket({
        stateCode: "PeNdInG_ReGrEsSiOn",
        statusCategory: "VERIFYING",
      }),
    ).toBe("pendingRegression");
  });

  it("keeps bug lifecycle fields out of ordinary PATCH bodies", () => {
    expect(
      UpdateBugRequestSchema.parse({
        actualResult: null,
        relatedTaskId: null,
        severity: "MAJOR",
      }),
    ).toMatchObject({
      actualResult: null,
      relatedTaskId: null,
      severity: "MAJOR",
    });

    for (const field of [
      "fixNote",
      "regressionResult",
      "regressionBy",
      "regressionAt",
    ]) {
      expect(() =>
        UpdateBugRequestSchema.parse({
          [field]: field === "regressionAt" ? "2026-05-13T00:00:00.000Z" : "x",
        }),
      ).toThrow();
    }
  });
});
