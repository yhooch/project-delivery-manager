import { Inject, Injectable } from "@nestjs/common";
import type {
  RequirementRelatedWorkItems,
  StatusCategory,
  WorkItemType,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { buildDocumentChunks } from "../document/document-content";
import { ObjectCodeAllocator } from "../object-code/object-code.allocator";
import {
  formatDisplayCode,
  parseObjectCode,
} from "../object-code/object-code.types";
import {
  findTaggedTargetIds,
  listTagsByTargets,
  replaceTagAssignmentsInTransaction,
} from "../tag/tag-assignment.helpers";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import {
  toRequirement,
  toRequirementRelatedWorkItems,
} from "./requirement.mappers";
import { assertTraceRefsMatchVersion } from "../trace/trace-version-policy";
import type { RequirementRepository } from "./requirement.repository";
import type {
  ArchiveRequirementInput,
  CreateRequirementDraftInput,
  DeleteRequirementDraftInput,
  RequirementListInput,
  SaveRequirementInput,
} from "./requirement.types";

const REQUIREMENT_DOCUMENT_KIND = "REQUIREMENT" as const;
const REQUIREMENT_TARGET_TYPE = "DOCUMENT" as const;
const REQUIREMENT_CODE_PREFIX = "REQ" as const;

type RequirementTenantScope = {
  id: string;
  organizationId: string;
  spaceId: string;
};

type RelatedRequirementWorkItemRecord = {
  assigneeId: string | null;
  createdAt: Date;
  id: string;
  organizationId: string;
  requirementId: string | null;
  sequence: number | null;
  spaceId: string;
  statusCategory: StatusCategory;
  title: string;
  type: WorkItemType;
  versionId: string | null;
};

type RequirementScopeFilter = {
  organizationId: string;
  requirementIds: string[];
  spaceId: string;
};

const relatedWorkItemSelect = {
  assigneeId: true,
  createdAt: true,
  id: true,
  organizationId: true,
  requirementId: true,
  sequence: true,
  spaceId: true,
  statusCategory: true,
  title: true,
  type: true,
  versionId: true,
} satisfies Prisma.WorkItemSelect;

@Injectable()
export class PrismaRequirementRepository implements RequirementRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ObjectCodeAllocator)
    private readonly objectCodeAllocator: ObjectCodeAllocator,
  ) {}

  async createDraft(input: CreateRequirementDraftInput) {
    const contentFormat = input.contentFormat ?? "TIPTAP_JSON";
    const result = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          kind: REQUIREMENT_DOCUMENT_KIND,
          title: "",
          contentFormat,
          contentJson: contentFormat === "TIPTAP_JSON" ? {} : Prisma.DbNull,
          contentMarkdown: contentFormat === "MARKDOWN" ? "" : null,
          contentText: "",
          sourceType: "USER_CREATED",
          status: "DRAFT",
          versionId: input.versionId,
          authorId: input.createdById,
          createdVia: "USER",
          lastEditedById: input.createdById,
          lastEditedVia: "USER",
          createdById: input.createdById,
          updatedById: input.createdById,
        },
      });

      await ensureParticipant(tx, {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: created.id,
        userId: input.createdById,
        relationType: "CREATOR",
        actorUserId: input.createdById,
      });

      await createRequirementRevision(tx, input.createdById, created, {
        changeType: "CREATED",
        metadata: { operation: "REQUIREMENT_DRAFT_CREATED" },
      });
      await replaceRequirementChunks(tx, created);

      const tags = await replaceTagAssignmentsInTransaction(tx, {
        assignedById: input.createdById,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        tagIds: input.tagIds,
        targetId: created.id,
        targetType: REQUIREMENT_TARGET_TYPE,
      });

      return { requirement: created, tags };
    });

    return toRequirement(result.requirement, [], undefined, result.tags);
  }

  async findById(requirementId: string) {
    const requirement = await this.prisma.client.document.findFirst({
      where: {
        deletedAt: null,
        id: requirementId,
        kind: REQUIREMENT_DOCUMENT_KIND,
      },
    });

    if (!requirement) {
      return undefined;
    }

    const [attachments, relatedWorkItems, tagsByRequirementId] =
      await Promise.all([
        this.listAttachmentRefsForRequirement(requirement),
        this.listRelatedWorkItemsForRequirement(requirement),
        listTagsByTargets(this.prisma.client, {
          organizationId: requirement.organizationId,
          spaceId: requirement.spaceId,
          targetIds: [requirement.id],
          targetType: REQUIREMENT_TARGET_TYPE,
        }),
      ]);

    return toRequirement(
      requirement,
      attachments,
      relatedWorkItems,
      tagsByRequirementId.get(requirement.id) ?? [],
    );
  }

  async isParticipant(spaceId: string, requirementId: string, userId: string) {
    const participant = await this.prisma.client.objectParticipant.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetId: requirementId,
        targetType: REQUIREMENT_TARGET_TYPE,
        userId,
      },
    });

    return Boolean(participant);
  }

  async listBySpaceId(spaceId: string, input: RequirementListInput) {
    const where = buildListWhere(spaceId, input);
    const countInput: RequirementListInput = {
      ...input,
      includeDrafts: true,
      status: undefined,
    };
    const participantIds =
      shouldLoadParticipantIds(input) || shouldLoadParticipantIds(countInput)
        ? await this.listParticipantRequirementIds(spaceId, input.actorUserId)
        : [];
    const countWhere = buildListWhere(spaceId, countInput);
    const taggedTargetIds = await findTaggedTargetIds(this.prisma.client, {
      spaceId,
      tagIds: input.tagIds,
      tagMatch: input.tagMatch,
      targetType: REQUIREMENT_TARGET_TYPE,
    });

    applyVisibility(where, input, participantIds);
    applyVisibility(countWhere, countInput, participantIds);
    applyTaggedTargetIds(where, taggedTargetIds);
    applyTaggedTargetIds(countWhere, taggedTargetIds);
    const statusGroups = isKnownEmptyIdFilter(countWhere.id)
      ? []
      : await this.prisma.client.document.groupBy({
          by: ["status"],
          _count: {
            _all: true,
          },
          where: countWhere,
        });

    if (isKnownEmptyIdFilter(where.id)) {
      return {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        statusCounts: statusGroups.map((group) => ({
          count: group._count._all,
          status: toDocumentRequirementStatus(group.status),
        })),
        total: 0,
      };
    }

    const [requirements, total] = await this.prisma.client.$transaction([
      this.prisma.client.document.findMany({
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.document.count({
        where,
      }),
    ]);
    const [
      attachmentsByRequirementId,
      relatedWorkItemsByRequirementId,
      tagsByRequirementId,
    ] = await Promise.all([
      this.listAttachmentRefsByRequirements(requirements),
      this.listRelatedWorkItemsByRequirements(requirements),
      listTagsByTargets(this.prisma.client, {
        organizationId: requirements[0]?.organizationId ?? "",
        spaceId,
        targetIds: requirements.map((requirement) => requirement.id),
        targetType: REQUIREMENT_TARGET_TYPE,
      }),
    ]);

    return {
      items: requirements.map((requirement) =>
        toRequirement(
          requirement,
          attachmentsByRequirementId.get(requirement.id) ?? [],
          relatedWorkItemsByRequirementId.get(requirement.id),
          tagsByRequirementId.get(requirement.id) ?? [],
        ),
      ),
      page: input.page,
      pageSize: input.pageSize,
      statusCounts: statusGroups.map((group) => ({
        count: group._count._all,
        status: toDocumentRequirementStatus(group.status),
      })),
      total,
    };
  }

  async countVersionCascadeImpact(input: {
    requirementId: string;
    nextVersionId: string | null;
  }) {
    const requirement = await this.prisma.client.document.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        id: input.requirementId,
        kind: REQUIREMENT_DOCUMENT_KIND,
      },
    });

    if (!requirement) {
      return emptyVersionCascadeImpact();
    }

    const intakeItems = await this.prisma.client.intakeItem.findMany({
      select: {
        id: true,
        versionId: true,
      },
      where: {
        deletedAt: null,
        requirementId: input.requirementId,
      },
    });
    const intakeItemIds = intakeItems.map((item) => item.id);
    const directWorkItems = await this.prisma.client.workItem.findMany({
      select: {
        id: true,
        type: true,
        versionId: true,
      },
      where: {
        deletedAt: null,
        OR: [
          { requirementId: input.requirementId },
          intakeItemIds.length > 0
            ? { intakeItemId: { in: intakeItemIds } }
            : undefined,
        ].filter(Boolean) as Prisma.WorkItemWhereInput[],
      },
    });
    const taskIds = directWorkItems
      .filter((item) => item.type === "TASK")
      .map((item) => item.id);
    const relatedBugs =
      taskIds.length > 0
        ? await this.prisma.client.workItem.findMany({
            select: {
              id: true,
              versionId: true,
            },
            where: {
              bugDetail: {
                is: {
                  deletedAt: null,
                  relatedTaskId: {
                    in: taskIds,
                  },
                },
              },
              deletedAt: null,
              type: "BUG",
            },
          })
        : [];
    const changedWorkItemIds = new Set(
      directWorkItems
        .filter((item) => item.versionId !== input.nextVersionId)
        .map((item) => item.id),
    );
    const changedRelatedBugIds = relatedBugs
      .filter((bug) => bug.versionId !== input.nextVersionId)
      .map((bug) => bug.id);

    for (const bugId of changedRelatedBugIds) {
      changedWorkItemIds.add(bugId);
    }

    return {
      bugCount: directWorkItems.filter(
        (item) => item.type === "BUG" && item.versionId !== input.nextVersionId,
      ).length,
      bugIds: directWorkItems
        .filter(
          (item) =>
            item.type === "BUG" && item.versionId !== input.nextVersionId,
        )
        .map((item) => item.id),
      intakeItemCount: intakeItems.filter(
        (item) => item.versionId !== input.nextVersionId,
      ).length,
      intakeItemIds: intakeItems
        .filter((item) => item.versionId !== input.nextVersionId)
        .map((item) => item.id),
      relatedBugCount: changedRelatedBugIds.length,
      relatedBugIds: changedRelatedBugIds,
      workItemCount: changedWorkItemIds.size,
      workItemIds: [...changedWorkItemIds],
    };
  }

  async save(input: SaveRequirementInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const previous = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
          kind: REQUIREMENT_DOCUMENT_KIND,
        },
      });

      if (!previous) {
        return undefined;
      }

      const assignedSequence =
        previous.sequence == null
          ? await this.objectCodeAllocator.allocateOne(tx, {
              actorUserId: input.updatedById,
              objectType: "REQUIREMENT",
              organizationId: previous.organizationId,
              spaceId: previous.spaceId,
            })
          : previous.sequence;
      const result = await tx.document.updateMany({
        data: {
          title: input.title,
          summary: input.summary,
          contentFormat: input.contentFormat,
          contentJson:
            input.contentFormat === "TIPTAP_JSON"
              ? (input.contentJson as Prisma.InputJsonValue)
              : Prisma.DbNull,
          contentMarkdown:
            input.contentFormat === "MARKDOWN" ? input.contentMarkdown : null,
          contentText: input.contentText,
          contentMarkdownCache:
            input.contentFormat === "TIPTAP_JSON"
              ? (input.contentMarkdownCache ?? null)
              : null,
          versionId: input.versionId,
          priority: input.priority,
          ownerId: input.shouldUpdateOwner ? input.ownerId : undefined,
          archivedAt: null,
          status: "ACTIVE",
          sequence: assignedSequence,
          lastEditedAt: new Date(),
          lastEditedById: input.updatedById,
          lastEditedVia: "USER",
          revision: previous.revision + 1,
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.requirementId,
          kind: REQUIREMENT_DOCUMENT_KIND,
          revision: input.baseRevision,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const requirement = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
          kind: REQUIREMENT_DOCUMENT_KIND,
        },
      });

      if (!requirement) {
        return undefined;
      }

      if (previous.sequence == null) {
        await ensureRequirementCodeHistory(tx, {
          actorUserId: input.updatedById,
          requirement,
        });
      }
      await createRequirementRevision(tx, input.updatedById, requirement, {
        changeType: "CONTENT_EDITED",
        metadata: {
          operation: "REQUIREMENT_SAVED",
          previousStatus: previous.status,
        },
      });
      await replaceRequirementChunks(tx, requirement);

      if (
        input.cascadeVersionChange === true &&
        input.versionId !== undefined &&
        previous.versionId !== input.versionId
      ) {
        await cascadeRequirementTraceVersion(tx, {
          actorUserId: input.updatedById,
          nextVersionId: input.versionId,
          requirementId: input.requirementId,
        });
      }

      const ownerChanged =
        input.shouldUpdateOwner && previous.ownerId !== requirement.ownerId;

      if (ownerChanged && input.ownerId) {
        await tx.objectParticipant.updateMany({
          data: {
            deletedAt: new Date(),
            updatedById: input.updatedById,
          },
          where: {
            deletedAt: null,
            relationType: "ASSIGNEE",
            spaceId: requirement.spaceId,
            targetId: requirement.id,
            targetType: REQUIREMENT_TARGET_TYPE,
            userId: {
              not: input.ownerId,
            },
          },
        });
        await ensureParticipant(tx, {
          organizationId: previous.organizationId,
          spaceId: previous.spaceId,
          targetId: requirement.id,
          userId: input.ownerId,
          relationType: "ASSIGNEE",
          actorUserId: input.updatedById,
        });
      }

      if (ownerChanged) {
        await createTimelineEvent(tx, {
          actorUserId: input.updatedById,
          after: {
            ownerId: requirement.ownerId ?? null,
          },
          before: {
            ownerId: previous.ownerId ?? null,
          },
          eventType: "ASSIGNEE_CHANGED",
          organizationId: requirement.organizationId,
          spaceId: requirement.spaceId,
          targetId: requirement.id,
          title: "负责人变更",
        });
      }

      await createTimelineEvent(tx, {
        actorUserId: input.updatedById,
        after: requirementTimelineSnapshot(requirement),
        before: requirementTimelineSnapshot(previous),
        eventType: "UPDATED",
        organizationId: requirement.organizationId,
        spaceId: requirement.spaceId,
        targetId: requirement.id,
        title: "保存需求",
      });

      return requirement;
    });

    if (!updated) {
      return undefined;
    }

    const [attachments, relatedWorkItems, tagsByRequirementId] =
      await Promise.all([
        this.listAttachmentRefsForRequirement(updated),
        this.listRelatedWorkItemsForRequirement(updated),
        listTagsByTargets(this.prisma.client, {
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          targetIds: [updated.id],
          targetType: REQUIREMENT_TARGET_TYPE,
        }),
      ]);

    return toRequirement(
      updated,
      attachments,
      relatedWorkItems,
      tagsByRequirementId.get(updated.id) ?? [],
    );
  }

  async archive(input: ArchiveRequirementInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const previous = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
          kind: REQUIREMENT_DOCUMENT_KIND,
        },
      });

      if (!previous) {
        return undefined;
      }

      const now = new Date();
      const result = await tx.document.updateMany({
        data: {
          archivedAt: now,
          lastEditedAt: now,
          lastEditedById: input.updatedById,
          lastEditedVia: "USER",
          status: "ARCHIVED",
          revision: previous.revision + 1,
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.requirementId,
          kind: REQUIREMENT_DOCUMENT_KIND,
          revision: input.baseRevision,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const requirement = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
          kind: REQUIREMENT_DOCUMENT_KIND,
        },
      });

      if (!requirement) {
        return undefined;
      }

      await createRequirementRevision(tx, input.updatedById, requirement, {
        changeType: "ARCHIVED",
        metadata: { operation: "REQUIREMENT_ARCHIVED" },
      });
      await replaceRequirementChunks(tx, requirement);

      await createTimelineEvent(tx, {
        actorUserId: input.updatedById,
        after: {
          status: requirement.status,
        },
        before: {
          status: previous.status,
        },
        eventType: "STATUS_CHANGED",
        organizationId: requirement.organizationId,
        spaceId: requirement.spaceId,
        targetId: requirement.id,
        title: "归档需求",
      });

      return requirement;
    });

    if (!updated) {
      return undefined;
    }

    const [attachments, relatedWorkItems, tagsByRequirementId] =
      await Promise.all([
        this.listAttachmentRefsForRequirement(updated),
        this.listRelatedWorkItemsForRequirement(updated),
        listTagsByTargets(this.prisma.client, {
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          targetIds: [updated.id],
          targetType: REQUIREMENT_TARGET_TYPE,
        }),
      ]);

    return toRequirement(
      updated,
      attachments,
      relatedWorkItems,
      tagsByRequirementId.get(updated.id) ?? [],
    );
  }

  async deleteDraft(input: DeleteRequirementDraftInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const previous = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
          kind: REQUIREMENT_DOCUMENT_KIND,
          status: "DRAFT",
        },
      });

      if (!previous) {
        return false;
      }

      const now = new Date();
      const result = await tx.document.updateMany({
        data: {
          deletedAt: now,
          lastEditedAt: now,
          lastEditedById: input.deletedById,
          lastEditedVia: "USER",
          revision: previous.revision + 1,
          updatedById: input.deletedById,
        },
        where: {
          deletedAt: null,
          id: input.requirementId,
          kind: REQUIREMENT_DOCUMENT_KIND,
          status: "DRAFT",
        },
      });

      if (result.count === 0) {
        return false;
      }

      const deleted = {
        ...previous,
        deletedAt: now,
        lastEditedAt: now,
        lastEditedById: input.deletedById,
        revision: previous.revision + 1,
        updatedById: input.deletedById,
      };
      await createRequirementRevision(tx, input.deletedById, deleted, {
        changeType: "DELETED",
        metadata: { operation: "REQUIREMENT_DRAFT_DELETED" },
      });
      await replaceRequirementChunks(tx, deleted);

      await tx.objectParticipant.updateMany({
        data: {
          deletedAt: now,
          updatedById: input.deletedById,
        },
        where: {
          deletedAt: null,
          targetId: input.requirementId,
          targetType: REQUIREMENT_TARGET_TYPE,
        },
      });

      await tx.tagAssignment.updateMany({
        data: {
          deletedAt: now,
        },
        where: {
          deletedAt: null,
          targetId: input.requirementId,
          targetType: REQUIREMENT_TARGET_TYPE,
        },
      });

      return true;
    });
  }

  private async listAttachmentRefsForRequirement(
    requirement: RequirementTenantScope,
  ) {
    const records = await this.prisma.client.attachment.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        organizationId: requirement.organizationId,
        spaceId: requirement.spaceId,
        targetId: requirement.id,
        targetType: REQUIREMENT_TARGET_TYPE,
      },
    });

    return records;
  }

  private async listAttachmentRefsByRequirements(
    requirements: RequirementTenantScope[],
  ) {
    const result = new Map<
      string,
      Awaited<ReturnType<typeof this.listAttachmentRefsForRequirement>>
    >();

    if (requirements.length === 0) {
      return result;
    }

    const records = await this.prisma.client.attachment.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        OR: requirements.map((requirement) => ({
          organizationId: requirement.organizationId,
          spaceId: requirement.spaceId,
          targetId: requirement.id,
        })),
        targetType: REQUIREMENT_TARGET_TYPE,
      },
    });

    for (const record of records) {
      const current = result.get(record.targetId) ?? [];
      current.push(record);
      result.set(record.targetId, current);
    }

    return result;
  }

  private async listRelatedWorkItemsForRequirement(
    requirement: RequirementTenantScope,
  ) {
    const result = await this.listRelatedWorkItemsByRequirements([requirement]);

    return result.get(requirement.id);
  }

  private async listRelatedWorkItemsByRequirements(
    requirements: RequirementTenantScope[],
  ) {
    const result = new Map<string, RequirementRelatedWorkItems>();

    if (requirements.length === 0) {
      return result;
    }

    const scopeFilters = buildRequirementScopeFilters(requirements);
    const records = await this.prisma.client.workItem.findMany({
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      select: relatedWorkItemSelect,
      where: {
        deletedAt: null,
        OR: scopeFilters.map((scope) => ({
          organizationId: scope.organizationId,
          requirementId: {
            in: scope.requirementIds,
          },
          spaceId: scope.spaceId,
        })),
      },
    });
    const grouped = new Map<string, RelatedRequirementWorkItemRecord[]>();
    const groupedIds = new Map<string, Set<string>>();
    const requirementIdsByScope = new Map(
      requirements.map((requirement) => [
        requirementScopeKey(
          requirement.organizationId,
          requirement.spaceId,
          requirement.id,
        ),
        requirement.id,
      ]),
    );
    const taskScopesById = new Map<
      string,
      { organizationId: string; requirementId: string; spaceId: string }
    >();

    for (const record of records) {
      if (record.requirementId) {
        addRelatedWorkItemToGroup({
          grouped,
          groupedIds,
          record,
          requirementId: record.requirementId,
          requirementIdsByScope,
          scope: {
            organizationId: record.organizationId,
            spaceId: record.spaceId,
          },
        });

        if (record.type === "TASK") {
          taskScopesById.set(record.id, {
            organizationId: record.organizationId,
            requirementId: record.requirementId,
            spaceId: record.spaceId,
          });
        }
      }
    }

    const relatedBugDetails =
      taskScopesById.size > 0
        ? await this.prisma.client.bugDetail.findMany({
            select: {
              relatedTaskId: true,
              workItem: {
                select: relatedWorkItemSelect,
              },
            },
            where: {
              deletedAt: null,
              relatedTaskId: {
                in: [...taskScopesById.keys()],
              },
              workItem: {
                deletedAt: null,
                type: "BUG",
              },
            },
          })
        : [];

    for (const detail of relatedBugDetails) {
      const relatedTaskId = detail.relatedTaskId;

      if (!relatedTaskId) {
        continue;
      }

      const taskScope = taskScopesById.get(relatedTaskId);

      if (
        !taskScope ||
        detail.workItem.organizationId !== taskScope.organizationId ||
        detail.workItem.spaceId !== taskScope.spaceId
      ) {
        continue;
      }

      addRelatedWorkItemToGroup({
        grouped,
        groupedIds,
        record: detail.workItem,
        requirementId: taskScope.requirementId,
        requirementIdsByScope,
        scope: {
          organizationId: taskScope.organizationId,
          spaceId: taskScope.spaceId,
        },
      });
    }

    for (const [requirementId, items] of grouped) {
      items.sort(compareRelatedWorkItems);
      result.set(requirementId, toRequirementRelatedWorkItems(items));
    }

    return result;
  }

  private async listParticipantRequirementIds(spaceId: string, userId: string) {
    const participants = await this.prisma.client.objectParticipant.findMany({
      distinct: ["targetId"],
      select: {
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetType: REQUIREMENT_TARGET_TYPE,
        userId,
      },
    });

    return participants.map((participant) => participant.targetId);
  }

}

