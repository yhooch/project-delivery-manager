import { HttpStatus } from "@nestjs/common";
import type { Space, SpaceRole, TagDto } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { SpaceRepository } from "../space/space.repository";
import type { SpaceAccess } from "../space/space.types";
import type { TagRepository } from "./tag.repository";
import { TagService } from "./tag.service";
import type {
  CreateTagInput,
  MergeTagsInput,
  MergeTagsResult,
  SoftDeleteTagInput,
  SoftDeleteTagResult,
  TagFilterOptionsInput,
  TagListInput,
  TagListResult,
} from "./tag.types";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const TAG_ID = "01H00000000000000000000003";
const SOURCE_TAG_ID = "01H00000000000000000000004";

describe("TagService", () => {
  it("lists visible space tags with normalized query and usage flag", async () => {
    const subject = createSubject("VIEWER");

    const result = await subject.service.list(ACTOR_ID, SPACE_ID, {
      includeUsage: true,
      page: 2,
      pageSize: 10,
      query: " #Release   Blocker ",
    });

    expect(result).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 0,
    });
    expect(subject.tags.listInput).toMatchObject({
      includeUsage: true,
      normalizedQuery: "release blocker",
      organizationId: ORGANIZATION_ID,
      page: 2,
      pageSize: 10,
      spaceId: SPACE_ID,
    });
  });

  it("lists stable tag filter options for a page scope", async () => {
    const subject = createSubject("VIEWER");
    const tag = makeTag();

    subject.tags.filterOptions = [tag];

    await expect(
      subject.service.listFilterOptions(ACTOR_ID, SPACE_ID, {
        scope: "TASK",
      }),
    ).resolves.toEqual({ items: [tag] });
    expect(subject.tags.filterOptionsInput).toMatchObject({
      scope: "TASK",
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      staleThresholdDays: 5,
    });
    expect(subject.tags.filterOptionsInput?.now).toBeInstanceOf(Date);
  });

  it("creates normalized tags for non-viewer members and writes audit", async () => {
    const subject = createSubject("PM");

    const created = await subject.service.create(
      ACTOR_ID,
      SPACE_ID,
      { name: " #Release   Blocker " },
      { requestId: "req-create-tag" },
    );

    expect(created).toMatchObject({
      displayName: "#Release Blocker",
      name: "Release Blocker",
      normalizedName: "release blocker",
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });
    expect(subject.tags.createInput).toMatchObject({
      createdById: ACTOR_ID,
      name: "Release Blocker",
      normalizedName: "release blocker",
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });
    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: ACTOR_ID,
        organizationId: ORGANIZATION_ID,
        requestId: "req-create-tag",
        spaceId: SPACE_ID,
        targetId: created.id,
        targetType: "TAG",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TAG_CHANGED",
        target: { type: "SPACE", id: SPACE_ID },
        invalidates: expect.arrayContaining([
          "work-item-list",
          "bug-list",
          "requirement-list",
          "intake-list",
        ]),
        hints: expect.objectContaining({
          tagId: created.id,
          targetId: SPACE_ID,
          targetType: "SPACE",
        }),
      }),
    );
  });

  it("returns an existing active tag for the same normalized name", async () => {
    const subject = createSubject("DEVELOPER");
    const existing = makeTag({
      id: TAG_ID,
      name: "Release Blocker",
      normalizedName: "release blocker",
    });

    subject.tags.items.set(TAG_ID, existing);

    const result = await subject.service.create(ACTOR_ID, SPACE_ID, {
      name: "#release blocker",
    });

    expect(result).toBe(existing);
    expect(subject.tags.createInput).toBeUndefined();
    expect(subject.audit.record).not.toHaveBeenCalled();
    expect(subject.realtime.publish).not.toHaveBeenCalled();
  });

  it("rejects viewer tag creation and audits the denial", async () => {
    const subject = createSubject("VIEWER");

    await expect(
      subject.service.create(ACTOR_ID, SPACE_ID, { name: "Blocked" }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "ACCESS_DENIED",
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        targetId: SPACE_ID,
        targetType: "SPACE",
      }),
    );
    expect(subject.realtime.publish).not.toHaveBeenCalled();
  });

  it("soft deletes orphan tags for PM and writes audit", async () => {
    const subject = createSubject("PM");
    const tag = makeTag({ id: TAG_ID });

    subject.tags.items.set(TAG_ID, tag);
    subject.tags.deleteResult = {
      status: "deleted",
      deletedAt: new Date("2026-05-19T00:00:00.000Z"),
      tag,
    };

    await expect(
      subject.service.delete(ACTOR_ID, TAG_ID, { requestId: "req-delete-tag" }),
    ).resolves.toEqual({});
    expect(subject.tags.softDeleteInput).toEqual({
      tagId: TAG_ID,
      updatedById: ACTOR_ID,
    });
    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "DELETE",
        actorId: ACTOR_ID,
        organizationId: ORGANIZATION_ID,
        requestId: "req-delete-tag",
        spaceId: SPACE_ID,
        targetId: TAG_ID,
        targetType: "TAG",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TAG_CHANGED",
        target: { type: "SPACE", id: SPACE_ID },
        hints: expect.objectContaining({
          tagId: TAG_ID,
          targetId: SPACE_ID,
          targetType: "SPACE",
        }),
      }),
    );
  });

  it("merges source tags for PM and publishes full refresh realtime hints", async () => {
    const subject = createSubject("PM");
    const targetTag = makeTag({ id: TAG_ID, name: "Backend" });
    const sourceTag = makeTag({ id: SOURCE_TAG_ID, name: "Old Backend" });

    subject.tags.mergeResult = {
      targetTag,
      sourceTags: [sourceTag],
      dryRun: false,
      sourceAssignmentsRemoved: 2,
      targetAssignmentsCreated: 1,
      duplicateAssignmentsSkipped: 1,
      deletedSourceTags: 1,
      affectedTargetsByType: [{ targetType: "WORK_ITEM", count: 1 }],
    };

    await expect(
      subject.service.merge(
        ACTOR_ID,
        SPACE_ID,
        {
          sourceTagIds: [SOURCE_TAG_ID],
          targetTagId: TAG_ID,
          dryRun: false,
        },
        { requestId: "req-merge-tags" },
      ),
    ).resolves.toEqual(subject.tags.mergeResult);
    expect(subject.tags.mergeInput).toEqual({
      dryRun: false,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      sourceTagIds: [SOURCE_TAG_ID],
      targetTagId: TAG_ID,
      updatedById: ACTOR_ID,
    });
    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_ID,
        metadata: expect.objectContaining({
          affectedTargetsByType: [{ targetType: "WORK_ITEM", count: 1 }],
          deletedSourceTags: 1,
          duplicateAssignmentsSkipped: 1,
          operation: "MERGE_TAGS",
          sourceTagIds: [SOURCE_TAG_ID],
          sourceAssignmentsRemoved: 2,
          targetAssignmentsCreated: 1,
          targetTagId: TAG_ID,
        }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-merge-tags",
        spaceId: SPACE_ID,
        targetId: SPACE_ID,
        targetType: "SPACE",
      }),
    );
    expect(subject.realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TAG_CHANGED",
        target: { type: "SPACE", id: SPACE_ID },
        invalidates: expect.arrayContaining([
          "work-item-list",
          "bug-list",
          "requirement-list",
          "requirement-detail",
          "document-list",
          "document-detail",
          "resource-documents",
          "version-board",
          "workbench",
          "space-overview",
          "timeline",
          "exception-view",
        ]),
        hints: expect.objectContaining({
          sourceTagIds: [SOURCE_TAG_ID],
          targetTagId: TAG_ID,
          changedFields: ["tags", "tagIds"],
          suggestFullRefresh: true,
          targetId: SPACE_ID,
          targetType: "SPACE",
        }),
      }),
    );
  });

  it("returns dry-run merge statistics without audit or realtime writes", async () => {
    const subject = createSubject("SPACE_ADMIN");

    subject.tags.mergeResult = {
      targetTag: makeTag({ id: TAG_ID }),
      sourceTags: [makeTag({ id: SOURCE_TAG_ID })],
      dryRun: true,
      sourceAssignmentsRemoved: 1,
      targetAssignmentsCreated: 1,
      duplicateAssignmentsSkipped: 0,
      deletedSourceTags: 1,
      affectedTargetsByType: [{ targetType: "INTAKE_ITEM", count: 1 }],
    };

    await expect(
      subject.service.merge(ACTOR_ID, SPACE_ID, {
        sourceTagIds: [SOURCE_TAG_ID],
        targetTagId: TAG_ID,
        dryRun: true,
      }),
    ).resolves.toEqual(subject.tags.mergeResult);
    expect(subject.audit.record).not.toHaveBeenCalled();
    expect(subject.realtime.publish).not.toHaveBeenCalled();
  });

  it("rejects merging tags for non-manager roles", async () => {
    const subject = createSubject("DEVELOPER");

    await expect(
      subject.service.merge(ACTOR_ID, SPACE_ID, {
        sourceTagIds: [SOURCE_TAG_ID],
        targetTagId: TAG_ID,
        dryRun: false,
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
    expect(subject.tags.mergeInput).toBeUndefined();
  });

  it("rejects deleting tags that still have active assignments", async () => {
    const subject = createSubject("SPACE_ADMIN");

    subject.tags.items.set(TAG_ID, makeTag({ id: TAG_ID }));
    subject.tags.deleteResult = { status: "in_use" };

    await expect(
      subject.service.delete(ACTOR_ID, TAG_ID),
    ).rejects.toMatchObject({
      code: "TAG_IN_USE",
      status: HttpStatus.CONFLICT,
    });
    expect(subject.audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "DELETE",
      }),
    );
  });

  it("rejects deleting tags for non-manager roles", async () => {
    const subject = createSubject("DEVELOPER");

    subject.tags.items.set(TAG_ID, makeTag({ id: TAG_ID }));

    await expect(
      subject.service.delete(ACTOR_ID, TAG_ID),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
    expect(subject.tags.softDeleteInput).toBeUndefined();
  });

  it("returns TAG_NOT_FOUND for missing tags", async () => {
    const subject = createSubject("PM");

    await expect(
      subject.service.delete(ACTOR_ID, TAG_ID),
    ).rejects.toMatchObject({
      code: "TAG_NOT_FOUND",
      status: HttpStatus.NOT_FOUND,
    });
  });
});

