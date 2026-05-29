import { Logger } from "@nestjs/common";
import type { Requirement, SpaceRole } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
import type { OrganizationRepository } from "../organization/organization.repository";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { SpaceRepository } from "../space/space.repository";
import type { VersionRepository } from "../version/version.repository";
import type { RequirementRepository } from "./requirement.repository";
import { RequirementService } from "./requirement.service";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const VERSION_ID = "01H00000000000000000000003";
const REQUIREMENT_ID = "01H00000000000000000000004";
const VERSION_TWO_ID = "01H00000000000000000000005";
const IMAGE_ATTACHMENT_ID = "01H00000000000000000000006";
const FILE_ATTACHMENT_ID = "01H00000000000000000000007";
const MISSING_ATTACHMENT_ID = "01H00000000000000000000008";

describe("RequirementService audit logging", () => {
  it("writes audit logs for draft creation and saving", async () => {
    const subject = createSubject();

    const draft = await subject.service.createDraft(
      ACTOR_ID,
      SPACE_ID,
      { versionId: VERSION_ID },
      { requestId: "req-requirement-create" },
    );

    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: ACTOR_ID,
        after: expect.objectContaining({ id: draft.id, status: "DRAFT" }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-requirement-create",
        spaceId: SPACE_ID,
        targetId: REQUIREMENT_ID,
        targetType: "DOCUMENT",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR_ID,
        operation: "CREATED",
        target: { type: "DOCUMENT", id: draft.id },
        invalidates: [
          "requirement-list",
          "requirement-detail",
          "version-board",
        ],
        hints: expect.objectContaining({
          requirementId: draft.id,
          targetKind: "REQUIREMENT",
          targetId: draft.id,
          targetType: "DOCUMENT",
          versionId: VERSION_ID,
        }),
      }),
    );

    subject.requirements.current = makeRequirement({ status: "DRAFT" });

    await subject.service.update(
      ACTOR_ID,
      REQUIREMENT_ID,
      {
        baseRevision: 1,
        contentJson: {
          content: [{ text: "Confirmed scope", type: "text" }],
          type: "doc",
        },
        contentText: "Confirmed scope",
        title: "Confirmed requirement",
      },
      { requestId: "req-requirement-save" },
    );

    expect(subject.audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_ID,
        after: expect.objectContaining({
          status: "ACTIVE",
          title: "Confirmed requirement",
        }),
        before: expect.objectContaining({ status: "DRAFT" }),
        metadata: expect.objectContaining({
          operation: "SAVE",
          targetKind: "REQUIREMENT",
        }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-requirement-save",
        spaceId: SPACE_ID,
        targetId: REQUIREMENT_ID,
        targetType: "DOCUMENT",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "UPDATED",
        target: { type: "DOCUMENT", id: REQUIREMENT_ID },
        hints: expect.objectContaining({
          changedFields: expect.arrayContaining(["contentJson", "title"]),
          targetKind: "REQUIREMENT",
          targetType: "DOCUMENT",
        }),
      }),
    );
  });

  it("writes audit logs for archiving and deleting empty drafts", async () => {
    const subject = createSubject({
      current: makeRequirement({ status: "ACTIVE", title: "Archived req" }),
    });

    await subject.service.update(
      ACTOR_ID,
      REQUIREMENT_ID,
      { baseRevision: 1, status: "ARCHIVED" },
      { requestId: "req-requirement-archive" },
    );

    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_ID,
        after: expect.objectContaining({ status: "ARCHIVED" }),
        before: expect.objectContaining({ status: "ACTIVE" }),
        metadata: expect.objectContaining({
          operation: "ARCHIVE",
          targetKind: "REQUIREMENT",
        }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-requirement-archive",
        spaceId: SPACE_ID,
        targetId: REQUIREMENT_ID,
        targetType: "DOCUMENT",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "STATUS_CHANGED",
        target: { type: "DOCUMENT", id: REQUIREMENT_ID },
        hints: expect.objectContaining({
          changedFields: ["status"],
          targetKind: "REQUIREMENT",
          targetType: "DOCUMENT",
        }),
      }),
    );

    subject.requirements.current = makeRequirement({
      authorId: ACTOR_ID,
      contentJson: {},
      status: "DRAFT",
      title: "",
    });

    await subject.service.deleteDraft(ACTOR_ID, REQUIREMENT_ID, {
      requestId: "req-requirement-delete",
    });

    expect(subject.audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionType: "DELETE",
        actorId: ACTOR_ID,
        before: expect.objectContaining({ status: "DRAFT", title: "" }),
        metadata: expect.objectContaining({
          operation: "DELETE_EMPTY_DRAFT",
          targetKind: "REQUIREMENT",
        }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-requirement-delete",
        spaceId: SPACE_ID,
        targetId: REQUIREMENT_ID,
        targetType: "DOCUMENT",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "DELETED",
        target: { type: "DOCUMENT", id: REQUIREMENT_ID },
      }),
    );
  });

  it("logs realtime publish failures without failing the write", async () => {
    const subject = createSubject();
    const logger = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    subject.realtime.publish.mockImplementationOnce(() => {
      throw new Error("publish failed");
    });

    await expect(
      subject.service.createDraft(ACTOR_ID, SPACE_ID, {}),
    ).resolves.toMatchObject({
      id: REQUIREMENT_ID,
    });
    expect(logger).toHaveBeenCalledWith(
      "Failed to publish requirement realtime event",
      expect.stringContaining("publish failed"),
    );
    logger.mockRestore();
  });

  it("creates Markdown drafts without exposing JSON content", async () => {
    const subject = createSubject();

    const draft = await subject.service.createDraft(ACTOR_ID, SPACE_ID, {
      contentFormat: "MARKDOWN",
    });

    expect(subject.requirements.createdInput).toMatchObject({
      contentFormat: "MARKDOWN",
    });
    expect(draft).toMatchObject({
      contentFormat: "MARKDOWN",
      contentMarkdown: "",
      status: "DRAFT",
    });
    expect(draft).not.toHaveProperty("contentJson");
    expect(draft).not.toHaveProperty("contentMarkdownCache");
  });

  it("requires cascade confirmation before moving a requirement to another version with downstream links", async () => {
    const subject = createSubject({
      current: makeRequirement({
        status: "ACTIVE",
        versionId: VERSION_ID,
      }),
    });
    subject.requirements.impact = {
      bugCount: 1,
      intakeItemCount: 1,
      relatedBugCount: 1,
      workItemCount: 2,
    };

    await expect(
      subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
        baseRevision: 1,
        contentJson: {
          content: [{ text: "Move scope", type: "text" }],
          type: "doc",
        },
        cascadeVersionChange: false,
        title: "Move requirement",
        versionId: VERSION_TWO_ID,
      }),
    ).rejects.toMatchObject({
      code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
    });
    expect(subject.requirements.savedInput).toBeUndefined();

    await subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
      baseRevision: 1,
      contentJson: {
        content: [{ text: "Move scope", type: "text" }],
        type: "doc",
      },
      cascadeVersionChange: true,
      title: "Move requirement",
      versionId: VERSION_TWO_ID,
    });

    expect(subject.requirements.savedInput).toMatchObject({
      cascadeVersionChange: true,
      versionId: VERSION_TWO_ID,
    });
    expect(subject.realtime.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        invalidates: [
          "requirement-list",
          "requirement-detail",
          "version-board",
          "intake-list",
          "work-item-list",
          "bug-list",
          "workbench",
          "space-overview",
          "exception-view",
          "timeline",
        ],
        hints: expect.objectContaining({
          suggestFullRefresh: true,
        }),
      }),
    );
  });

  it("rejects base64 image data in text and markdown caches", async () => {
    const subject = createSubject({
      current: makeRequirement({ status: "ACTIVE" }),
    });

    await expect(
      subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
        baseRevision: 1,
        contentJson: {
          content: [{ text: "Scope", type: "text" }],
          type: "doc",
        },
        contentMarkdownCache: "![inline](data:image/png;base64,AAAA)",
        title: "Unsafe cache",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    await expect(
      subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
        baseRevision: 1,
        contentJson: {
          content: [{ text: "Scope", type: "text" }],
          type: "doc",
        },
        contentText: "prefix data:image/png;base64,AAAA",
        title: "Unsafe text",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(subject.requirements.savedInput).toBeUndefined();
  });

  it("saves Markdown requirements with Markdown source and derived search text", async () => {
    const subject = createSubject({
      current: makeRequirement({ status: "ACTIVE" }),
    });

    await subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
      baseRevision: 1,
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Scope\n\n- Ship Markdown safely.",
      title: "Markdown requirement",
    });

    expect(subject.requirements.savedInput).toMatchObject({
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Scope\n\n- Ship Markdown safely.",
      contentText: "Scope\n\nShip Markdown safely.",
    });
    expect(subject.requirements.savedInput).not.toHaveProperty("contentJson");
    expect(subject.requirements.savedInput).not.toHaveProperty(
      "contentMarkdownCache",
    );
  });

  it("allows requirement writers to update draft requirements without participant membership", async () => {
    const subject = createSubject({
      current: makeRequirement({ status: "DRAFT" }),
      isParticipant: false,
      role: "REQUIREMENT",
    });

    await subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
      baseRevision: 1,
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Draft scope",
      title: "Draft requirement",
    });

    expect(subject.requirements.savedInput).toMatchObject({
      contentFormat: "MARKDOWN",
      title: "Draft requirement",
    });
  });

  it("rejects Markdown image targets outside attachment references", async () => {
    const subject = createSubject({
      current: makeRequirement({ status: "ACTIVE" }),
    });

    await expect(
      subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
        baseRevision: 1,
        contentFormat: "MARKDOWN",
        contentMarkdown: "![remote](https://example.com/image.png)",
        title: "Unsafe Markdown image",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(subject.requirements.savedInput).toBeUndefined();
  });

  it("saves Markdown image references to current requirement image attachments", async () => {
    const subject = createSubject({
      current: makeRequirement({
        attachments: [
          makeAttachmentRef({
            id: IMAGE_ATTACHMENT_ID,
            mimeType: "image/png",
          }),
        ],
        status: "ACTIVE",
      }),
    });

    await subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
      baseRevision: 1,
      contentFormat: "MARKDOWN",
      contentMarkdown: [
        "# Scope",
        "",
        `![screenshot](attachment://${IMAGE_ATTACHMENT_ID})`,
        `![same screenshot](attachment://${IMAGE_ATTACHMENT_ID})`,
      ].join("\n"),
      title: "Markdown requirement with image",
    });

    expect(subject.requirements.savedInput).toMatchObject({
      contentFormat: "MARKDOWN",
      contentMarkdown: expect.stringContaining(
        `attachment://${IMAGE_ATTACHMENT_ID}`,
      ),
    });
  });

  it("rejects Markdown image references to missing attachments", async () => {
    const subject = createSubject({
      current: makeRequirement({
        attachments: [
          makeAttachmentRef({
            id: IMAGE_ATTACHMENT_ID,
            mimeType: "image/png",
          }),
        ],
        status: "ACTIVE",
      }),
    });

    await expect(
      subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
        baseRevision: 1,
        contentFormat: "MARKDOWN",
        contentMarkdown: `![missing](attachment://${MISSING_ATTACHMENT_ID})`,
        title: "Markdown requirement with missing image",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(subject.requirements.savedInput).toBeUndefined();
  });

  it("rejects Markdown image references to non-image attachments", async () => {
    const subject = createSubject({
      current: makeRequirement({
        attachments: [
          makeAttachmentRef({
            id: FILE_ATTACHMENT_ID,
            mimeType: "application/pdf",
          }),
        ],
        status: "ACTIVE",
      }),
    });

    await expect(
      subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
        baseRevision: 1,
        contentFormat: "MARKDOWN",
        contentMarkdown: `![file](attachment://${FILE_ATTACHMENT_ID})`,
        title: "Markdown requirement with file image",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(subject.requirements.savedInput).toBeUndefined();
  });

  it("rejects attachment image references during create validation", async () => {
    const subject = createSubject();

    await expect(
      subject.service.validateCreateRequest(ACTOR_ID, SPACE_ID, {
        contentFormat: "MARKDOWN",
        contentMarkdown: `![uploaded](attachment://${IMAGE_ATTACHMENT_ID})`,
        title: "Markdown create request",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(subject.requirements.savedInput).toBeUndefined();
  });

  it("saves explicit requirement version clearing when there is no downstream impact", async () => {
    const subject = createSubject({
      current: makeRequirement({
        status: "ACTIVE",
        versionId: VERSION_ID,
      }),
    });

    await subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
      baseRevision: 1,
      contentJson: {
        content: [{ text: "Clear version", type: "text" }],
        type: "doc",
      },
      title: "Clear requirement version",
      versionId: null,
    });

    expect(subject.requirements.savedInput).toMatchObject({
      versionId: null,
    });
  });
});

function createSubject(
  input: {
    current?: Requirement;
    isParticipant?: boolean;
    role?: SpaceRole;
  } = {},
) {
  const requirements = new FakeRequirementRepository(
    input.current ?? makeRequirement({ status: "DRAFT" }),
    input.isParticipant ?? true,
  );
  const spaces = {
    findAccessibleById: vi.fn(async () => ({
      role: input.role ?? "PM",
      space: {
        code: "REQ",
        id: SPACE_ID,
        name: "Requirement Space",
        organizationId: ORGANIZATION_ID,
        settings: { staleThresholdDays: 3 },
        status: "ACTIVE" as const,
      },
    })),
    findMemberByUserId: vi.fn(),
  } as unknown as SpaceRepository;
  const versions = {
    findById: vi.fn(async () => ({
      id: VERSION_ID,
      name: "M1",
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      stats: {
        blockedCount: 0,
        bugCount: 0,
        requirementCount: 0,
        taskCount: 0,
      },
      status: "PLANNED" as const,
    })),
  } as unknown as VersionRepository;
  const organizations = {
    findMemberByUserId: vi.fn(),
  } as unknown as OrganizationRepository;
  const audit = createAuditService();
  const realtime = createRealtimePublisher();

  return {
    audit,
    requirements,
    realtime,
    service: new RequirementService(
      requirements,
      spaces,
      versions,
      organizations,
      audit,
      realtime,
    ),
  };
}

class FakeRequirementRepository implements RequirementRepository {
  impact = {
    bugCount: 0,
    intakeItemCount: 0,
    relatedBugCount: 0,
    workItemCount: 0,
  };
  savedInput?: Parameters<RequirementRepository["save"]>[0];
  createdInput?: Parameters<RequirementRepository["createDraft"]>[0];

  constructor(
    public current: Requirement,
    private readonly participant: boolean,
  ) {}

  async createDraft(
    input: Parameters<RequirementRepository["createDraft"]>[0],
  ) {
    this.createdInput = input;
    this.current = makeRequirement({
      status: "DRAFT",
      versionId: input.versionId,
    });
    if (input.contentFormat === "MARKDOWN") {
      this.current = {
        ...this.current,
        contentFormat: "MARKDOWN",
        contentMarkdown: "",
      } as Requirement;
      const markdownDraft = this.current as {
        contentJson?: unknown;
        contentMarkdownCache?: unknown;
      };
      delete markdownDraft.contentJson;
      delete markdownDraft.contentMarkdownCache;
    }
    return this.current;
  }

  async findById() {
    return this.current;
  }

  async isParticipant() {
    return this.participant;
  }

  async listBySpaceId() {
    return {
      items: [this.current],
      page: 1,
      pageSize: 20,
      total: 1,
    };
  }

  async countVersionCascadeImpact() {
    return this.impact;
  }

  async save(input: Parameters<RequirementRepository["save"]>[0]) {
    this.savedInput = input;
    const content =
      input.contentFormat === "MARKDOWN"
        ? {
            contentFormat: "MARKDOWN" as const,
            contentMarkdown: input.contentMarkdown,
            contentText: input.contentText,
          }
        : {
            contentFormat: "TIPTAP_JSON" as const,
            contentJson: input.contentJson,
            contentMarkdownCache: input.contentMarkdownCache,
            contentText: input.contentText,
          };

    this.current = {
      ...this.current,
      ...content,
      status: "ACTIVE",
      title: input.title ?? this.current.title,
      ...(input.versionId !== undefined
        ? { versionId: input.versionId ?? undefined }
        : {}),
    } as Requirement;
    return this.current;
  }

  async archive() {
    this.current = makeRequirement({
      ...this.current,
      status: "ARCHIVED",
    });
    return this.current;
  }

  async deleteDraft() {
    return true;
  }
}

function createAuditService() {
  return {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
  };
}

function createRealtimePublisher() {
  return {
    publish: vi.fn(),
  } as unknown as RealtimePublisherService & {
    publish: ReturnType<typeof vi.fn>;
  };
}

function makeRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    attachments: [],
    contentFormat: "TIPTAP_JSON",
    contentJson: {},
    createdAt: "2026-05-13T00:00:00.000Z",
    id: REQUIREMENT_ID,
    organizationId: ORGANIZATION_ID,
    relatedWorkItems: {
      bugCount: 0,
      bugs: [],
      taskCount: 0,
      tasks: [],
    },
    revision: 1,
    spaceId: SPACE_ID,
    status: "DRAFT",
    title: "Draft requirement",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
    tags: overrides.tags ?? [],
  } as Requirement;
}

function makeAttachmentRef(
  overrides: Pick<NonNullable<Requirement["attachments"]>[number], "id"> &
    Partial<NonNullable<Requirement["attachments"]>[number]>,
): NonNullable<Requirement["attachments"]>[number] {
  return {
    fileKey: `requirements/${REQUIREMENT_ID}/${overrides.id}`,
    fileName: "attachment.png",
    mimeType: "image/png",
    size: 1024,
    ...overrides,
  };
}