function buildListWhere(
  spaceId: string,
  input: RequirementListInput,
): Prisma.DocumentWhereInput {
  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    kind: REQUIREMENT_DOCUMENT_KIND,
    ownerId: input.ownerId,
    spaceId,
    versionId: input.versionId,
  };

  if (input.status) {
    where.status = toStoredRequirementStatus(input.status);
    applyListQuery(where, input.query);
    return where;
  }

  if (!input.includeDrafts) {
    where.status = {
      not: "DRAFT",
    };
  }

  applyListQuery(where, input.query);

  return where;
}

function applyListQuery(
  where: Prisma.DocumentWhereInput,
  query: string | undefined,
) {
  const trimmed = query?.trim();

  if (!trimmed) {
    return;
  }

  const parsed = parseObjectCode(trimmed);

  if (parsed) {
    where.AND = [
      ...toArray(where.AND),
      parsed.objectType === "REQUIREMENT"
        ? { sequence: parsed.sequence }
        : { id: { in: [] } },
    ];
    return;
  }

  where.AND = [
    ...toArray(where.AND),
    {
      OR: [
        { title: { contains: trimmed, mode: "insensitive" } },
        { summary: { contains: trimmed, mode: "insensitive" } },
        { contentText: { contains: trimmed, mode: "insensitive" } },
      ],
    },
  ];
}

