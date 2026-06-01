import { describe, expect, it } from "vitest";

import {
  BugViewSchema,
  BugListQuerySchema,
  GetBugResponseSchema,
  ListBugsResponseSchema,
  WorkItemListQuerySchema,
  UpdateBugRequestSchema,
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

  it("accepts list dimension counts with explicit totals", () => {
    expect(
      ListBugsResponseSchema.parse({
        dimensionCounts: [
          {
            dimension: "tagId",
            total: 2,
            buckets: [
              {
                value: "01TRZ3NDEKTSV4RRFFQ69G5TAG",
                count: 2,
              },
              {
                value: null,
                count: 1,
              },
            ],
          },
        ],
        items: [bug],
        page: 1,
        pageSize: 20,
        total: 1,
      }).dimensionCounts?.[0],
    ).toEqual({
      dimension: "tagId",
      total: 2,
      buckets: [
        {
          value: "01TRZ3NDEKTSV4RRFFQ69G5TAG",
          count: 2,
        },
        {
          value: null,
          count: 1,
        },
      ],
    });
  });

  it("parses empty bucket list query filters", () => {
    expect(
      WorkItemListQuerySchema.parse({
        noRequirement: "true",
        noTags: "true",
        noVersion: "false",
        page: "1",
        pageSize: "20",
        unassigned: "true",
      }),
    ).toMatchObject({
      noRequirement: true,
      noTags: true,
      noVersion: false,
      unassigned: true,
    });
    expect(
      BugListQuerySchema.parse({
        noRelatedTask: "true",
        noRequirement: "true",
        noTags: "true",
        noVersion: "true",
        page: "1",
        pageSize: "20",
        unassigned: "true",
      }),
    ).toMatchObject({
      noRelatedTask: true,
      noRequirement: true,
      noTags: true,
      noVersion: true,
      unassigned: true,
    });
  });
});
