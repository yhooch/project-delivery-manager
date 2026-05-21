import { Inject, Injectable } from "@nestjs/common";
import type {
  RequirementRelatedWorkItems,
  StatusCategory,
  WorkItemType,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
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
import { syncWorkItemRelatedParticipants } from "../workitem/workitem-participants";
import type { RequirementRepository } from "./requirement.repository";
import type {
  ArchiveRequirementInput,
  CreateRequirementDraftInput,
  DeleteRequirementDraftInput,
  RequirementListInput,
  SaveRequirementInput,
} from "./requirement.types";

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
  ) {}

  async createDraft(input: CreateRequirementDraftInput) {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.requirement.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          versionId: input.versionId,
          authorId: input.createdById,
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

      await createTimelineEvent(tx, {
        actorUserId: input.createdById,
        after: {
          status: created.status,
          title: created.title,
          versionId: created.versionId ?? null,
        },
        eventType: "CREATED",
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: created.id,
        title: "创建需求草稿",
      });

      const tags = await replaceTagAssignmentsInTransaction(tx, {
        assignedById: input.createdById,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        tagIds: input.tagIds,
        targetId: created.id,
        targetType: "REQUIREMENT",
      });

      return { requirement: created, tags };
    });

    return toRequirement(result.requirement, [], undefined, result.tags);
  }

  async findById(requirementId: string) {
    const requirement = await this.prisma.client.requirement.findFirst({
      where: {
        deletedAt: null,
        id: requirementId,
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
          targetType: "REQUIREMENT",
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
        targetType: "REQUIREMENT",
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
      targetType: "REQUIREMENT",
    });

    applyVisibility(where, input, participantIds);
    applyVisibility(countWhere, countInput, participantIds);
    applyTaggedTargetIds(where, taggedTargetIds);
    applyTaggedTargetIds(countWhere, taggedTargetIds);
    const statusGroups = isKnownEmptyIdFilter(countWhere.id)
      ? []
      : await this.prisma.client.requirement.groupBy({
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
          status: group.status,
        })),
        total: 0,
      };
    }

    const [requirements, total] = await this.prisma.client.$transaction([
      this.prisma.client.requirement.findMany({
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.requirement.count({
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
        targetType: "REQUIREMENT",
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
        status: group.status,
      })),
      total,
    };
  }

  async countVersionCascadeImpact(input: {
    requirementId: string;
    nextVersionId: string | null;
  }) {
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
      const previous = await tx.requirement.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (!previous) {
        return undefined;
      }

      const result = await tx.requirement.updateMany({
        data: {
          title: input.title,
          summary: input.summary,
          contentJson: input.contentJson as Prisma.InputJsonValue,
          contentText: input.contentText,
          contentMarkdownCache: input.contentMarkdownCache,
          versionId: input.versionId,
          priority: input.priority,
          ownerId: input.shouldUpdateOwner ? input.ownerId : undefined,
          status: "CONFIRMED",
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const requirement = await tx.requirement.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (!requirement) {
        return undefined;
      }

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
            targetType: "REQUIREMENT",
            userId: {
              not: input.ownerId,
            },
          },
        });
        await ensureParticipant(tx, {
          organizationId: requirement.organizationId,
          spaceId: requirement.spaceId,
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
          targetType: "REQUIREMENT",
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
      const previous = await tx.requirement.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (!previous) {
        return undefined;
      }

      const result = await tx.requirement.updateMany({
        data: {
          status: "ARCHIVED",
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const requirement = await tx.requirement.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (!requirement) {
        return undefined;
      }

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
          targetType: "REQUIREMENT",
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
      const now = new Date();
      const result = await tx.requirement.updateMany({
        data: {
          deletedAt: now,
          updatedById: input.deletedById,
        },
        where: {
          deletedAt: null,
          id: input.requirementId,
          status: "DRAFT",
        },
      });

      if (result.count === 0) {
        return false;
      }

      await tx.objectParticipant.updateMany({
        data: {
          deletedAt: now,
          updatedById: input.deletedById,
        },
        where: {
          deletedAt: null,
          targetId: input.requirementId,
          targetType: "REQUIREMENT",
        },
      });

      await tx.tagAssignment.updateMany({
        data: {
          deletedAt: now,
        },
        where: {
          deletedAt: null,
          targetId: input.requirementId,
          targetType: "REQUIREMENT",
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
        targetType: "REQUIREMENT",
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
        targetType: "REQUIREMENT",
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
        targetType: "REQUIREMENT",
        userId,
      },
    });

    return participants.map((participant) => participant.targetId);
  }
}

function buildListWhere(
  spaceId: string,
  input: RequirementListInput,
): Prisma.RequirementWhereInput {
  const where: Prisma.RequirementWhereInput = {
    deletedAt: null,
    ownerId: input.ownerId,
    spaceId,
    versionId: input.versionId,
  };

  if (input.status) {
    where.status = input.status;
    return where;
  }

  if (!input.includeDrafts) {
    where.status = {
      not: "DRAFT",
    };
  }

  return where;
}

function applyVisibility(
  where: Prisma.RequirementWhereInput,
  input: RequirementListInput,
  participantIds: string[],
) {
  if (input.visibility === "ALL") {
    restrictDraftVisibilityToParticipants(where, input, participantIds);
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
  where: Prisma.RequirementWhereInput,
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

function restrictDraftVisibilityToParticipants(
  where: Prisma.RequirementWhereInput,
  input: RequirementListInput,
  participantIds: string[],
) {
  if (input.status === "DRAFT") {
    where.id = {
      in: participantIds,
    };
    return;
  }

  if (input.status || !input.includeDrafts) {
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

function isKnownEmptyIdFilter(
  value: Prisma.RequirementWhereInput["id"],
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
  status: string;
  summary: string | null;
  title: string;
  versionId: string | null;
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
    targetType: "REQUIREMENT",
  });
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
        sourceTargetType: "REQUIREMENT",
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
        sourceTargetType: "REQUIREMENT",
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
    sourceTargetType: "INTAKE_ITEM" | "REQUIREMENT";
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
      requirement: {
        select: { versionId: true },
      },
      requirementId: true,
    },
    where: {
      deletedAt: null,
      id: {
        in: input.workItemIds,
      },
    },
  });

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
              : item.requirement?.versionId,
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
      targetType: "REQUIREMENT",
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
      targetType: "REQUIREMENT",
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}