function applyVisibility(
  where: Prisma.DocumentWhereInput,
  input: RequirementListInput,
  participantIds: string[],
) {
  if (input.visibility === "ALL") {
    return;
  }

  if (input.visibility === "PARTICIPANT") {
    where.id = {
      in: participantIds,
    };
    return;
  }

  where.AND = [
    ...toArray(where.AND),
    {
      OR: [
        {
          status: {
            not: "DRAFT",
          },
        },
        {
          id: {
            in: participantIds,
          },
        },
      ],
    },
  ];
}

function applyTaggedTargetIds(
  where: Prisma.DocumentWhereInput,
  targetIds: string[] | undefined,
) {
  if (!targetIds) {
    return;
  }

  where.AND = [
    ...toArray(where.AND),
    {
      id: {
        in: targetIds,
      },
    },
  ];
}

function shouldLoadParticipantIds(input: RequirementListInput): boolean {
  return (
    input.visibility !== "ALL" ||
    input.status === "DRAFT" ||
    input.includeDrafts === true
  );
}

function toStoredRequirementStatus(
  status: NonNullable<RequirementListInput["status"]>,
): "DRAFT" | "ACTIVE" | "ARCHIVED" {
  return status === "CONFIRMED" ? "ACTIVE" : status;
}

function toDocumentRequirementStatus(
  status: "DRAFT" | "ACTIVE" | "CONFIRMED" | "ARCHIVED",
): "DRAFT" | "ACTIVE" | "ARCHIVED" {
  return status === "CONFIRMED" ? "ACTIVE" : status;
}