function createSubject(role: SpaceRole) {
  const tags = new FakeTagRepository();
  const spaces = new FakeSpaceRepository(role);
  const audit = createAuditService();
  const realtime = createRealtimePublisher();

  return {
    audit,
    realtime,
    service: new TagService(
      tags,
      spaces as unknown as SpaceRepository,
      audit,
      realtime,
    ),
    spaces,
    tags,
  };
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

class FakeTagRepository implements TagRepository {
  createInput?: CreateTagInput;
  deleteResult?: SoftDeleteTagResult;
  filterOptions: TagDto[] = [];
  filterOptionsInput?: TagFilterOptionsInput;
  readonly items = new Map<string, TagDto>();
  listInput?: TagListInput;
  mergeInput?: MergeTagsInput;
  mergeResult?: MergeTagsResult;
  softDeleteInput?: SoftDeleteTagInput;

  async listBySpace(input: TagListInput): Promise<TagListResult> {
    this.listInput = input;

    return {
      items: [],
      page: input.page,
      pageSize: input.pageSize,
      total: 0,
    };
  }

  async listTagsByTarget(): Promise<TagDto[]> {
    return [];
  }

  async listTagsByTargets(): Promise<Map<string, TagDto[]>> {
    return new Map();
  }

  async listFilterOptions(input: TagFilterOptionsInput): Promise<TagDto[]> {
    this.filterOptionsInput = input;

    return this.filterOptions;
  }

  async replaceAssignments(): Promise<TagDto[]> {
    return [];
  }

  async merge(input: MergeTagsInput): Promise<MergeTagsResult | undefined> {
    this.mergeInput = input;

    return this.mergeResult;
  }

  async findActiveById(tagId: string): Promise<TagDto | undefined> {
    return this.items.get(tagId);
  }

  async findActiveByNormalizedName(
    spaceId: string,
    normalizedName: string,
  ): Promise<TagDto | undefined> {
    return [...this.items.values()].find(
      (tag) => tag.spaceId === spaceId && tag.normalizedName === normalizedName,
    );
  }

  async create(input: CreateTagInput): Promise<TagDto> {
    this.createInput = input;
    const tag = makeTag({
      id: input.id,
      colorKey: input.colorKey,
      name: input.name,
      normalizedName: input.normalizedName,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
    });

    this.items.set(tag.id, tag);

    return tag;
  }

  async softDeleteOrphan(
    input: SoftDeleteTagInput,
  ): Promise<SoftDeleteTagResult> {
    this.softDeleteInput = input;

    return this.deleteResult ?? { status: "not_found" };
  }
}

class FakeSpaceRepository {
  constructor(private readonly role: SpaceRole) {}

  async findAccessibleById(
    userId: string,
    spaceId: string,
  ): Promise<SpaceAccess | undefined> {
    if (userId !== ACTOR_ID || spaceId !== SPACE_ID) {
      return undefined;
    }

    return {
      role: this.role,
      space: makeSpace(),
    };
  }
}

function makeSpace(): Space {
  return {
    id: SPACE_ID,
    organizationId: ORGANIZATION_ID,
    name: "Delivery",
    code: "delivery",
    ownerId: ACTOR_ID,
    status: "ACTIVE",
    settings: {
      staleThresholdDays: 5,
    },
  };
}

function makeTag(input: Partial<TagDto> = {}): TagDto {
  const name = input.name ?? "Blocked";

  return {
    id: input.id ?? TAG_ID,
    organizationId: input.organizationId ?? ORGANIZATION_ID,
    spaceId: input.spaceId ?? SPACE_ID,
    name,
    displayName: input.displayName ?? `#${name}`,
    normalizedName: input.normalizedName ?? name.toLocaleLowerCase("en-US"),
    colorKey: input.colorKey ?? "blue",
    createdAt: input.createdAt ?? "2026-05-19T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-19T00:00:00.000Z",
    usageCount: input.usageCount,
    isOrphan: input.isOrphan,
  };
}
