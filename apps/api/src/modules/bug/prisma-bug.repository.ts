import { Inject, Injectable } from "@nestjs/common";
import type { WorkItemDimensionCounts } from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ObjectCodeAllocator } from "../object-code/object-code.allocator";
import { parseObjectCode } from "../object-code/object-code.types";
import {
  findAnyTaggedTargetIds,
  findTaggedTargetIds,
  listTagsByTargets,
  replaceTagAssignmentsInTransaction,
} from "../tag/tag-assignment.helpers";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import { toBugView, type PrismaBugViewRecord } from "./bug.mappers";
import type { BugRepository } from "./bug.repository";
import type {
  BugListInput,
  CreateAuditLogInput,
  CreateBugInput,
  ParticipantInput,
  UpdateBugInput,
} from "./bug.types";

@Injectable()
export class PrismaBugRepository implements BugRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ObjectCodeAllocator)
    private readonly objectCodeAllocator: ObjectCodeAllocator,
  ) {}

  async listBySpaceId(spaceId: string, input: BugListInput) {
    const where = buildListWhere(spaceId, input);
    const taggedTargetIds = await findTaggedTargetIds(this.prisma.client, {
      spaceId,
      tagIds: input.tagIds,
      tagMatch: input.tagMatch,
      targetType: "WORK_ITEM",
    });
    const anyTaggedTargetIds = input.noTags
      ? await findAnyTaggedTargetIds(this.prisma.client, {
          spaceId,
          targetType: "WORK_ITEM",
        })
      : undefined;
    const visibilityScope = await this.resolveListVisibilityScope(
      spaceId,
      input,
    );

    if (visibilityScope?.kind === "empty") {
      return {
        dimensionCounts: emptyBugDimensionCounts(),
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        statusCategoryCounts: [],
        total: 0,
      };
    }

    applyVisibilityScope(where, visibilityScope);
    applyTagListFilter(where, {
      anyTaggedTargetIds,
      taggedTargetIds,
      untagged: input.noTags,
    });

    const countWheres = buildBugDimensionWheres(
      spaceId,
      input,
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    );
    const [
      items,
      total,
      statusCategoryGroups,
      assigneeIdGroups,
      createdByGroups,
      priorityGroups,
      versionIdGroups,
      requirementIdGroups,
      severityGroups,
      relatedTaskIdGroups,
    ] =
      await this.prisma.client.$transaction([
        this.prisma.client.workItem.findMany({
          include: {
            bugDetail: true,
          },
          orderBy: buildOrderBy(input),
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        this.prisma.client.workItem.count({
          where,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["statusCategory"],
          _count: {
            _all: true,
          },
          where: countWheres.statusCategory,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["assigneeId"],
          _count: {
            _all: true,
          },
          where: countWheres.assigneeId,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["createdById", "reporterId"],
          _count: {
            _all: true,
          },
          where: countWheres.createdById,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["priority"],
          _count: {
            _all: true,
          },
          where: countWheres.priority,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["versionId"],
          _count: {
            _all: true,
          },
          where: countWheres.versionId,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["requirementId"],
          _count: {
            _all: true,
          },
          where: countWheres.requirementId,
        }),
        this.prisma.client.bugDetail.groupBy({
          by: ["severity"],
          _count: {
            _all: true,
          },
          where: countWheres.severity,
        }),
        this.prisma.client.bugDetail.groupBy({
          by: ["relatedTaskId"],
          _count: {
            _all: true,
          },
          where: countWheres.relatedTaskId,
        }),
      ]);
    const tagIdDimension = await countTagDimension(this.prisma.client, {
      baseWhere: countWheres.tagId,
      spaceId,
    });
    const statusCategoryBuckets = statusCategoryGroups.map((group) => ({
      count: group._count._all,
      value: group.statusCategory,
    }));
    const dimensionCounts: WorkItemDimensionCounts = [
      makeDimensionCount("statusCategory", statusCategoryBuckets),
      makeNullableDimensionCount(
        "assigneeId",
        assigneeIdGroups.map((group) => ({
          count: group._count._all,
          value: group.assigneeId,
        })),
      ),
      makeNullableDimensionCount(
        "createdById",
        mergeCreatedByGroups(createdByGroups),
      ),
      makeDimensionCount(
        "priority",
        priorityGroups.map((group) => ({
          count: group._count._all,
          value: group.priority,
        })),
      ),
      makeDimensionCount(
        "severity",
        severityGroups.map((group) => ({
          count: group._count._all,
          value: group.severity,
        })),
      ),
      makeNullableDimensionCount(
        "versionId",
        versionIdGroups.map((group) => ({
          count: group._count._all,
          value: group.versionId,
        })),
      ),
      makeNullableDimensionCount(
        "requirementId",
        requirementIdGroups.map((group) => ({
          count: group._count._all,
          value: group.requirementId,
        })),
      ),
      makeNullableDimensionCount(
        "relatedTaskId",
        relatedTaskIdGroups.map((group) => ({
          count: group._count._all,
          value: group.relatedTaskId,
        })),
      ),
      tagIdDimension,
    ];
    const tagsByBugId = await listTagsByTargets(this.prisma.client, {
      organizationId: items[0]?.organizationId ?? "",
      spaceId,
      targetIds: items.map((item) => item.id),
      targetType: "WORK_ITEM",
    });

    return {
      items: items.flatMap((item) =>
        item.bugDetail
          ? [
              toBugView(
                item as PrismaBugViewRecord,
                undefined,
                tagsByBugId.get(item.id) ?? [],
              ),
            ]
          : [],
      ),
      page: input.page,
      pageSize: input.pageSize,
      dimensionCounts,
      statusCategoryCounts: statusCategoryBuckets.map((bucket) => ({
        count: bucket.count,
        statusCategory: bucket.value,
      })),
      total,
    };
  }

  async create(input: CreateBugInput) {
    const created = await this.prisma.client.$transaction(async (tx) => {
      const sequence = await this.objectCodeAllocator.allocateOne(tx, {
        actorUserId: input.createdById,
        objectType: "BUG",
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      });
      const workItem = await tx.workItem.create({
        data: {
          id: input.id,
          assigneeId: input.assigneeId,
          createdById: input.createdById,
          currentStateId: input.currentStateId,
          description: input.description,
          dueDate: input.dueDate,
          intakeItemId: input.intakeItemId,
          lastStatusChangedAt: input.lastStatusChangedAt,
          organizationId: input.organizationId,
          priority: input.priority,
          reporterId: input.reporterId,
          requirementId: input.requirementId,
          sequence,
          spaceId: input.spaceId,
          statusCategory: input.statusCategory,
          title: input.title,
          type: "BUG",
          updatedById: input.createdById,
          versionId: input.versionId,
          workflowVersionId: input.workflowVersionId,
        },
      });

      await tx.bugDetail.create({
        data: {
          workItemId: workItem.id,
          actualResult: input.actualResult,
          createdById: input.createdById,
          expectedResult: input.expectedResult,
          relatedTaskId: input.relatedTaskId,
          severity: input.severity,
          stepsToReproduce: input.stepsToReproduce,
          updatedById: input.createdById,
        },
      });

      await ensureParticipant(tx, {
        actorUserId: input.createdById,
        organizationId: input.organizationId,
        relationType: "CREATOR",
        spaceId: input.spaceId,
        targetId: workItem.id,
        userId: input.createdById,
      });
      await ensureParticipant(tx, {
        actorUserId: input.createdById,
        organizationId: input.organizationId,
        relationType: "REPORTER",
        spaceId: input.spaceId,
        targetId: workItem.id,
        userId: input.reporterId,
      });

      if (input.assigneeId) {
        await ensureParticipant(tx, {
          actorUserId: input.createdById,
          organizationId: input.organizationId,
          relationType: "ASSIGNEE",
          spaceId: input.spaceId,
          targetId: workItem.id,
          userId: input.assigneeId,
        });
      }

      for (const userId of unique(input.relatedUserIds)) {
        await ensureParticipant(tx, {
          actorUserId: input.createdById,
          organizationId: input.organizationId,
          relationType: "RELATED",
          spaceId: input.spaceId,
          targetId: workItem.id,
          userId,
        });
      }

      await createTimelineEvent(tx, {
        actorUserId: input.createdById,
        after: {
          assigneeId: input.assigneeId ?? null,
          currentStateId: input.currentStateId,
          dueDate: input.dueDate?.toISOString() ?? null,
          priority: input.priority,
          relatedTaskId: input.relatedTaskId ?? null,
          severity: input.severity,
          statusCategory: input.statusCategory,
          title: input.title,
          workflowVersionId: input.workflowVersionId,
        },
        eventType: "CREATED",
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: workItem.id,
        targetWorkItemType: "BUG",
        title: "创建 Bug",
      });

      await replaceTagAssignmentsInTransaction(tx, {
        assignedById: input.createdById,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        tagIds: input.tagIds,
        targetId: workItem.id,
        targetType: "WORK_ITEM",
      });

      const bug = await findBugRecord(tx, workItem.id);

      if (!bug?.bugDetail) {
        throw new Error("Created bug detail was not found");
      }

      return bug;
    });

    const tagsByBugId = await listTagsByTargets(this.prisma.client, {
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetIds: [created.id],
      targetType: "WORK_ITEM",
    });

    return toBugView(
      created as PrismaBugViewRecord,
      undefined,
      tagsByBugId.get(created.id) ?? [],
    );
  }

  async findBugById(bugId: string) {
    const bug = await findBugRecord(this.prisma.client, bugId);

    if (!bug?.bugDetail) {
      return undefined;
    }

    const tagsByBugId = await listTagsByTargets(this.prisma.client, {
      organizationId: bug.organizationId,
      spaceId: bug.spaceId,
      targetIds: [bug.id],
      targetType: "WORK_ITEM",
    });

    return toBugView(
      bug as PrismaBugViewRecord,
      undefined,
      tagsByBugId.get(bug.id) ?? [],
    );
  }

  async update(input: UpdateBugInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const data: Prisma.WorkItemUncheckedUpdateManyInput = {
        updatedById: input.updatedById,
      };

      if (input.versionId !== undefined) {
        data.versionId = input.versionId;
      }
      if (input.requirementId !== undefined) {
        data.requirementId = input.requirementId;
      }
      if (input.intakeItemId !== undefined) {
        data.intakeItemId = input.intakeItemId;
      }
      if (input.title !== undefined) {
        data.title = input.title;
      }
      if (input.description !== undefined) {
        data.description = input.description;
      }
      if (input.priority !== undefined) {
        data.priority = input.priority;
      }
      if (input.assigneeId !== undefined) {
        data.assigneeId = input.assigneeId;
      }
      if (input.dueDate !== undefined) {
        data.dueDate = input.dueDate;
      }

      const result = await tx.workItem.updateMany({
        data,
        where: {
          deletedAt: null,
          id: input.workItemId,
          type: "BUG",
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const detailData: Prisma.BugDetailUncheckedUpdateManyInput = {
        updatedById: input.updatedById,
      };
      let hasDetailChange = false;

      if (input.severity !== undefined) {
        detailData.severity = input.severity;
        hasDetailChange = true;
      }
      if (input.stepsToReproduce !== undefined) {
        detailData.stepsToReproduce = input.stepsToReproduce;
        hasDetailChange = true;
      }
      if (input.expectedResult !== undefined) {
        detailData.expectedResult = input.expectedResult;
        hasDetailChange = true;
      }
      if (input.actualResult !== undefined) {
        detailData.actualResult = input.actualResult;
        hasDetailChange = true;
      }
      if (input.relatedTaskId !== undefined) {
        detailData.relatedTaskId = input.relatedTaskId;
        hasDetailChange = true;
      }

      if (hasDetailChange) {
        const detailResult = await tx.bugDetail.updateMany({
          data: detailData,
          where: {
            deletedAt: null,
            workItemId: input.workItemId,
          },
        });

        if (detailResult.count === 0) {
          return undefined;
        }
      }

      const bug = await findBugRecord(tx, input.workItemId);

      if (!bug?.bugDetail) {
        return undefined;
      }

      if (input.shouldReplaceAssigneeParticipants) {
        await replaceParticipants(tx, {
          actorUserId: input.updatedById,
          organizationId: bug.organizationId,
          relationType: "ASSIGNEE",
          spaceId: bug.spaceId,
          targetId: bug.id,
          userIds: bug.assigneeId ? [bug.assigneeId] : [],
        });
      }

      if (input.shouldReplaceRelatedParticipants) {
        await replaceParticipants(tx, {
          actorUserId: input.updatedById,
          organizationId: bug.organizationId,
          relationType: "RELATED",
          spaceId: bug.spaceId,
          targetId: bug.id,
          userIds: input.relatedUserIds,
        });
      }

      if (Object.keys(input.timelineAfter).length > 0) {
        await createTimelineEvent(tx, {
          actorUserId: input.updatedById,
          after: input.timelineAfter,
          before: input.timelineBefore,
          eventType: "UPDATED",
          organizationId: bug.organizationId,
          spaceId: bug.spaceId,
          targetId: bug.id,
          targetWorkItemType: "BUG",
          title: "更新 Bug",
        });
      }

      return bug;
    });

    if (!updated?.bugDetail) {
      return undefined;
    }

    const tagsByBugId = await listTagsByTargets(this.prisma.client, {
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      targetIds: [updated.id],
      targetType: "WORK_ITEM",
    });

    return toBugView(
      updated as PrismaBugViewRecord,
      undefined,
      tagsByBugId.get(updated.id) ?? [],
    );
  }

  async isParticipant(spaceId: string, bugId: string, userId: string) {
    const participant = await this.prisma.client.objectParticipant.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetId: bugId,
        targetType: "WORK_ITEM",
        userId,
      },
    });

    return Boolean(participant);
  }

  async findVersionInSpace(spaceId: string, versionId: string) {
    const version = await this.prisma.client.version.findFirst({
      select: {
        ownerId: true,
      },
      where: {
        deletedAt: null,
        id: versionId,
        spaceId,
      },
    });

    return version
      ? {
          versionOwnerId: version.ownerId ?? undefined,
        }
      : undefined;
  }

  async findRequirementInSpace(spaceId: string, requirementId: string) {
    const requirement = await this.prisma.client.document.findFirst({
      select: {
        ownerId: true,
        sequence: true,
        status: true,
        versionId: true,
      },
      where: {
        deletedAt: null,
        id: requirementId,
        kind: "REQUIREMENT",
        spaceId,
      },
    });

    return requirement
        ? {
            requirementOwnerId: requirement.ownerId ?? undefined,
            requirementSequence: requirement.sequence ?? undefined,
            requirementStatus: requirement.status,
            requirementVersionId: requirement.versionId ?? undefined,
          }
      : undefined;
  }

  async findIntakeItemInSpace(spaceId: string, intakeItemId: string) {
    const intakeItem = await this.prisma.client.intakeItem.findFirst({
      select: {
        assigneeId: true,
        reporterId: true,
        versionId: true,
      },
      where: {
        deletedAt: null,
        id: intakeItemId,
        spaceId,
      },
    });

    return intakeItem
      ? {
          intakeAssigneeId: intakeItem.assigneeId ?? undefined,
          intakeReporterId: intakeItem.reporterId,
          intakeVersionId: intakeItem.versionId ?? undefined,
        }
      : undefined;
  }

  async findRelatedTaskInSpace(spaceId: string, relatedTaskId: string) {
    const task = await this.prisma.client.workItem.findFirst({
      select: {
        assigneeId: true,
        createdById: true,
        reporterId: true,
        versionId: true,
      },
      where: {
        deletedAt: null,
        id: relatedTaskId,
        spaceId,
        type: "TASK",
      },
    });

    return task
      ? {
          relatedTaskAssigneeId: task.assigneeId ?? undefined,
          relatedTaskCreatorId: task.createdById ?? undefined,
          relatedTaskReporterId: task.reporterId,
          relatedTaskVersionId: task.versionId ?? undefined,
        }
      : undefined;
  }

  async resolveBugWorkflow(spaceId: string, workflowVersionId?: string) {
    if (workflowVersionId) {
      const version = await this.prisma.client.workflowVersion.findFirst({
        include: {
          states: {
            orderBy: {
              sortOrder: "asc",
            },
            take: 1,
            where: {
              deletedAt: null,
              isStart: true,
            },
          },
        },
        where: {
          deletedAt: null,
          id: workflowVersionId,
          status: "PUBLISHED",
          workflowDefinition: {
            bindings: {
              some: {
                deletedAt: null,
                spaceId,
                targetType: "WORK_ITEM",
                workItemType: "BUG",
              },
            },
            deletedAt: null,
            spaceId,
            status: "ACTIVE",
          },
        },
      });
      const startState = version?.states[0];

      return version && startState
        ? {
            currentStateId: startState.id,
            statusCategory: startState.category,
            workflowVersionId: version.id,
          }
        : undefined;
    }

    const binding = await this.prisma.client.workflowBinding.findFirst({
      include: {
        workflowVersion: {
          include: {
            states: {
              orderBy: {
                sortOrder: "asc",
              },
              take: 1,
              where: {
                deletedAt: null,
                isStart: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        isDefault: workflowVersionId ? undefined : true,
        spaceId,
        targetType: "WORK_ITEM",
        workItemType: "BUG",
        workflowDefinition: {
          deletedAt: null,
          status: "ACTIVE",
        },
        workflowVersion: {
          deletedAt: null,
          status: "PUBLISHED",
        },
        workflowVersionId,
      },
    });
    const startState = binding?.workflowVersion.states[0];

    return binding && startState
      ? {
          currentStateId: startState.id,
          statusCategory: startState.category,
          workflowVersionId: binding.workflowVersionId,
        }
      : undefined;
  }

  async findSpaceAuditContext(spaceId: string) {
    const space = await this.prisma.client.space.findFirst({
      select: {
        id: true,
        organizationId: true,
      },
      where: {
        deletedAt: null,
        id: spaceId,
      },
    });

    return space
      ? {
          organizationId: space.organizationId,
          spaceId: space.id,
        }
      : undefined;
  }

  async createAuditLog(input: CreateAuditLogInput) {
    await this.prisma.client.auditLog.create({
      data: {
        id: ulid(),
        actionType: input.actionType,
        actorId: input.actorId,
        after: toJson(input.after),
        before: toJson(input.before),
        ip: input.ip,
        metadata: toJson(input.metadata),
        organizationId: input.organizationId,
        requestId: input.requestId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
        userAgent: input.userAgent,
      },
    });
  }

  private async listParticipantBugIds(spaceId: string, userId: string) {
    const participants = await this.prisma.client.objectParticipant.findMany({
      select: {
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetType: "WORK_ITEM",
        userId,
      },
    });

    return unique(participants.map((participant) => participant.targetId));
  }

  private async resolveListVisibilityScope(
    spaceId: string,
    input: BugListInput,
  ): Promise<ListVisibilityScope | undefined> {
    if (input.visibility !== "PARTICIPANT") {
      return undefined;
    }

    const visibleIds = await this.listParticipantBugIds(
      spaceId,
      input.actorUserId,
    );

    return visibleIds.length > 0
      ? {
          ids: visibleIds,
          kind: "ids",
        }
      : {
          kind: "empty",
        };
  }
}

type BugRecordClient = Prisma.TransactionClient | PrismaService["client"];

type ListVisibilityScope =
  | {
      kind: "empty";
    }
  | {
      ids: string[];
      kind: "ids";
    };

type BugDimension =
  | "statusCategory"
  | "assigneeId"
  | "createdById"
  | "priority"
  | "severity"
  | "versionId"
  | "requirementId"
  | "relatedTaskId"
  | "tagId";

type BugWorkItemDimension = Exclude<BugDimension, "severity" | "relatedTaskId">;

type WorkItemDimensionBucket = WorkItemDimensionCounts[number]["buckets"][number];

function findBugRecord(tx: BugRecordClient, bugId: string) {
  return tx.workItem.findFirst({
    include: {
      bugDetail: true,
    },
    where: {
      bugDetail: {
        is: {
          deletedAt: null,
        },
      },
      deletedAt: null,
      id: bugId,
      type: "BUG",
    },
  });
}

function buildListWhere(
  spaceId: string,
  input: BugListInput,
): Prisma.WorkItemWhereInput {
  const where: Prisma.WorkItemWhereInput = {
    assigneeId: input.unassigned ? null : input.assigneeId,
    bugDetail: {
      is: {
        deletedAt: null,
        relatedTaskId: input.noRelatedTask ? null : input.relatedTaskId,
        severity: input.severity,
      },
    },
    deletedAt: null,
    intakeItemId: input.intakeItemId,
    priority: input.priority,
    reporterId: input.reporterId,
    requirementId: input.noRequirement ? null : input.requirementId,
    spaceId,
    statusCategory: input.statusCategory,
    type: "BUG",
    versionId: input.noVersion ? null : input.versionId,
  };

  applyCreatedByFilter(where, input.createdById);
  applyListQuery(where, input.query);

  return where;
}

function buildBugDimensionWheres(
  spaceId: string,
  input: BugListInput,
  taggedTargetIds: string[] | undefined,
  anyTaggedTargetIds: string[] | undefined,
  visibilityScope: ListVisibilityScope | undefined,
) {
  return {
    statusCategory: buildBugWorkItemDimensionWhere(
      spaceId,
      input,
      "statusCategory",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
    assigneeId: buildBugWorkItemDimensionWhere(
      spaceId,
      input,
      "assigneeId",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
    createdById: buildBugWorkItemDimensionWhere(
      spaceId,
      input,
      "createdById",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
    priority: buildBugWorkItemDimensionWhere(
      spaceId,
      input,
      "priority",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
    severity: buildBugDetailDimensionWhere(
      spaceId,
      input,
      "severity",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
    versionId: buildBugWorkItemDimensionWhere(
      spaceId,
      input,
      "versionId",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
    requirementId: buildBugWorkItemDimensionWhere(
      spaceId,
      input,
      "requirementId",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
    relatedTaskId: buildBugDetailDimensionWhere(
      spaceId,
      input,
      "relatedTaskId",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
    tagId: buildBugWorkItemDimensionWhere(
      spaceId,
      input,
      "tagId",
      taggedTargetIds,
      anyTaggedTargetIds,
      visibilityScope,
    ),
  };
}

function buildBugWorkItemDimensionWhere(
  spaceId: string,
  input: BugListInput,
  dimension: BugWorkItemDimension,
  taggedTargetIds: string[] | undefined,
  anyTaggedTargetIds: string[] | undefined,
  visibilityScope: ListVisibilityScope | undefined,
): Prisma.WorkItemWhereInput {
  const where = buildListWhere(spaceId, omitBugDimensionFilter(input, dimension));

  applyVisibilityScope(where, visibilityScope);

  if (dimension !== "tagId") {
    applyTagListFilter(where, {
      anyTaggedTargetIds,
      taggedTargetIds,
      untagged: input.noTags,
    });
  }

  return where;
}

function buildBugDetailDimensionWhere(
  spaceId: string,
  input: BugListInput,
  dimension: "severity" | "relatedTaskId",
  taggedTargetIds: string[] | undefined,
  anyTaggedTargetIds: string[] | undefined,
  visibilityScope: ListVisibilityScope | undefined,
): Prisma.BugDetailWhereInput {
  const workItemWhere = buildListWhere(
    spaceId,
    omitBugDimensionFilter(input, dimension),
  );

  applyVisibilityScope(workItemWhere, visibilityScope);
  applyTagListFilter(workItemWhere, {
    anyTaggedTargetIds,
    taggedTargetIds,
    untagged: input.noTags,
  });

  const bugDetail = workItemWhere.bugDetail;

  delete workItemWhere.bugDetail;

  return {
    ...getBugDetailWhere(bugDetail),
    workItem: workItemWhere,
  };
}

function omitBugDimensionFilter(
  input: BugListInput,
  dimension: BugDimension,
): BugListInput {
  const next: BugListInput = { ...input };

  switch (dimension) {
    case "statusCategory":
      next.statusCategory = undefined;
      break;
    case "assigneeId":
      next.assigneeId = undefined;
      next.unassigned = undefined;
      break;
    case "createdById":
      next.createdById = undefined;
      break;
    case "priority":
      next.priority = undefined;
      break;
    case "severity":
      next.severity = undefined;
      break;
    case "versionId":
      next.versionId = undefined;
      next.noVersion = undefined;
      break;
    case "requirementId":
      next.requirementId = undefined;
      next.noRequirement = undefined;
      break;
    case "relatedTaskId":
      next.relatedTaskId = undefined;
      next.noRelatedTask = undefined;
      break;
    case "tagId":
      next.tagIds = undefined;
      next.tagMatch = undefined;
      next.noTags = undefined;
      break;
  }

  return next;
}

function getBugDetailWhere(
  bugDetail: Prisma.WorkItemWhereInput["bugDetail"],
): Prisma.BugDetailWhereInput {
  if (
    bugDetail &&
    typeof bugDetail === "object" &&
    "is" in bugDetail &&
    bugDetail.is &&
    typeof bugDetail.is === "object"
  ) {
    return bugDetail.is;
  }

  return {
    deletedAt: null,
  };
}

function applyVisibilityScope(
  where: Prisma.WorkItemWhereInput,
  visibilityScope: ListVisibilityScope | undefined,
) {
  if (!visibilityScope || visibilityScope.kind === "empty") {
    return;
  }

  where.AND = [
    ...toArray(where.AND),
    {
      id: {
        in: visibilityScope.ids,
      },
    },
  ];
}

function applyListQuery(
  where: Prisma.WorkItemWhereInput,
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
      parsed.objectType === "BUG"
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
        { description: { contains: trimmed, mode: "insensitive" } },
      ],
    },
  ];
}

function applyCreatedByFilter(
  where: Prisma.WorkItemWhereInput,
  createdById: string | undefined,
) {
  if (!createdById) {
    return;
  }

  where.OR = [
    {
      createdById,
    },
    {
      createdById: null,
      reporterId: createdById,
    },
  ];
}

function applyTaggedTargetIds(
  where: Prisma.WorkItemWhereInput,
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

function applyUntaggedTargetIds(
  where: Prisma.WorkItemWhereInput,
  taggedTargetIds: string[] | undefined,
) {
  if (!taggedTargetIds || taggedTargetIds.length === 0) {
    return;
  }

  where.AND = [
    ...toArray(where.AND),
    {
      id: {
        notIn: taggedTargetIds,
      },
    },
  ];
}

function applyTagListFilter(
  where: Prisma.WorkItemWhereInput,
  input: {
    anyTaggedTargetIds?: string[];
    taggedTargetIds?: string[];
    untagged?: boolean;
  },
) {
  if (input.untagged) {
    applyUntaggedTargetIds(where, input.anyTaggedTargetIds);
    return;
  }

  applyTaggedTargetIds(where, input.taggedTargetIds);
}

function makeDimensionCount(
  dimension: BugDimension,
  buckets: WorkItemDimensionBucket[],
  total = sumBuckets(buckets),
): WorkItemDimensionCounts[number] {
  return {
    buckets,
    dimension,
    total,
  };
}

function makeNullableDimensionCount(
  dimension: BugDimension,
  buckets: WorkItemDimensionBucket[],
): WorkItemDimensionCounts[number] {
  return makeDimensionCount(dimension, ensureNullBucket(buckets));
}

async function countTagDimension(
  client: BugRecordClient,
  input: {
    baseWhere: Prisma.WorkItemWhereInput;
    spaceId: string;
  },
): Promise<WorkItemDimensionCounts[number]> {
  const targets = await client.workItem.findMany({
    select: {
      id: true,
    },
    where: input.baseWhere,
  });
  const targetIds = targets.map((target) => target.id);

  if (targetIds.length === 0) {
    return makeDimensionCount("tagId", [{ count: 0, value: null }], 0);
  }

  const assignments = await client.tagAssignment.findMany({
    select: {
      tagId: true,
      targetId: true,
    },
    where: {
      deletedAt: null,
      spaceId: input.spaceId,
      tag: {
        deletedAt: null,
        spaceId: input.spaceId,
      },
      targetId: {
        in: targetIds,
      },
      targetType: "WORK_ITEM",
    },
  });
  const targetIdsByTagId = new Map<string, Set<string>>();
  const taggedTargetIds = new Set<string>();

  for (const assignment of assignments) {
    const current = targetIdsByTagId.get(assignment.tagId) ?? new Set<string>();
    current.add(assignment.targetId);
    targetIdsByTagId.set(assignment.tagId, current);
    taggedTargetIds.add(assignment.targetId);
  }

  const buckets: WorkItemDimensionBucket[] = [...targetIdsByTagId.entries()].map(
    ([tagId, ids]) => ({
      count: ids.size,
      value: tagId,
    }),
  );
  buckets.push({
    count: targetIds.filter((targetId) => !taggedTargetIds.has(targetId))
      .length,
    value: null,
  });

  return makeDimensionCount("tagId", buckets, targetIds.length);
}

function mergeCreatedByGroups(
  groups: Array<{
    _count: {
      _all: number;
    };
    createdById: string | null;
    reporterId: string;
  }>,
): WorkItemDimensionBucket[] {
  const countsByUserId = new Map<string, number>();
  let nullCount = 0;

  for (const group of groups) {
    const userId = group.createdById ?? group.reporterId;

    if (!userId) {
      nullCount += group._count._all;
      continue;
    }

    countsByUserId.set(
      userId,
      (countsByUserId.get(userId) ?? 0) + group._count._all,
    );
  }

  return [
    ...[...countsByUserId.entries()].map(([value, count]) => ({
      count,
      value,
    })),
    {
      count: nullCount,
      value: null,
    },
  ];
}

function ensureNullBucket(buckets: WorkItemDimensionBucket[]) {
  return buckets.some((bucket) => bucket.value === null)
    ? buckets
    : [...buckets, { count: 0, value: null }];
}

function emptyBugDimensionCounts(): WorkItemDimensionCounts {
  return [
    makeDimensionCount("statusCategory", []),
    makeNullableDimensionCount("assigneeId", []),
    makeNullableDimensionCount("createdById", []),
    makeDimensionCount("priority", []),
    makeDimensionCount("severity", []),
    makeNullableDimensionCount("versionId", []),
    makeNullableDimensionCount("requirementId", []),
    makeNullableDimensionCount("relatedTaskId", []),
    makeDimensionCount("tagId", [{ count: 0, value: null }], 0),
  ];
}

function sumBuckets(buckets: WorkItemDimensionBucket[]) {
  return buckets.reduce((sum, bucket) => sum + bucket.count, 0);
}

function buildOrderBy(
  input: BugListInput,
): Prisma.WorkItemOrderByWithRelationInput[] {
  const sortOrder = input.sortOrder ?? "asc";

  switch (input.sortBy) {
    case "dueDate":
      return [{ dueDate: sortOrder }, { createdAt: "asc" }];
    case "lastStatusChangedAt":
      return [{ lastStatusChangedAt: sortOrder }, { createdAt: "asc" }];
    case "priority":
      return [{ priority: sortOrder }, { createdAt: "asc" }];
    case "relatedTaskId":
      return [
        { bugDetail: { relatedTaskId: sortOrder } },
        { createdAt: "asc" },
      ];
    case "severity":
      return [{ bugDetail: { severity: sortOrder } }, { createdAt: "asc" }];
    case "title":
      return [{ title: sortOrder }, { createdAt: "asc" }];
    case "createdAt":
    default:
      return [{ createdAt: sortOrder }];
  }
}

async function ensureParticipant(
  tx: Prisma.TransactionClient,
  input: ParticipantInput,
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
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "WORK_ITEM",
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}

async function replaceParticipants(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    relationType: "ASSIGNEE" | "RELATED";
    spaceId: string;
    targetId: string;
    userIds: string[];
  },
) {
  const userIds = unique(input.userIds);
  const where: Prisma.ObjectParticipantWhereInput = {
    deletedAt: null,
    relationType: input.relationType,
    spaceId: input.spaceId,
    targetId: input.targetId,
    targetType: "WORK_ITEM",
  };

  if (userIds.length > 0) {
    where.userId = {
      notIn: userIds,
    };
  }

  await tx.objectParticipant.updateMany({
    data: {
      deletedAt: new Date(),
      updatedById: input.actorUserId,
    },
    where,
  });

  for (const userId of userIds) {
    await ensureParticipant(tx, {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      userId,
    });
  }
}

async function createTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    after?: Record<string, unknown>;
    before?: Record<string, unknown>;
    eventType: "CREATED" | "UPDATED";
    organizationId: string;
    spaceId: string;
    targetId: string;
    targetWorkItemType: "BUG";
    title: string;
  },
) {
  await createTimelineEventRecord(tx, {
    ...input,
    targetType: "WORK_ITEM",
  });
}

function toJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonObject | undefined {
  return value && Object.keys(value).length > 0
    ? (value as Prisma.InputJsonObject)
    : undefined;
}

function unique(values: readonly (string | undefined)[]) {
  return Array.from(new Set(values.filter(Boolean))) as string[];
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
