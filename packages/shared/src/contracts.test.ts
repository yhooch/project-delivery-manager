import { describe, expect, it } from "vitest";
import {
  ApiErrorCodeSchema,
  AppSessionSchema,
  apiContracts,
  PresignAttachmentRequestSchema,
  RequirementSchema,
  UpdateRequirementRequestSchema,
  VersionSchema,
  generateOpenApiDocument,
} from "./index.ts";

describe("shared contracts", () => {
  it("contains the required M0/M1/M2 error codes", () => {
    expect(ApiErrorCodeSchema.options).toEqual(
      expect.arrayContaining([
        "INVALID_CREDENTIALS",
        "RATE_LIMITED",
        "ORGANIZATION_NOT_FOUND",
        "ORGANIZATION_ACCESS_DENIED",
        "CROSS_ORGANIZATION_ACCESS_DENIED",
        "ORGANIZATION_MEMBER_NOT_FOUND",
        "LAST_ORGANIZATION_OWNER_REQUIRED",
        "TARGET_REQUIRED_FOR_ATTACHMENT",
        "ATTACHMENT_TARGET_NOT_FOUND",
        "DRAFT_REQUIREMENT_REQUIRED",
        "INTAKE_ITEM_NOT_ACCEPTED",
        "INTAKE_ITEM_ALREADY_CONVERTED",
      ]),
    );
  });

  it("accepts the no-organization app session empty state", () => {
    const session = AppSessionSchema.parse({
      user: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        username: "demo_user",
        name: "demo_user",
        status: "ACTIVE",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
      },
      organizations: [],
      spaces: [],
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: false,
      },
    });

    expect(session.defaultOrganizationId).toBeUndefined();
    expect(session.defaultSpaceId).toBeUndefined();
  });

  it("accepts a multi-organization app session with a consistent default space", () => {
    const session = AppSessionSchema.parse({
      user: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        username: "demo_user",
        name: "demo_user",
        status: "ACTIVE",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
      },
      organizations: [
        {
          id: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
          name: "Org A",
          code: "org-a",
          role: "OWNER",
          status: "ACTIVE",
        },
        {
          id: "01CRZ3NDEKTSV4RRFFQ69G5FAB",
          name: "Org B",
          code: "org-b",
          role: "MEMBER",
          status: "ACTIVE",
        },
      ],
      spaces: [
        {
          id: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
          organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
          name: "Space A",
          code: "space-a",
          role: "SPACE_ADMIN",
          status: "ACTIVE",
        },
      ],
      defaultOrganizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      defaultSpaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
    });

    expect(
      session.spaces.find((space) => space.id === session.defaultSpaceId)
        ?.organizationId,
    ).toBe(session.defaultOrganizationId);
  });

  it("covers M1 version statistics and requirement related work item placeholders", () => {
    const version = VersionSchema.parse({
      id: "01ERZ3NDEKTSV4RRFFQ69G5FAD",
      organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      name: "M1",
      target: "Deliver the M1 business container",
      ownerId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      status: "IN_PROGRESS",
      startDate: "2026-05-13T00:00:00.000Z",
      targetDate: "2026-05-31T00:00:00.000Z",
      stats: {
        requirementCount: 1,
        taskCount: 0,
        bugCount: 0,
        blockedCount: 0,
      },
    });

    const requirement = RequirementSchema.parse({
      id: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
      organizationId: version.organizationId,
      spaceId: version.spaceId,
      versionId: version.id,
      title: "Requirement",
      contentJson: { type: "doc", content: [] },
      contentFormat: "TIPTAP_JSON",
      status: "CONFIRMED",
      relatedWorkItems: {
        taskCount: 0,
        bugCount: 0,
        tasks: [],
        bugs: [],
      },
    });

    expect(version.stats.requirementCount).toBe(1);
    expect(requirement.relatedWorkItems.taskCount).toBe(0);
  });

  it("accepts both requirement save and archive request semantics", () => {
    expect(
      UpdateRequirementRequestSchema.parse({
        title: "Requirement",
        contentJson: { type: "doc", content: [] },
        contentText: "Requirement",
        contentMarkdownCache: "# Requirement",
      }),
    ).toMatchObject({ title: "Requirement" });

    expect(
      UpdateRequirementRequestSchema.parse({
        status: "ARCHIVED",
      }),
    ).toEqual({ status: "ARCHIVED" });
  });

  it("restricts M1 attachment presign requests to the shared whitelist", () => {
    expect(() =>
      PresignAttachmentRequestSchema.parse({
        targetType: "REQUIREMENT",
        targetId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        fileName: "design.png",
        mimeType: "image/png",
        size: 1024,
      }),
    ).not.toThrow();

    expect(() =>
      PresignAttachmentRequestSchema.parse({
        targetType: "REQUIREMENT",
        targetId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        fileName: "payload.bin",
        mimeType: "application/octet-stream",
        size: 1024,
      }),
    ).toThrow();
  });

  it("generates OpenAPI operations from the endpoint contract list", () => {
    const document = generateOpenApiDocument();
    const operationCount = Object.values(document.paths).reduce(
      (count, pathItem) => count + Object.keys(pathItem).length,
      0,
    );

    expect(document.openapi).toBe("3.1.0");
    expect(operationCount).toBe(apiContracts.length);
    expect(document.paths["/auth/session"]?.get?.operationId).toBe(
      "getAuthSession",
    );
    expect(
      document.paths["/intake-items/{id}/convert-to-work-items"]?.post
        ?.operationId,
    ).toBe("convertIntakeItemToWorkItems");
    expect(document.paths["/views/spaces/{spaceId}/overview"]?.get?.operationId).toBe(
      "getSpaceOverview",
    );
    expect(document.paths["/attachments/presign"]?.post?.["x-error-codes"]).toContain(
      "DRAFT_REQUIREMENT_REQUIRED",
    );
  });
});