function isKnownEmptyIdFilter(
  value: Prisma.DocumentWhereInput["id"],
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "in" in value &&
    Array.isArray(value.in) &&
    value.in.length === 0
  );
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function buildRequirementScopeFilters(
  requirements: RequirementTenantScope[],
): RequirementScopeFilter[] {
  const grouped = new Map<
    string,
    { organizationId: string; requirementIds: Set<string>; spaceId: string }
  >();

  for (const requirement of requirements) {
    const scopeKey = `${requirement.organizationId}:${requirement.spaceId}`;
    const current = grouped.get(scopeKey) ?? {
      organizationId: requirement.organizationId,
      requirementIds: new Set<string>(),
      spaceId: requirement.spaceId,
    };

    current.requirementIds.add(requirement.id);
    grouped.set(scopeKey, current);
  }

  return [...grouped.values()].map((scope) => ({
    organizationId: scope.organizationId,
    requirementIds: [...scope.requirementIds],
    spaceId: scope.spaceId,
  }));
}

function compareRelatedWorkItems(
  first: RelatedRequirementWorkItemRecord,
  second: RelatedRequirementWorkItemRecord,
) {
  const typeOrder = { TASK: 0, BUG: 1 } satisfies Record<WorkItemType, number>;
  const typeDelta = typeOrder[first.type] - typeOrder[second.type];

  if (typeDelta !== 0) {
    return typeDelta;
  }

  const createdAtDelta = first.createdAt.getTime() - second.createdAt.getTime();

  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return first.id.localeCompare(second.id);
}

