import { HttpStatus } from "@nestjs/common";
import type { TagDto } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { TargetResolverService } from "../target/target-resolver.service";
import { TagAssignmentService } from "./tag-assignment.service";
import type { TagRepository } from "./tag.repository";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const TARGET_ID = "01H00000000000000000000003";
const TAG_ID = "01H00000000000000000000004";
const SECOND_TAG_ID = "01H00000000000000000000005";

describe("TagAssignmentService", () => {
  it("replaces assignments through object update permission and writes audit", async () => {
    const beforeTag = makeTag({ id: TAG_ID, name: "Before" });
    const afterTags = [
      makeTag({ id: TAG_ID, name: "Before" }),
      makeTag({ id: SECOND_TAG_ID, name: "After" }),
    ];
    const { audit, realtime, service, tags, targets } = createSubject({
      beforeTags: [beforeTag],
      replacedTags: afterTags,
    });

    await expect(
      service.replace(
        ACTOR_ID,
        {
          targetId: TARGET_ID,
          targetType: "WORK_ITEM",
          tagIds: [TAG_ID, SECOND_TAG_ID],
        },
        { requestId: "req-replace-tags" },
      ),
    ).resolves.toEqual({
      targetId: TARGET_ID,
      targetType: "WORK_ITEM",
      tags: afterTags,
    });

    expect(targets.resolve).toHaveBeenCalledWith(
      ACTOR_ID,
      "WORK_ITEM",
      TARGET_ID,
      expect.objectContaining({
        access: "write",
        audit: expect.objectContaining({
          operation: "replaceTagAssignments",
          requestId: "req-replace-tags",
        }),
        notFoundCode: "TAG_TARGET_INVALID",
        writePolicy: "objectUpdate",
      }),
    );
    expect(tags.listTagsByTarget).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      targetId: TARGET_ID,
      targetType: "WORK_ITEM",
    });
    expect(tags.listTagsByTarget.mock.invocationCallOrder[0]).toBeLessThan(
      tags.replaceAssignments.mock.invocationCallOrder[0],
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_ID,
        after: { tags: afterTags },
        before: { tags: [beforeTag] },
        metadata: {
          operation: "REPLACE_TAG_ASSIGNMENTS",
          tagIds: [TAG_ID, SECOND_TAG_ID],
          targetId: TARGET_ID,
          targetType: "WORK_ITEM",
        },
        organizationId: ORGANIZATION_ID,
        requestId: "req-replace-tags",
        spaceId: SPACE_ID,
        targetId: TARGET_ID,
        targetType: "WORK_ITEM",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TAG_CHANGED",
        target: { type: "WORK_ITEM", id: TARGET_ID },
        invalidates: expect.arrayContaining(["work-item-list", "version-board"]),
        hints: expect.objectContaining({
          changedFields: ["tagIds"],
          targetId: TARGET_ID,
          targetType: "WORK_ITEM",
        }),
      }),
    );
  });

  it("does not publish realtime events when assignment ids do not change", async () => {
    const beforeTags = [makeTag({ id: TAG_ID })];
    const { realtime, service } = createSubject({
      beforeTags,
      replacedTags: [makeTag({ id: TAG_ID })],
    });

    await service.replace(ACTOR_ID, {
      targetId: TARGET_ID,
      targetType: "WORK_ITEM",
      tagIds: [TAG_ID],
    });

    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it("does not swallow assignment replacement errors", async () => {
    const error = new Error("replace failed");
    const { audit, service, tags } = createSubject({
      replaceError: error,
    });

    await expect(
      service.replace(ACTOR_ID, {
        targetId: TARGET_ID,
        targetType: "WORK_ITEM",
        tagIds: [TAG_ID],
      }),
    ).rejects.toBe(error);
    expect(tags.replaceAssignments).toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("propagates target write denial before changing assignments", async () => {
    const { audit, service, tags, targets } = createSubject({
      resolveError: {
        code: "SPACE_ACCESS_DENIED",
        status: HttpStatus.FORBIDDEN,
      },
    });

    await expect(
      service.replace(ACTOR_ID, {
        targetId: TARGET_ID,
        targetType: "WORK_ITEM",
        tagIds: [TAG_ID],
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
      status: HttpStatus.FORBIDDEN,
    });
    expect(targets.resolve).toHaveBeenCalled();
    expect(tags.replaceAssignments).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

function createSubject(input: {
  beforeTags?: TagDto[];
  replacedTags?: TagDto[];
  replaceError?: Error;
  resolveError?: unknown;
}) {
  const tags = {
    listTagsByTarget: vi.fn(async () => input.beforeTags ?? []),
    replaceAssignments: vi.fn(async () => {
      if (input.replaceError) {
        throw input.replaceError;
      }

      return input.replacedTags ?? [];
    }),
  } as unknown as TagRepository & {
    listTagsByTarget: ReturnType<typeof vi.fn>;
    replaceAssignments: ReturnType<typeof vi.fn>;
  };
  const targets = {
    resolve: vi.fn(async () => {
      if (input.resolveError) {
        throw input.resolveError;
      }

      return {
        canWrite: true,
        organizationId: ORGANIZATION_ID,
        role: "PM",
        spaceId: SPACE_ID,
        targetId: TARGET_ID,
        targetType: "WORK_ITEM",
      };
    }),
  } as unknown as TargetResolverService & {
    resolve: ReturnType<typeof vi.fn>;
  };
  const audit = {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
  };
  const realtime = createRealtimePublisher();

  return {
    audit,
    realtime,
    service: new TagAssignmentService(tags, targets, audit, realtime),
    tags,
    targets,
  };
}

function createRealtimePublisher() {
  return {
    publish: vi.fn(),
  } as unknown as RealtimePublisherService & {
    publish: ReturnType<typeof vi.fn>;
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
