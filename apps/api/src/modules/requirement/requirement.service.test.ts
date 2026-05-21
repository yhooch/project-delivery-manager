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
        targetType: "REQUIREMENT",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR_ID,
        operation: "CREATED",
        target: { type: "REQUIREMENT", id: draft.id },
        invalidates: [
          "requirement-list",
          "requirement-detail",
          "version-board",
        ],
        hints: expect.objectContaining({
          targetId: draft.id,
          targetType: "REQUIREMENT",
          versionId: VERSION_ID,
        }),
      }),
    );

    subject.requirements.current = makeRequirement({ status: "DRAFT" });

    await subject.service.update(
      ACTOR_ID,
      REQUIREMENT_ID,
      {
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
          status: "CONFIRMED",
          title: "Confirmed requirement",
        }),
        before: expect.objectContaining({ status: "DRAFT" }),
        metadata: { operation: "SAVE" },
        organizationId: ORGANIZATION_ID,
        requestId: "req-requirement-save",
        spaceId: SPACE_ID,
        targetId: REQUIREMENT_ID,
        targetType: "REQUIREMENT",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "UPDATED",
        target: { type: "REQUIREMENT", id: REQUIREMENT_ID },
        hints: expect.objectContaining({
          changedFields: expect.arrayContaining(["contentJson", "title"]),
        }),
      }),
    );
  });

  it("writes audit logs for archiving and deleting empty drafts", async () => {
    const subject = createSubject({
      current: makeRequirement({ status: "CONFIRMED", title: "Archived req" }),
    });

    await subject.service.update(
      ACTOR_ID,
      REQUIREMENT_ID,
      { status: "ARCHIVED" },
      { requestId: "req-requirement-archive" },
    );

    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_ID,
        after: expect.objectContaining({ status: "ARCHIVED" }),
        before: expect.objectContaining({ status: "CONFIRMED" }),
        metadata: { operation: "ARCHIVE" },
        organizationId: ORGANIZATION_ID,
        requestId: "req-requirement-archive",
        spaceId: SPACE_ID,
        targetId: REQUIREMENT_ID,
        targetType: "REQUIREMENT",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "STATUS_CHANGED",
        target: { type: "REQUIREMENT", id: REQUIREMENT_ID },
        hints: expect.objectContaining({ changedFields: ["status"] }),
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
        metadata: { operation: "DELETE_EMPTY_DRAFT" },
        organizationId: ORGANIZATION_ID,
        requestId: "req-requirement-delete",
        spaceId: SPACE_ID,
        targetId: REQUIREMENT_ID,
        targetType: "REQUIREMENT",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "DELETED",
        target: { type: "REQUIREMENT", id: REQUIREMENT_ID },
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

  it("requires cascade confirmation before moving a requirement to another version with downstream links", async () => {
    const subject = createSubject({
      current: makeRequirement({
        status: "CONFIRMED",
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
  });

  it("rejects base64 image data in text and markdown caches", async () => {
    const subject = createSubject({
      current: makeRequirement({ status: "CONFIRMED" }),
    });

    await expect(
      subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
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

  it("saves explicit requirement version clearing when there is no downstream impact", async () => {
    const subject = createSubject({
      current: makeRequirement({
        status: "CONFIRMED",
        versionId: VERSION_ID,
      }),
    });

    await subject.service.update(ACTOR_ID, REQUIREMENT_ID, {
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
    role?: SpaceRole;
  } = {},
) {
  const requirements = new FakeRequirementRepository(
    input.current ?? makeRequirement({ status: "DRAFT" }),
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

  constructor(public current: Requirement) {}

  async createDraft(input: Parameters<RequirementRepository["createDraft"]>[0]) {
    this.current = makeRequirement({
      status: "DRAFT",
      versionId: input.versionId,
    });
    return this.current;
  }

  async findById() {
    return this.current;
  }

  async isParticipant() {
    return true;
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
    this.current = makeRequirement({
      ...this.current,
      status: "CONFIRMED",
      title: input.title ?? this.current.title,
      ...(input.versionId !== undefined
        ? { versionId: input.versionId ?? undefined }
        : {}),
    });
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
    spaceId: SPACE_ID,
    status: "DRAFT",
    title: "Draft requirement",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
    tags: overrides.tags ?? [],
  };
}