function addRelatedWorkItemToGroup<T extends { id: string }>(input: {
  grouped: Map<string, T[]>;
  groupedIds: Map<string, Set<string>>;
  record: T;
  requirementId: string;
  requirementIdsByScope: Map<string, string>;
  scope: {
    organizationId: string;
    spaceId: string;
  };
}) {
  const requirementId = input.requirementIdsByScope.get(
    requirementScopeKey(
      input.scope.organizationId,
      input.scope.spaceId,
      input.requirementId,
    ),
  );

  if (!requirementId) {
    return;
  }

  const currentIds = input.groupedIds.get(requirementId) ?? new Set<string>();

  if (currentIds.has(input.record.id)) {
    return;
  }

  currentIds.add(input.record.id);
  input.groupedIds.set(requirementId, currentIds);

  const current = input.grouped.get(requirementId) ?? [];
  current.push(input.record);
  input.grouped.set(requirementId, current);
}

function requirementScopeKey(
  organizationId: string,
  spaceId: string,
  requirementId: string,
): string {
  return `${organizationId}:${spaceId}:${requirementId}`;
}

type RequirementTimelineRecord = {
  contentText: string | null;
  ownerId: string | null;
  priority: string | null;
  revision?: number;
  status: string;
  summary: string | null;
  title: string;
  versionId: string | null;
};

type RequirementDocumentRevisionRecord = RequirementTimelineRecord & {
  contentFormat: "TIPTAP_JSON" | "MARKDOWN";
  contentJson: unknown;
  contentMarkdown: string | null;
  contentMarkdownCache: string | null;
  id: string;
  kind: "GENERAL" | "REQUIREMENT";
  organizationId: string;
  sequence: number | null;
  spaceId: string;
};

function requirementTimelineSnapshot(record: RequirementTimelineRecord) {
  return {
    contentText: record.contentText ?? null,
    ownerId: record.ownerId ?? null,
    priority: record.priority ?? null,
    status: record.status,
    summary: record.summary ?? null,
    title: record.title,
    versionId: record.versionId ?? null,
  };
}

async function createTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    after?: Record<string, unknown>;
    before?: Record<string, unknown>;
    eventType: "ASSIGNEE_CHANGED" | "CREATED" | "STATUS_CHANGED" | "UPDATED";
    organizationId: string;
    spaceId: string;
    targetId: string;
    title: string;
  },
) {
  await createTimelineEventRecord(tx, {
    ...input,
    metadata: {
      targetKind: REQUIREMENT_DOCUMENT_KIND,
    },
    targetType: REQUIREMENT_TARGET_TYPE,
  });
}

async function createRequirementRevision(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  requirement: RequirementDocumentRevisionRecord,
  input: {
    changeType: Prisma.DocumentRevisionCreateInput["changeType"];
    metadata?: Record<string, unknown>;
  },
) {
  await tx.documentRevision.create({
    data: {
      id: ulid(),
      organizationId: requirement.organizationId,
      spaceId: requirement.spaceId,
      documentId: requirement.id,
      revision: requirement.revision ?? 1,
      kind: requirement.kind,
      title: requirement.title,
      summary: requirement.summary,
      contentFormat: requirement.contentFormat,
      contentJson:
        requirement.contentFormat === "TIPTAP_JSON"
          ? toInputJson(requirement.contentJson)
          : Prisma.DbNull,
      contentMarkdown:
        requirement.contentFormat === "MARKDOWN"
          ? (requirement.contentMarkdown ?? "")
          : null,
      contentMarkdownCache:
        requirement.contentFormat === "TIPTAP_JSON"
          ? requirement.contentMarkdownCache
          : null,
      contentText: requirement.contentText ?? "",
      changeType: input.changeType,
      actorType: "USER",
      actorUserId,
      metadata: toInputJson({
        targetKind: REQUIREMENT_DOCUMENT_KIND,
        ...(input.metadata ?? {}),
      }),
    },
  });
}

async function replaceRequirementChunks(
  tx: Prisma.TransactionClient,
  requirement: RequirementDocumentRevisionRecord,
) {
  const revision = requirement.revision ?? 1;
  const chunks = buildDocumentChunks(requirementChunkSource(requirement));

  await tx.documentChunk.deleteMany({
    where: {
      documentId: requirement.id,
      revision,
    },
  });

  if (chunks.length === 0) {
    return;
  }

  await tx.documentChunk.createMany({
    data: chunks.map((chunk) => ({
      id: ulid(),
      organizationId: requirement.organizationId,
      spaceId: requirement.spaceId,
      documentId: requirement.id,
      revision,
      ordinal: chunk.ordinal,
      headingPath: chunk.headingPath,
      contentText: chunk.contentText,
    })),
  });
}

async function ensureRequirementCodeHistory(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    requirement: RequirementDocumentRevisionRecord;
  },
) {
  const sequence = input.requirement.sequence;

  if (sequence == null) {
    return;
  }

  await tx.documentCodeHistory.createMany({
    data: [
      {
        id: ulid(),
        organizationId: input.requirement.organizationId,
        spaceId: input.requirement.spaceId,
        documentId: input.requirement.id,
        kind: REQUIREMENT_DOCUMENT_KIND,
        codePrefix: REQUIREMENT_CODE_PREFIX,
        sequence,
        displayCode: formatDisplayCode("REQUIREMENT", sequence),
        codeStatus: "ASSIGNED",
        changedById: input.actorUserId,
      },
    ],
    skipDuplicates: true,
  });
}

function requirementChunkSource(
  requirement: RequirementDocumentRevisionRecord,
) {
  if (requirement.contentFormat === "MARKDOWN") {
    return requirement.contentMarkdown ?? requirement.contentText ?? "";
  }

  return requirement.contentMarkdownCache ?? requirement.contentText ?? "";
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value === null || value === undefined
    ? {}
    : (value as Prisma.InputJsonValue);
}

async function cascadeRequirementTraceVersion(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    nextVersionId: string | null;
    requirementId: string;
  },
) {
  const intakeItems = await tx.intakeItem.findMany({
    select: {
      id: true,
      organizationId: true,
      spaceId: true,
      versionId: true,
    },
    where: {
      deletedAt: null,
      requirementId: input.requirementId,
    },
  });
  const intakeItemIds = intakeItems.map((item) => item.id);
  const directWorkItems = await tx.workItem.findMany({
    select: {
      id: true,
      type: true,
    },
    where: {
      deletedAt: null,
      OR: [
        { requirementId: input.requirementId },
        intakeItemIds.length > 0
          ? { intakeItemId: { in: intakeItemIds } }
          : undefined,
      ].filter(Boolean) as Prisma.WorkItemWhereInput[],
    },
  });
  const taskIds = directWorkItems
    .filter((item) => item.type === "TASK")
    .map((item) => item.id);
  const relatedBugs =
    taskIds.length > 0
      ? await tx.bugDetail.findMany({
          select: { workItemId: true },
          where: {
            deletedAt: null,
            relatedTaskId: {
              in: taskIds,
            },
            workItem: {
              deletedAt: null,
              type: "BUG",
            },
          },
        })
      : [];
  const workItemIds = [
    ...new Set([
      ...directWorkItems.map((item) => item.id),
      ...relatedBugs.map((bug) => bug.workItemId),
    ]),
  ];
  const affectedIntakeItems = intakeItems.filter(
    (item) => item.versionId !== input.nextVersionId,
  );
  const affectedWorkItems =
    workItemIds.length > 0
      ? (
          await tx.workItem.findMany({
            select: {
              id: true,
              organizationId: true,
              spaceId: true,
              type: true,
              versionId: true,
            },
            where: {
              deletedAt: null,
              id: {
                in: workItemIds,
              },
            },
          })
        ).filter((item) => item.versionId !== input.nextVersionId)
      : [];

  await assertNoRequirementCascadeConflicts(tx, {
    intakeItemIds,
    nextVersionId: input.nextVersionId,
    requirementId: input.requirementId,
    taskIds,
    workItemIds,
  });

  if (affectedIntakeItems.length > 0) {
    await tx.intakeItem.updateMany({
      data: {
        updatedById: input.actorUserId,
        versionId: input.nextVersionId,
      },
      where: {
        deletedAt: null,
        id: {
          in: affectedIntakeItems.map((item) => item.id),
        },
      },
    });

    for (const item of affectedIntakeItems) {
      await createTraceVersionCascadeTimelineEvent(tx, {
        actorUserId: input.actorUserId,
        beforeVersionId: item.versionId,
        nextVersionId: input.nextVersionId,
        organizationId: item.organizationId,
        sourceTargetId: input.requirementId,
        sourceTargetKind: REQUIREMENT_DOCUMENT_KIND,
        sourceTargetType: REQUIREMENT_TARGET_TYPE,
        spaceId: item.spaceId,
        targetId: item.id,
        targetType: "INTAKE_ITEM",
      });
    }
  }

  if (affectedWorkItems.length > 0) {
    await tx.workItem.updateMany({
      data: {
        updatedById: input.actorUserId,
        versionId: input.nextVersionId,
      },
      where: {
        deletedAt: null,
        id: {
          in: affectedWorkItems.map((item) => item.id),
        },
      },
    });

    for (const item of affectedWorkItems) {
      await createTraceVersionCascadeTimelineEvent(tx, {
        actorUserId: input.actorUserId,
        beforeVersionId: item.versionId,
        nextVersionId: input.nextVersionId,
        organizationId: item.organizationId,
        sourceTargetId: input.requirementId,
        sourceTargetKind: REQUIREMENT_DOCUMENT_KIND,
        sourceTargetType: REQUIREMENT_TARGET_TYPE,
        spaceId: item.spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
        targetWorkItemType: item.type,
      });
    }
  }

  if (workItemIds.length > 0) {
    await syncWorkItemRelatedParticipants(tx, {
      actorUserId: input.actorUserId,
      workItemIds,
    });
  }
}

async function createTraceVersionCascadeTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    beforeVersionId: string | null;
    nextVersionId: string | null;
    organizationId: string;
    sourceTargetId: string;
    sourceTargetKind?: "REQUIREMENT";
    sourceTargetType: "DOCUMENT" | "INTAKE_ITEM";
    spaceId: string;
    targetId: string;
    targetType: "INTAKE_ITEM" | "WORK_ITEM";
    targetWorkItemType?: WorkItemType;
  },
) {
  await createTimelineEventRecord(tx, {
    actorUserId: input.actorUserId,
    after: { versionId: input.nextVersionId },
    before: { versionId: input.beforeVersionId },
    eventType: "UPDATED",
    metadata: {
      operation: "TRACE_VERSION_CASCADE",
      sourceTargetId: input.sourceTargetId,
      ...(input.sourceTargetKind
        ? { sourceTargetKind: input.sourceTargetKind }
        : {}),
      sourceTargetType: input.sourceTargetType,
    },
    organizationId: input.organizationId,
    spaceId: input.spaceId,
    targetId: input.targetId,
    targetType: input.targetType,
    targetWorkItemType: input.targetWorkItemType,
    title: "级联更新版本",
  });
}

async function assertNoRequirementCascadeConflicts(
  tx: Prisma.TransactionClient,
  input: {
    intakeItemIds: string[];
    nextVersionId: string | null;
    requirementId: string;
    taskIds: string[];
    workItemIds: string[];
  },
) {
  if (input.workItemIds.length === 0) {
    return;
  }

  const affectedItems = await tx.workItem.findMany({
    select: {
      bugDetail: {
        select: {
          relatedTask: {
            select: { versionId: true },
          },
          relatedTaskId: true,
        },
      },
      id: true,
      intakeItem: {
        select: { versionId: true },
      },
      intakeItemId: true,
      requirementId: true,
    },
    where: {
      deletedAt: null,
      id: {
        in: input.workItemIds,
      },
    },
  });
  const requirementVersionsById = new Map(
    (
      await tx.document.findMany({
        select: {
          id: true,
          versionId: true,
        },
        where: {
          deletedAt: null,
          id: {
            in: uniqueIds(affectedItems.map((item) => item.requirementId)),
          },
          kind: REQUIREMENT_DOCUMENT_KIND,
        },
      })
    ).map((requirement) => [requirement.id, requirement.versionId]),
  );

  for (const item of affectedItems) {
    assertTraceRefsMatchVersion({
      details: {
        workItemId: item.id,
      },
      refs: [
        {
          label: "requirement",
          versionId:
            item.requirementId === input.requirementId
              ? input.nextVersionId
              : item.requirementId
                ? requirementVersionsById.get(item.requirementId)
                : undefined,
        },
        {
          label: "intakeItem",
          versionId:
            item.intakeItemId && input.intakeItemIds.includes(item.intakeItemId)
              ? input.nextVersionId
              : item.intakeItem?.versionId,
        },
        {
          label: "relatedTask",
          versionId:
            item.bugDetail?.relatedTaskId &&
            input.taskIds.includes(item.bugDetail.relatedTaskId)
              ? input.nextVersionId
              : item.bugDetail?.relatedTask?.versionId,
        },
      ],
      versionId: input.nextVersionId,
    });
  }
}

async function syncWorkItemRelatedParticipants(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    workItemIds: string[];
  },
) {
  const workItemIds = uniqueIds(input.workItemIds);

  if (workItemIds.length === 0) {
    return;
  }

  const workItems = await tx.workItem.findMany({
    select: {
      bugDetail: {
        select: {
          deletedAt: true,
          relatedTask: {
            select: {
              assigneeId: true,
              createdById: true,
              deletedAt: true,
              reporterId: true,
            },
          },
        },
      },
      id: true,
      intakeItem: {
        select: {
          assigneeId: true,
          reporterId: true,
        },
      },
      organizationId: true,
      requirementId: true,
      spaceId: true,
      version: {
        select: {
          ownerId: true,
        },
      },
    },
    where: {
      deletedAt: null,
      id: {
        in: workItemIds,
      },
    },
  });
  const requirementOwnerIdsById = new Map(
    (
      await tx.document.findMany({
        select: {
          id: true,
          ownerId: true,
        },
        where: {
          deletedAt: null,
          id: {
            in: uniqueIds(workItems.map((workItem) => workItem.requirementId)),
          },
          kind: REQUIREMENT_DOCUMENT_KIND,
        },
      })
    ).map((requirement) => [requirement.id, requirement.ownerId]),
  );

  for (const workItem of workItems) {
    const relatedTask =
      workItem.bugDetail?.deletedAt === null
        ? workItem.bugDetail.relatedTask
        : undefined;
    const relatedTaskUserIds =
      relatedTask && relatedTask.deletedAt === null
        ? [
            relatedTask.createdById,
            relatedTask.reporterId,
            relatedTask.assigneeId,
          ]
        : [];
    const userIds = uniqueIds([
      workItem.version?.ownerId,
      workItem.requirementId
        ? requirementOwnerIdsById.get(workItem.requirementId)
        : undefined,
      workItem.intakeItem?.reporterId,
      workItem.intakeItem?.assigneeId,
      ...relatedTaskUserIds,
    ]);

    await replaceWorkItemRelatedParticipants(tx, {
      actorUserId: input.actorUserId,
      organizationId: workItem.organizationId,
      spaceId: workItem.spaceId,
      targetId: workItem.id,
      userIds,
    });
  }
}

async function replaceWorkItemRelatedParticipants(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    spaceId: string;
    targetId: string;
    userIds: string[];
  },
) {
  const where: Prisma.ObjectParticipantWhereInput = {
    deletedAt: null,
    relationType: "RELATED",
    spaceId: input.spaceId,
    targetId: input.targetId,
    targetType: "WORK_ITEM",
  };

  if (input.userIds.length > 0) {
    where.userId = {
      notIn: input.userIds,
    };
  }

  await tx.objectParticipant.updateMany({
    data: {
      deletedAt: new Date(),
      updatedById: input.actorUserId,
    },
    where,
  });

  for (const userId of input.userIds) {
    await ensureWorkItemRelatedParticipant(tx, {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      userId,
    });
  }
}

async function ensureWorkItemRelatedParticipant(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    spaceId: string;
    targetId: string;
    userId: string;
  },
) {
  const existing = await tx.objectParticipant.findFirst({
    select: {
      id: true,
    },
    where: {
      deletedAt: null,
      relationType: "RELATED",
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "WORK_ITEM",
      userId: input.userId,
    },
  });

  if (existing) {
    return;
  }

  await tx.objectParticipant.create({
    data: {
      id: ulid(),
      createdById: input.actorUserId,
      organizationId: input.organizationId,
      relationType: "RELATED",
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "WORK_ITEM",
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}

async function ensureParticipant(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    relationType: "CREATOR" | "ASSIGNEE";
    spaceId: string;
    targetId: string;
    userId: string;
  },
) {
  const existing = await tx.objectParticipant.findFirst({
    select: {
      id: true,
    },
    where: {
      deletedAt: null,
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: REQUIREMENT_TARGET_TYPE,
      userId: input.userId,
    },
  });

  if (existing) {
    return;
  }

  await tx.objectParticipant.create({
    data: {
      id: ulid(),
      createdById: input.actorUserId,
      organizationId: input.organizationId,
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: REQUIREMENT_TARGET_TYPE,
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}

function emptyVersionCascadeImpact() {
  return {
    bugCount: 0,
    bugIds: [],
    intakeItemCount: 0,
    intakeItemIds: [],
    relatedBugCount: 0,
    relatedBugIds: [],
    workItemCount: 0,
    workItemIds: [],
  };
}

function uniqueIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean))) as string[];
}
