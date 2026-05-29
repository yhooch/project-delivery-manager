import { Inject, Injectable } from "@nestjs/common";
import type {
  ActionFormFieldSummary,
  GetMyWorkbenchViewResponse,
  GetSpaceExceptionsViewResponse,
  GetSpaceOverviewViewResponse,
  ObjectParticipantTargetType,
  PageResult,
  SpaceRole,
  StatusCategory,
  TargetType,
  ViewExceptionSignal,
  ViewExceptionType,
  ViewWorkItemSummary,
  VersionSummary,
  WorkbenchActionReasonCode,
  WorkbenchActionTodo,
  WorkflowActorRelation,
  WorkflowActionSummary,
} from "@project-delivery/shared";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { formatDisplayCode } from "../object-code/object-code.types";
import {
  findTaggedTargetIds,
  listTagsByTargets,
} from "../tag/tag-assignment.helpers";
import {
  toTimelineEvent,
  type TimelineTargetIdentityRecord,
} from "../timeline/timeline.mappers";
import { excludeRedundantWorkflowActionEvents } from "../timeline/timeline-event-filters";
import {
  canReadAllSpaceWorkItems,
  testerVisibleWorkItemWhere,
} from "../workitem/workitem-visibility";
import {
  buildSpaceExceptionSignals,
  elapsedDays,
  isBlockedRecord,
  isPendingConfirmRecord,
  isPendingRegressionRecord,
  SPACE_EXCEPTION_STATE_RULES,
  SPACE_EXCEPTION_TYPES,
} from "./space-exception.helpers";
import {
  toDefaultWorkflowSummary,
  toSpace,
  toSpaceMember,
  toSpaceMemberWithUser,
  toSpaceSummary,
  toVersionSummary,
} from "./space.mappers";
import type { SpaceRepository } from "./space.repository";
import type {
  AddSpaceMemberInput,
  CreateSpaceInput,
  CreatedSpaceWithAdmin,
  SpaceAccess,
  SpaceListInput,
  SpaceListResult,
  SpaceMemberListInput,
  SpaceMemberListResult,
  SpaceExceptionsViewInput,
  MyWorkbenchViewInput,
  CreateSpaceInTransaction,
  SpaceOverviewViewInput,
  UpdateSpaceInput,
  UpdateSpaceMemberInput,
} from "./space.types";

const DEFAULT_WORKFLOW_CODES = ["DEVELOPMENT_TASK", "GENERAL_TASK", "BUG"];
const TERMINAL_STATUS_CATEGORIES: StatusCategory[] = ["DONE", "TERMINATED"];
const DUE_SOON_DAYS = 7;
const RECENT_ACTIVITY_TARGET_TYPES = [
  "SPACE",
  "WORK_ITEM",
  "DOCUMENT",
  "INTAKE_ITEM",
  "VERSION",
] as const satisfies readonly TargetType[];
const INTAKE_ITEM_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
]);
const REQUIREMENT_DOCUMENT_KIND = "REQUIREMENT" as const;

@Injectable()
export class PrismaSpaceRepository implements SpaceRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async createWithAdmin(
    input: CreateSpaceInput,
    inTransaction?: CreateSpaceInTransaction,
  ): Promise<CreatedSpaceWithAdmin> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const space = await tx.space.create({
        data: {
          id: input.id,
          code: input.code,
          createdById: input.actorUserId,
          description: input.description,
          name: input.name,
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          staleThresholdDays: input.staleThresholdDays,
          updatedById: input.actorUserId,
        },
      });
      const adminMembership = await tx.spaceMember.create({
        data: {
          id: input.adminMemberId,
          createdById: input.actorUserId,
          organizationId: input.organizationId,
          role: "SPACE_ADMIN",
          spaceId: space.id,
          updatedById: input.actorUserId,
          userId: input.actorUserId,
        },
      });
      if (input.ownerMemberId && input.ownerId) {
        await tx.spaceMember.create({
          data: {
            id: input.ownerMemberId,
            createdById: input.actorUserId,
            organizationId: input.organizationId,
            role: "SPACE_ADMIN",
            spaceId: space.id,
            updatedById: input.actorUserId,
            userId: input.ownerId,
          },
        });
      }

      const created = {
        adminMembership: toSpaceMember(adminMembership),
        space: toSpace(space),
      };

      await inTransaction?.(tx, created);

      return created;
    });

    return result;
  }

  async addMember(input: AddSpaceMemberInput) {
    const member = await this.prisma.client.spaceMember.create({
      data: {
        id: input.id,
        createdById: input.createdById,
        organizationId: input.organizationId,
        role: input.role,
        spaceId: input.spaceId,
        updatedById: input.createdById,
        userId: input.userId,
      },
      include: {
        user: true,
      },
    });

    return toSpaceMemberWithUser(member);
  }

  async findAccessibleById(
    userId: string,
    spaceId: string,
  ): Promise<SpaceAccess | undefined> {
    const member = await this.prisma.client.spaceMember.findFirst({
      include: {
        space: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        status: "ACTIVE",
        userId,
        organization: {
          deletedAt: null,
          members: {
            some: {
              deletedAt: null,
              status: "ACTIVE",
              userId,
            },
          },
          status: "ACTIVE",
        },
        space: {
          deletedAt: null,
          status: "ACTIVE",
        },
      },
    });

    return member
      ? {
          space: toSpace(member.space),
          role: member.role,
        }
      : undefined;
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<{ id: string } | undefined> {
    const space = await this.prisma.client.space.findFirst({
      select: {
        id: true,
      },
      where: {
        code,
        deletedAt: null,
        organizationId,
      },
    });

    return space ?? undefined;
  }

  async findMemberById(spaceId: string, memberId: string) {
    const member = await this.prisma.client.spaceMember.findFirst({
      include: {
        user: true,
      },
      where: {
        deletedAt: null,
        id: memberId,
        spaceId,
      },
    });

    return member ? toSpaceMemberWithUser(member) : undefined;
  }

  async findMemberByUserId(spaceId: string, userId: string) {
    const member = await this.prisma.client.spaceMember.findFirst({
      include: {
        user: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        userId,
      },
    });

    return member ? toSpaceMemberWithUser(member) : undefined;
  }

  async listByOrganizationId(
    organizationId: string,
    input: SpaceListInput,
    accessibleByUserId?: string,
  ): Promise<SpaceListResult> {
    const where = {
      deletedAt: null,
      organizationId,
      status: input.status,
      members: accessibleByUserId
        ? {
            some: {
              deletedAt: null,
              status: "ACTIVE" as const,
              userId: accessibleByUserId,
            },
          }
        : undefined,
    };
    const [spaces, total] = await this.prisma.client.$transaction([
      this.prisma.client.space.findMany({
        include: {
          owner: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.space.count({
        where,
      }),
    ]);

    if (spaces.length === 0) {
      return {
        items: [],
        total,
      };
    }

    const spaceIds = spaces.map((space) => space.id);
    const aggregateActorUserId = getAggregateActorUserId(
      input,
      accessibleByUserId,
    );
    const aggregateAccessContext = aggregateActorUserId
      ? await this.resolveViewAccessContext({
          actorUserId: aggregateActorUserId,
          organizationId,
        })
      : undefined;
    const baseWorkItemWhere = {
      deletedAt: null,
      organizationId,
      spaceId: {
        in: spaceIds,
      },
    } satisfies Prisma.WorkItemWhereInput;
    const visibleWorkItemWhere = aggregateAccessContext
      ? andWorkItemWhere(
          buildVisibleWorkItemWhere(aggregateAccessContext, {
            organizationId,
          }),
          {
            spaceId: {
              in: spaceIds,
            },
          },
        )
      : baseWorkItemWhere;
    const nonTerminalWorkItemWhere = andWorkItemWhere(visibleWorkItemWhere, {
      statusCategory: {
        notIn: TERMINAL_STATUS_CATEGORIES,
      },
    });
    const [
      unfinishedTaskCounts,
      openBugCounts,
      blockedCounts,
      currentVersionBySpaceId,
    ] = await Promise.all([
      this.countWorkItemsBySpaceId(
        andWorkItemWhere(nonTerminalWorkItemWhere, {
          type: "TASK",
        }),
      ),
      this.countWorkItemsBySpaceId(
        andWorkItemWhere(nonTerminalWorkItemWhere, {
          type: "BUG",
        }),
      ),
      this.countWorkItemsBySpaceId(
        andWorkItemWhere(nonTerminalWorkItemWhere, blockedWorkItemWhere()),
      ),
      this.listCurrentVersionsBySpaceId(organizationId, spaceIds),
    ]);
    const visibleCurrentVersionBySpaceId = aggregateAccessContext
      ? await this.withVisibleVersionSummaryStatsBySpaceId(
          currentVersionBySpaceId,
          aggregateAccessContext,
        )
      : currentVersionBySpaceId;

    return {
      items: spaces.map((space) =>
        toSpaceSummary(space, {
          blockedCount: blockedCounts.get(space.id) ?? 0,
          currentVersion: visibleCurrentVersionBySpaceId.get(space.id),
          openBugCount: openBugCounts.get(space.id) ?? 0,
          unfinishedTaskCount: unfinishedTaskCounts.get(space.id) ?? 0,
        }),
      ),
      total,
    };
  }

  private async countWorkItemsBySpaceId(where: Prisma.WorkItemWhereInput) {
    const groups = await this.prisma.client.workItem.groupBy({
      by: ["spaceId"],
      _count: {
        _all: true,
      },
      where,
    });

    return new Map(groups.map((group) => [group.spaceId, group._count._all]));
  }

  private async listCurrentVersionsBySpaceId(
    organizationId: string,
    spaceIds: string[],
  ) {
    const versions = await this.prisma.client.version.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      where: {
        deletedAt: null,
        organizationId,
        spaceId: {
          in: spaceIds,
        },
        status: "IN_PROGRESS",
      },
    });
    const currentVersionBySpaceId = new Map<string, VersionSummary>();

    for (const version of versions) {
      if (!currentVersionBySpaceId.has(version.spaceId)) {
        currentVersionBySpaceId.set(version.spaceId, toVersionSummary(version));
      }
    }

    return currentVersionBySpaceId;
  }

  private async withVisibleVersionSummaryStatsBySpaceId(
    versionsBySpaceId: Map<string, VersionSummary>,
    context: ViewAccessContext,
  ) {
    const entries = await Promise.all(
      [...versionsBySpaceId.entries()].map(
        async ([spaceId, version]) =>
          [
            spaceId,
            await this.withVisibleVersionSummaryStats(version, context),
          ] as const,
      ),
    );

    return new Map(entries);
  }

  async listMembers(
    spaceId: string,
    input: SpaceMemberListInput,
  ): Promise<SpaceMemberListResult> {
    const where = {
      deletedAt: null,
      role: input.role,
      spaceId,
      status: input.status,
    };
    const [members, total] = await this.prisma.client.$transaction([
      this.prisma.client.spaceMember.findMany({
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.spaceMember.count({
        where,
      }),
    ]);

    return {
      items: members.map((member) => toSpaceMemberWithUser(member)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async update(input: UpdateSpaceInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.space.updateMany({
        data: {
          code: input.code,
          description: input.description,
          name: input.name,
          ownerId: input.ownerId,
          staleThresholdDays: input.staleThresholdDays,
          status: input.status,
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.spaceId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      return tx.space.findFirst({
        where: {
          deletedAt: null,
          id: input.spaceId,
        },
      });
    });

    return updated ? toSpace(updated) : undefined;
  }

  async updateMember(input: UpdateSpaceMemberInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.spaceMember.updateMany({
        data: {
          role: input.role,
          status: input.status,
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.memberId,
          spaceId: input.spaceId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      return tx.spaceMember.findFirst({
        include: {
          user: true,
        },
        where: {
          deletedAt: null,
          id: input.memberId,
          spaceId: input.spaceId,
        },
      });
    });

    return updated ? toSpaceMemberWithUser(updated) : undefined;
  }

  async getMyWorkbenchView(
    input: MyWorkbenchViewInput,
  ): Promise<GetMyWorkbenchViewResponse> {
    const context = await this.resolveViewAccessContext({
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
    });

    if (context.spaceIds.length === 0) {
      return emptyWorkbenchResponse(input);
    }

    const now = new Date();
    const staleThresholdDays = minStaleThresholdDays(context.accesses);
    const visibleWhere = buildVisibleWorkItemWhere(context, {
      organizationId: input.organizationId,
      versionId: input.versionId,
    });
    const filteredVisibleWhere = andWorkItemWhere(
      visibleWhere,
      workbenchWorkItemFilterWhere(input, context, now),
    );
    const nonTerminalWhere = andWorkItemWhere(filteredVisibleWhere, {
      statusCategory: {
        notIn: TERMINAL_STATUS_CATEGORIES,
      },
    });
    const participantIds = context.participantWorkItemIds;
    const myTodoWhere = andWorkItemWhere(nonTerminalWhere, {
      OR: [
        {
          assigneeId: input.actorUserId,
        },
        {
          reporterId: input.actorUserId,
        },
        ...(participantIds.length > 0
          ? [
              {
                id: {
                  in: participantIds,
                },
              },
            ]
          : []),
      ],
    });
    const dueSoonEnd = addDays(now, DUE_SOON_DAYS);

    const [
      myTodos,
      assignedTasks,
      assignedBugs,
      pendingConfirm,
      dueSoon,
      blocked,
      actionTodos,
      recentActivities,
      stats,
    ] = await Promise.all([
      this.pageWorkItemSummaries(myTodoWhere, input, context, now),
      this.pageWorkItemSummaries(
        andWorkItemWhere(nonTerminalWhere, {
          assigneeId: input.actorUserId,
          type: "TASK",
        }),
        input,
        context,
        now,
      ),
      this.pageWorkItemSummaries(
        andWorkItemWhere(nonTerminalWhere, {
          assigneeId: input.actorUserId,
          type: "BUG",
        }),
        input,
        context,
        now,
      ),
      this.pageWorkItemSummaries(
        andWorkItemWhere(nonTerminalWhere, pendingConfirmWhere()),
        input,
        context,
        now,
      ),
      this.pageWorkItemSummaries(
        andWorkItemWhere(nonTerminalWhere, {
          dueDate: {
            gte: now,
            lte: dueSoonEnd,
          },
        }),
        input,
        context,
        now,
      ),
      this.pageWorkItemSummaries(
        andWorkItemWhere(nonTerminalWhere, blockedWorkItemWhere()),
        input,
        context,
        now,
      ),
      this.pageActionTodos(nonTerminalWhere, input, context, now),
      this.pageRecentActivities(
        context,
        input,
        input.organizationId,
        hasWorkbenchScopeFilters(input) ? filteredVisibleWhere : undefined,
      ),
      this.getWorkbenchStats(
        nonTerminalWhere,
        input,
        context,
        now,
        staleThresholdDays,
      ),
    ]);

    return {
      filters: removeUndefined({
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        versionId: input.versionId,
        assigneeId: input.assigneeId,
        statusCategory: input.statusCategory,
        workItemType: input.workItemType,
        exceptionType: input.exceptionType,
      }),
      stats: {
        ...stats,
        actionTodoCount: actionTodos.total,
      },
      sections: {
        myTodos: {
          title: "我的待办",
          total: myTodos.total,
          items: myTodos,
        },
        assignedTasks: {
          title: "我负责的任务",
          total: assignedTasks.total,
          items: assignedTasks,
        },
        assignedBugs: {
          title: "我负责的 Bug",
          total: assignedBugs.total,
          items: assignedBugs,
        },
        actionTodos: {
          title: "待我处理的流程动作",
          total: actionTodos.total,
          items: actionTodos,
        },
        pendingConfirm: {
          title: "待确认",
          total: pendingConfirm.total,
          items: pendingConfirm,
        },
        dueSoon: {
          title: "即将到期",
          total: dueSoon.total,
          items: dueSoon,
        },
        blocked: {
          title: "阻塞中",
          total: blocked.total,
          items: blocked,
        },
        recentActivities: {
          title: "最近动态",
          total: recentActivities.total,
          items: recentActivities,
        },
      },
      actionTodos,
    };
  }

  async getSpaceOverviewView(
    input: SpaceOverviewViewInput,
  ): Promise<GetSpaceOverviewViewResponse> {
    const now = new Date();
    const context = await this.resolveViewAccessContext({
      actorUserId: input.actorUserId,
      organizationId: input.space.organizationId,
      spaceId: input.space.id,
    });
    const visibleWhere = buildVisibleWorkItemWhere(context, {
      organizationId: input.space.organizationId,
      versionId: input.versionId,
    });
    const visibleRequirementWhere = buildVisibleRequirementWhere(context, {
      organizationId: input.space.organizationId,
      versionId: input.versionId,
    });
    const nonTerminalWhere = andWorkItemWhere(visibleWhere, {
      statusCategory: {
        notIn: TERMINAL_STATUS_CATEGORIES,
      },
    });
    const staleThresholdDays = input.space.settings.staleThresholdDays;
    const [
      versionCount,
      requirementCount,
      currentVersion,
      defaultWorkflows,
      taskCount,
      completedTaskCount,
      bugCount,
      openBugCount,
      blockedCount,
      overdueCount,
      statusCounts,
      taskStatusCounts,
      bugStatusCounts,
      workItemTypeCounts,
      recentActivities,
      exceptionCounts,
    ] = await Promise.all([
      this.prisma.client.version.count({
        where: {
          deletedAt: null,
          spaceId: input.space.id,
        },
      }),
      this.prisma.client.document.count({
        where: visibleRequirementWhere,
      }),
      input.versionId
        ? this.findVersionById(input.space.id, input.versionId)
        : this.findCurrentVersion(input.space.id),
      this.listDefaultWorkflows(input.space.id),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(visibleWhere, {
          type: "TASK",
        }),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(visibleWhere, {
          statusCategory: "DONE",
          type: "TASK",
        }),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(visibleWhere, {
          type: "BUG",
        }),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(nonTerminalWhere, {
          type: "BUG",
        }),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(nonTerminalWhere, blockedWorkItemWhere()),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(nonTerminalWhere, {
          dueDate: {
            lt: now,
          },
        }),
      }),
      this.groupStatusCounts(visibleWhere),
      this.groupStatusCounts(andWorkItemWhere(visibleWhere, { type: "TASK" })),
      this.groupStatusCounts(andWorkItemWhere(visibleWhere, { type: "BUG" })),
      this.groupWorkItemTypeCounts(visibleWhere),
      this.pageRecentActivities(
        context,
        {
          actorUserId: input.actorUserId,
          organizationId: input.space.organizationId,
          page: 1,
          pageSize: 20,
          versionId: input.versionId,
        },
        input.space.organizationId,
      ),
      this.getExceptionCounts(
        nonTerminalWhere,
        context,
        now,
        staleThresholdDays,
      ),
    ]);
    const visibleCurrentVersion = currentVersion
      ? await this.withVisibleVersionSummaryStats(currentVersion, context)
      : undefined;

    return {
      space: input.space,
      currentVersion: visibleCurrentVersion,
      stats: {
        versionCount,
        requirementCount,
        taskCount,
        completedTaskCount,
        bugCount,
        openBugCount,
        blockedCount,
        overdueCount,
      },
      defaultWorkflows,
      filters: {
        organizationId: input.space.organizationId,
        spaceId: input.space.id,
        versionId: input.versionId,
      },
      statusCounts,
      taskStatusCounts,
      bugStatusCounts,
      workItemTypeCounts,
      exceptionCounts,
      recentActivities,
      staleThresholdDays,
    };
  }

  async getSpaceExceptionsView(
    input: SpaceExceptionsViewInput,
  ): Promise<GetSpaceExceptionsViewResponse> {
    const now = new Date();
    const context = await this.resolveViewAccessContext({
      actorUserId: input.actorUserId,
      organizationId: input.space.organizationId,
      spaceId: input.space.id,
    });

    if (context.spaceIds.length === 0) {
      return emptySpaceExceptionsResponse(input);
    }

    const visibleWhere = buildVisibleWorkItemWhere(context, {
      organizationId: input.space.organizationId,
      versionId: input.versionId,
    });
    const baseWhere = andWorkItemWhere(
      visibleWhere,
      removeUndefined({
        assigneeId: input.assigneeId,
        statusCategory: input.statusCategory,
        type: input.workItemType,
      }),
    );
    const taggedTargetIds = await findTaggedTargetIds(this.prisma.client, {
      spaceId: input.space.id,
      tagIds: input.tagIds,
      tagMatch: input.tagMatch,
      targetType: "WORK_ITEM",
    });
    const taggedBaseWhere = taggedTargetIds
      ? andWorkItemWhere(baseWhere, {
          id: {
            in: taggedTargetIds,
          },
        })
      : baseWhere;
    const nonTerminalWhere = andWorkItemWhere(taggedBaseWhere, {
      statusCategory: {
        notIn: TERMINAL_STATUS_CATEGORIES,
      },
    });
    const itemWhere = andWorkItemWhere(
      nonTerminalWhere,
      exceptionWorkItemWhere(
        input.exceptionType,
        now,
        input.space.settings.staleThresholdDays,
      ),
    );
    const [counts, items] = await Promise.all([
      this.getExceptionCounts(
        nonTerminalWhere,
        context,
        now,
        input.space.settings.staleThresholdDays,
      ),
      this.pageExceptionItems(itemWhere, input, context, now),
    ]);

    return {
      filters: removeUndefined({
        organizationId: input.space.organizationId,
        spaceId: input.space.id,
        versionId: input.versionId,
        assigneeId: input.assigneeId,
        statusCategory: input.statusCategory,
        workItemType: input.workItemType,
        exceptionType: input.exceptionType,
        tagIds: input.tagIds,
        tagMatch: input.tagIds ? input.tagMatch : undefined,
      }),
      counts,
      items,
    };
  }

  async findCurrentVersion(spaceId: string) {
    const version = await this.prisma.client.version.findFirst({
      orderBy: {
        updatedAt: "desc",
      },
      where: {
        deletedAt: null,
        spaceId,
        status: "IN_PROGRESS",
      },
    });

    return version ? toVersionSummary(version) : undefined;
  }

  private async findVersionById(spaceId: string, versionId: string) {
    const version = await this.prisma.client.version.findFirst({
      where: {
        deletedAt: null,
        id: versionId,
        spaceId,
      },
    });

    return version ? toVersionSummary(version) : undefined;
  }

  async listDefaultWorkflows(spaceId: string) {
    const bindings = await this.prisma.client.workflowBinding.findMany({
      include: {
        workflowDefinition: true,
        workflowVersion: {
          include: {
            _count: {
              select: {
                actions: true,
                states: true,
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
        spaceId,
        workflowDefinition: {
          code: {
            in: DEFAULT_WORKFLOW_CODES,
          },
          deletedAt: null,
          status: "ACTIVE",
        },
        workflowVersion: {
          deletedAt: null,
          status: "PUBLISHED",
        },
      },
    });

    return bindings.flatMap((binding) => {
      const summary = toDefaultWorkflowSummary(binding);

      return summary ? [summary] : [];
    });
  }

  private async resolveViewAccessContext(input: {
    actorUserId: string;
    organizationId: string;
    spaceId?: string;
  }): Promise<ViewAccessContext> {
    const accessRecords = await this.prisma.client.spaceMember.findMany({
      include: {
        space: {
          select: {
            id: true,
            organizationId: true,
            ownerId: true,
            staleThresholdDays: true,
          },
        },
      },
      where: {
        deletedAt: null,
        organization: {
          deletedAt: null,
          members: {
            some: {
              deletedAt: null,
              status: "ACTIVE",
              userId: input.actorUserId,
            },
          },
          status: "ACTIVE",
        },
        organizationId: input.organizationId,
        space: {
          deletedAt: null,
          status: "ACTIVE",
        },
        spaceId: input.spaceId,
        status: "ACTIVE",
        user: {
          deletedAt: null,
          status: "ACTIVE",
        },
        userId: input.actorUserId,
      },
    });
    const accesses = accessRecords.map((record) => ({
      organizationId: record.space.organizationId,
      role: record.role,
      spaceId: record.space.id,
      spaceOwnerId: record.space.ownerId ?? undefined,
      staleThresholdDays: record.space.staleThresholdDays,
    }));
    const readAllSpaceIds = accesses
      .filter((access) => canReadAllSpaceWorkItems(access.role))
      .map((access) => access.spaceId);
    const intakeItemReadAllSpaceIds = accesses
      .filter((access) => INTAKE_ITEM_READ_ALL_ROLES.has(access.role))
      .map((access) => access.spaceId);
    const testerSpaceIds = accesses
      .filter((access) => access.role === "TESTER")
      .map((access) => access.spaceId);
    const participantSpaceIds = accesses
      .filter((access) => !canReadAllSpaceWorkItems(access.role))
      .map((access) => access.spaceId);
    const participantTargetIdsByType =
      participantSpaceIds.length === 0
        ? new Map<ObjectParticipantTargetType, string[]>()
        : await this.listParticipantTargetIds(
            input.actorUserId,
            participantSpaceIds,
            ["WORK_ITEM", "INTAKE_ITEM"],
          );
    const participantWorkItemIds =
      participantTargetIdsByType.get("WORK_ITEM") ?? [];
    const participantIntakeItemIds =
      participantTargetIdsByType.get("INTAKE_ITEM") ?? [];
    const testerWorkItemIds =
      testerSpaceIds.length === 0
        ? []
        : await this.listTesterVisibleWorkItemIds(testerSpaceIds);

    return {
      accessBySpaceId: new Map(
        accesses.map((access) => [access.spaceId, access]),
      ),
      accesses,
      participantIntakeItemIds,
      participantSpaceIds,
      participantWorkItemIds,
      readAllSpaceIds,
      intakeItemReadAllSpaceIds,
      spaceIds: accesses.map((access) => access.spaceId),
      testerSpaceIds,
      testerWorkItemIds,
    };
  }

  private async listParticipantTargetIds(
    actorUserId: string,
    spaceIds: string[],
    targetTypes: ObjectParticipantTargetType[],
  ) {
    const participants = await this.prisma.client.objectParticipant.findMany({
      distinct: ["targetType", "targetId"],
      select: {
        targetId: true,
        targetType: true,
      },
      where: {
        deletedAt: null,
        spaceId: {
          in: spaceIds,
        },
        targetType: {
          in: targetTypes,
        },
        userId: actorUserId,
      },
    });
    const idsByType = new Map<ObjectParticipantTargetType, string[]>();

    for (const participant of participants) {
      const current = idsByType.get(participant.targetType) ?? [];

      current.push(participant.targetId);
      idsByType.set(participant.targetType, current);
    }

    return idsByType;
  }

  private async listTesterVisibleWorkItemIds(spaceIds: string[]) {
    const items = await this.prisma.client.workItem.findMany({
      distinct: ["id"],
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId: {
          in: spaceIds,
        },
        ...testerVisibleWorkItemWhere(),
      },
    });

    return items.map((item) => item.id);
  }

  private async pageWorkItemSummaries(
    where: Prisma.WorkItemWhereInput,
    input: Pick<MyWorkbenchViewInput, "page" | "pageSize">,
    context: ViewAccessContext,
    now: Date,
  ): Promise<PageResult<ViewWorkItemSummary>> {
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.workItem.findMany({
        include: {
          bugDetail: {
            select: {
              deletedAt: true,
              regressionAt: true,
            },
          },
          currentState: true,
        },
        orderBy: [
          { priority: "desc" },
          { dueDate: "asc" },
          { createdAt: "desc" },
        ],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.workItem.count({
        where,
      }),
    ]);

    return {
      items: items.map((item) => toViewWorkItemSummary(item, context, now)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  private async pageExceptionItems(
    where: Prisma.WorkItemWhereInput,
    input: Pick<SpaceExceptionsViewInput, "page" | "pageSize">,
    context: ViewAccessContext,
    now: Date,
  ): Promise<GetSpaceExceptionsViewResponse["items"]> {
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.workItem.findMany({
        include: {
          bugDetail: {
            select: {
              deletedAt: true,
              regressionAt: true,
            },
          },
          currentState: true,
        },
        orderBy: [
          { priority: "desc" },
          { dueDate: "asc" },
          { lastStatusChangedAt: "asc" },
          { createdAt: "desc" },
        ],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.workItem.count({
        where,
      }),
    ]);

    const tagsByWorkItemId =
      items.length > 0
        ? await listTagsByTargets(this.prisma.client, {
            organizationId: items[0].organizationId,
            spaceId: items[0].spaceId,
            targetIds: items.map((item) => item.id),
            targetType: "WORK_ITEM",
          })
        : new Map<string, ViewWorkItemSummary["tags"]>();

    return {
      items: items.map((item) => {
        const workItem = {
          ...toViewWorkItemSummary(item, context, now),
          tags: tagsByWorkItemId.get(item.id) ?? [],
        };

        return {
          workItem,
          currentStatus: workItem.currentStatus,
          exceptions: workItem.exceptionSignals,
        };
      }),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  private async pageActionTodos(
    where: Prisma.WorkItemWhereInput,
    input: MyWorkbenchViewInput,
    context: ViewAccessContext,
    now: Date,
  ): Promise<PageResult<WorkbenchActionTodo>> {
    const candidates = await this.prisma.client.workItem.findMany({
      include: {
        bugDetail: {
          select: {
            deletedAt: true,
            regressionAt: true,
          },
        },
        currentState: true,
      },
      orderBy: [{ lastStatusChangedAt: "asc" }, { createdAt: "asc" }],
      where,
    });
    const actionMap = await this.listActionsByState(candidates);
    const todos = candidates.flatMap((workItem) => {
      const access = context.accessBySpaceId.get(workItem.spaceId);

      if (!access) {
        return [];
      }

      const actions = actionMap.get(actionKey(workItem)) ?? [];

      return actions
        .filter((action) =>
          hasActionPermission(input.actorUserId, workItem, action, access),
        )
        .map((action) =>
          toWorkbenchActionTodo(
            input.actorUserId,
            workItem,
            action,
            access,
            context,
            now,
          ),
        );
    });
    const paged = todos.slice(
      (input.page - 1) * input.pageSize,
      input.page * input.pageSize,
    );

    return {
      items: paged,
      page: input.page,
      pageSize: input.pageSize,
      total: todos.length,
    };
  }

  private async listActionsByState(items: ViewWorkItemRecord[]) {
    const keys = unique(items.map(actionKey));
    const actionsByKey = new Map<string, ViewWorkflowActionRecord[]>();

    if (keys.length === 0) {
      return actionsByKey;
    }

    const actions = await this.prisma.client.workflowAction.findMany({
      include: {
        formFields: {
          orderBy: {
            sortOrder: "asc",
          },
          where: {
            deletedAt: null,
          },
        },
      },
      orderBy: {
        sortOrder: "asc",
      },
      where: {
        deletedAt: null,
        OR: keys.map((key) => {
          const [workflowVersionId, fromStateId] = key.split(":");

          return {
            fromStateId,
            workflowVersionId,
          };
        }),
      },
    });

    for (const action of actions) {
      const key = `${action.workflowVersionId}:${action.fromStateId}`;
      const current = actionsByKey.get(key) ?? [];

      current.push(action);
      actionsByKey.set(key, current);
    }

    return actionsByKey;
  }

  private async pageRecentActivities(
    context: ViewAccessContext,
    input: Pick<
      MyWorkbenchViewInput,
      "actorUserId" | "organizationId" | "page" | "pageSize" | "versionId"
    >,
    organizationId: string,
    scopedWorkItemWhere?: Prisma.WorkItemWhereInput,
  ) {
    const where = buildTimelineWhere(context, organizationId);

    if (!where) {
      return {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      };
    }

    const visibleTargets = await this.listVisibleTimelineTargetRefs(
      context,
      {
        organizationId,
        versionId: input.versionId,
      },
      scopedWorkItemWhere,
    );

    if (visibleTargets.length === 0) {
      return {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      };
    }

    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: visibleTargets.map((target) => ({
          targetId: target.id,
          targetType: target.type,
        })),
      },
    ];

    const [events, total] = await this.prisma.client.$transaction([
      this.prisma.client.timelineEvent.findMany({
        include: {
          actor: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.timelineEvent.count({
        where,
      }),
    ]);
    const targetIdentities = await this.findTimelineTargetIdentities(
      events.map((event) => ({
        id: event.targetId,
        type: event.targetType,
      })),
    );

    return {
      items: events.map((event) =>
        toTimelineEvent(event, targetIdentities.get(timelineTargetKey(event))),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  private async findTimelineTargetIdentities(
    targets: Array<{ id: string; type: TargetType }>,
  ) {
    const identities = new Map<string, TimelineTargetIdentityRecord>();
    const idsByType = new Map<TargetType, string[]>();

    for (const target of targets) {
      const current = idsByType.get(target.type) ?? [];

      current.push(target.id);
      idsByType.set(target.type, current);
    }

    if (idsByType.size === 0) {
      return identities;
    }

    const spaceIds = unique(idsByType.get("SPACE") ?? []);
    const workItemIds = unique(idsByType.get("WORK_ITEM") ?? []);
    const documentIds = unique(idsByType.get("DOCUMENT") ?? []);
    const intakeItemIds = unique(idsByType.get("INTAKE_ITEM") ?? []);
    const versionIds = unique(idsByType.get("VERSION") ?? []);
    const [spaces, workItems, documents, intakeItems, versions] =
      await Promise.all([
        spaceIds.length > 0
          ? this.prisma.client.space.findMany({
              select: {
                id: true,
                name: true,
              },
              where: {
                deletedAt: null,
                id: {
                  in: spaceIds,
                },
              },
            })
          : Promise.resolve([]),
        workItemIds.length > 0
          ? this.prisma.client.workItem.findMany({
              select: {
                id: true,
                sequence: true,
                title: true,
                type: true,
              },
              where: {
                deletedAt: null,
                id: {
                  in: workItemIds,
                },
              },
            })
          : Promise.resolve([]),
        documentIds.length > 0
          ? this.prisma.client.document.findMany({
              select: {
                id: true,
                kind: true,
                sequence: true,
                title: true,
              },
              where: {
                deletedAt: null,
                id: {
                  in: documentIds,
                },
              },
            })
          : Promise.resolve([]),
        intakeItemIds.length > 0
          ? this.prisma.client.intakeItem.findMany({
              select: {
                id: true,
                sequence: true,
                title: true,
              },
              where: {
                deletedAt: null,
                id: {
                  in: intakeItemIds,
                },
              },
            })
          : Promise.resolve([]),
        versionIds.length > 0
          ? this.prisma.client.version.findMany({
              select: {
                id: true,
                name: true,
              },
              where: {
                deletedAt: null,
                id: {
                  in: versionIds,
                },
              },
            })
          : Promise.resolve([]),
      ]);

    for (const item of spaces) {
      setTimelineTargetIdentity(identities, "SPACE", item.id, {
        title: item.name,
      });
    }

    for (const item of workItems) {
      setTimelineTargetIdentity(identities, "WORK_ITEM", item.id, {
        sequence: item.sequence,
        title: item.title,
        workItemType: item.type,
      });
    }

    for (const item of documents) {
      setTimelineTargetIdentity(identities, "DOCUMENT", item.id, {
        sequence: item.sequence,
        targetKind:
          item.kind === REQUIREMENT_DOCUMENT_KIND
            ? REQUIREMENT_DOCUMENT_KIND
            : undefined,
        title: item.title,
      });
    }

    for (const item of intakeItems) {
      setTimelineTargetIdentity(identities, "INTAKE_ITEM", item.id, {
        sequence: item.sequence,
        title: item.title,
      });
    }

    for (const item of versions) {
      setTimelineTargetIdentity(identities, "VERSION", item.id, {
        title: item.name,
      });
    }

    return identities;
  }

  private async listVisibleTimelineTargetRefs(
    context: ViewAccessContext,
    filters: {
      organizationId: string;
      versionId?: string;
    },
    scopedWorkItemWhere?: Prisma.WorkItemWhereInput,
  ): Promise<Array<{ id: string; type: TargetType }>> {
    const workItemIds = await this.listVisibleWorkItemIds(
      context,
      filters,
      scopedWorkItemWhere,
    );
    const refs: Array<{ id: string; type: TargetType }> = workItemIds.map(
      (id) => ({
        id,
        type: "WORK_ITEM",
      }),
    );

    if (scopedWorkItemWhere) {
      return refs;
    }

    const nonWorkItemTargets = await this.listVisibleNonWorkItemTimelineTargets(
      context,
      filters,
    );

    return [...refs, ...nonWorkItemTargets];
  }

  private async listVisibleNonWorkItemTimelineTargets(
    context: ViewAccessContext,
    filters: {
      organizationId: string;
      versionId?: string;
    },
  ): Promise<Array<{ id: string; type: TargetType }>> {
    const intakeVisibilityOr = [
      ...(context.intakeItemReadAllSpaceIds.length > 0
        ? [
            {
              spaceId: {
                in: context.intakeItemReadAllSpaceIds,
              },
            },
          ]
        : []),
      ...(context.participantIntakeItemIds.length > 0
        ? [
            {
              id: {
                in: context.participantIntakeItemIds,
              },
            },
          ]
        : []),
    ];
    const [versions, documents, intakeItems] = await Promise.all([
      context.spaceIds.length > 0
        ? this.prisma.client.version.findMany({
            select: {
              id: true,
            },
            where: {
              deletedAt: null,
              id: filters.versionId,
              organizationId: filters.organizationId,
              spaceId: {
                in: context.spaceIds,
              },
            },
          })
        : Promise.resolve([]),
      context.spaceIds.length > 0
        ? this.prisma.client.document.findMany({
            select: {
              id: true,
            },
            where: {
              deletedAt: null,
              organizationId: filters.organizationId,
              spaceId: {
                in: context.spaceIds,
              },
              status: {
                not: "DRAFT",
              },
              versionId: filters.versionId,
            },
          })
        : Promise.resolve([]),
      intakeVisibilityOr.length > 0
        ? this.prisma.client.intakeItem.findMany({
            select: {
              id: true,
            },
            where: {
              deletedAt: null,
              organizationId: filters.organizationId,
              versionId: filters.versionId,
              OR: intakeVisibilityOr,
            },
          })
        : Promise.resolve([]),
    ]);

    return [
      ...(filters.versionId
        ? []
        : context.spaceIds.map((spaceId) => ({
            id: spaceId,
            type: "SPACE" as const,
          }))),
      ...versions.map((version) => ({
        id: version.id,
        type: "VERSION" as const,
      })),
      ...documents.map((document) => ({
        id: document.id,
        type: "DOCUMENT" as const,
      })),
      ...intakeItems.map((item) => ({
        id: item.id,
        type: "INTAKE_ITEM" as const,
      })),
    ];
  }

  private async listVisibleWorkItemIds(
    context: ViewAccessContext,
    filters: {
      organizationId: string;
      versionId?: string;
    },
    whereOverride?: Prisma.WorkItemWhereInput,
  ) {
    const items = await this.prisma.client.workItem.findMany({
      select: {
        id: true,
      },
      where: whereOverride ?? buildVisibleWorkItemWhere(context, filters),
    });

    return items.map((item) => item.id);
  }

  private async getWorkbenchStats(
    where: Prisma.WorkItemWhereInput,
    input: MyWorkbenchViewInput,
    context: ViewAccessContext,
    now: Date,
    staleThresholdDays: number,
  ) {
    const [
      assignedWorkItemCount,
      overdueCount,
      blockedCount,
      pendingConfirmCount,
      pendingRegressionCount,
      staleCount,
    ] = await Promise.all([
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(where, {
          assigneeId: input.actorUserId,
        }),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(where, {
          dueDate: {
            lt: now,
          },
        }),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(where, blockedWorkItemWhere()),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(where, pendingConfirmWhere()),
      }),
      this.prisma.client.workItem.count({
        where: andWorkItemWhere(where, pendingRegressionWhere()),
      }),
      this.countStaleWorkItems(where, context, now, staleThresholdDays),
    ]);

    return {
      assignedWorkItemCount,
      actionTodoCount: 0,
      overdueCount,
      blockedCount,
      pendingConfirmCount,
      pendingRegressionCount,
      staleCount,
    };
  }

  private async groupStatusCounts(where: Prisma.WorkItemWhereInput) {
    const groups = await this.prisma.client.workItem.groupBy({
      by: ["statusCategory"],
      _count: {
        _all: true,
      },
      where,
    });

    return groups.map((group) => ({
      statusCategory: group.statusCategory,
      count: group._count._all,
    }));
  }

  private async groupWorkItemTypeCounts(where: Prisma.WorkItemWhereInput) {
    const groups = await this.prisma.client.workItem.groupBy({
      by: ["type"],
      _count: {
        _all: true,
      },
      where,
    });

    return groups.map((group) => ({
      workItemType: group.type,
      count: group._count._all,
    }));
  }

  private async getExceptionCounts(
    where: Prisma.WorkItemWhereInput,
    context: ViewAccessContext,
    now: Date,
    staleThresholdDays: number,
  ) {
    const [overdue, blocked, pendingConfirm, pendingRegression, stale] =
      await Promise.all([
        this.prisma.client.workItem.count({
          where: andWorkItemWhere(where, {
            dueDate: {
              lt: now,
            },
          }),
        }),
        this.prisma.client.workItem.count({
          where: andWorkItemWhere(where, blockedWorkItemWhere()),
        }),
        this.prisma.client.workItem.count({
          where: andWorkItemWhere(where, pendingConfirmWhere()),
        }),
        this.prisma.client.workItem.count({
          where: andWorkItemWhere(where, pendingRegressionWhere()),
        }),
        this.countStaleWorkItems(where, context, now, staleThresholdDays),
      ]);

    return [
      {
        exceptionType: "overdue" as const,
        count: overdue,
      },
      {
        exceptionType: "blocked" as const,
        count: blocked,
      },
      {
        exceptionType: "pending_confirm" as const,
        count: pendingConfirm,
      },
      {
        exceptionType: "pending_regression" as const,
        count: pendingRegression,
      },
      {
        exceptionType: "stale" as const,
        count: stale,
      },
    ];
  }

  private async countStaleWorkItems(
    where: Prisma.WorkItemWhereInput,
    context: ViewAccessContext,
    now: Date,
    staleThresholdDays: number,
  ) {
    const staleBefore = addDays(now, -staleThresholdDays);
    const candidates = await this.prisma.client.workItem.findMany({
      select: {
        lastStatusChangedAt: true,
        spaceId: true,
      },
      where: andWorkItemWhere(where, {
        lastStatusChangedAt: {
          lte: staleBefore,
        },
      }),
    });

    return candidates.filter((candidate) =>
      isStale(candidate.lastStatusChangedAt, candidate.spaceId, context, now),
    ).length;
  }

  private async withVisibleVersionSummaryStats(
    version: VersionSummary,
    context: ViewAccessContext,
  ): Promise<VersionSummary> {
    const visibleWorkItemWhere = buildVisibleWorkItemWhere(context, {
      organizationId: version.organizationId,
      versionId: version.id,
    });
    const visibleRequirementWhere = buildVisibleRequirementWhere(context, {
      organizationId: version.organizationId,
      versionId: version.id,
    });
    const [requirementCount, taskCount, bugCount, blockedCount] =
      await Promise.all([
        this.prisma.client.document.count({
          where: visibleRequirementWhere,
        }),
        this.prisma.client.workItem.count({
          where: andWorkItemWhere(visibleWorkItemWhere, {
            type: "TASK",
          }),
        }),
        this.prisma.client.workItem.count({
          where: andWorkItemWhere(visibleWorkItemWhere, {
            type: "BUG",
          }),
        }),
        this.prisma.client.workItem.count({
          where: andWorkItemWhere(visibleWorkItemWhere, blockedWorkItemWhere()),
        }),
      ]);

    return {
      ...version,
      stats: {
        ...version.stats,
        blockedCount,
        bugCount,
        requirementCount,
        taskCount,
      },
    };
  }
}

type ViewSpaceAccess = {
  organizationId: string;
  role: SpaceRole;
  spaceId: string;
  spaceOwnerId?: string;
  staleThresholdDays: number;
};

type ViewAccessContext = {
  accessBySpaceId: Map<string, ViewSpaceAccess>;
  accesses: ViewSpaceAccess[];
  intakeItemReadAllSpaceIds: string[];
  participantIntakeItemIds: string[];
  participantSpaceIds: string[];
  participantWorkItemIds: string[];
  readAllSpaceIds: string[];
  spaceIds: string[];
  testerSpaceIds: string[];
  testerWorkItemIds: string[];
};

type ViewWorkItemRecord = {
  assigneeId: string | null;
  blockedAt: Date | null;
  blockedReason: string | null;
  bugDetail: {
    deletedAt: Date | null;
    regressionAt: Date | null;
  } | null;
  createdAt: Date;
  createdById: string | null;
  currentState: {
    category: StatusCategory;
    code: string;
    id: string;
    name: string;
  };
  currentStateId: string;
  dueDate: Date | null;
  id: string;
  intakeItemId: string | null;
  lastActionAt: Date | null;
  lastStatusChangedAt: Date;
  organizationId: string;
  priority: ViewWorkItemSummary["priority"];
  reporterId: string;
  requirementId: string | null;
  sequence: number | null;
  spaceId: string;
  statusCategory: StatusCategory;
  title: string;
  type: ViewWorkItemSummary["type"];
  versionId: string | null;
  workflowVersionId: string;
};

type ViewWorkflowActionRecord = {
  actorRelations: WorkflowActorRelation[];
  allowedSpaceRoles: SpaceRole[];
  code: string;
  formFields: Array<{
    fieldType: ActionFormFieldSummary["fieldType"];
    id: string;
    key: string;
    label: string;
    options: string[];
    required: boolean;
    sortOrder: number;
  }>;
  fromStateId: string;
  id: string;
  name: string;
  requiresComment: boolean;
  sortOrder: number;
  toStateId: string;
  workflowVersionId: string;
};

function buildVisibleWorkItemWhere(
  context: ViewAccessContext,
  filters: {
    organizationId: string;
    versionId?: string;
  },
): Prisma.WorkItemWhereInput {
  const visibilityOr: Prisma.WorkItemWhereInput[] = [];

  if (context.readAllSpaceIds.length > 0) {
    visibilityOr.push({
      spaceId: {
        in: context.readAllSpaceIds,
      },
    });
  }

  if (context.testerSpaceIds.length > 0) {
    visibilityOr.push({
      AND: [
        {
          spaceId: {
            in: context.testerSpaceIds,
          },
        },
        testerVisibleWorkItemWhere(),
      ],
    });
  }

  if (context.participantWorkItemIds.length > 0) {
    visibilityOr.push({
      id: {
        in: context.participantWorkItemIds,
      },
    });
  }

  return {
    deletedAt: null,
    organizationId: filters.organizationId,
    spaceId: {
      in: context.spaceIds,
    },
    type: {
      in: ["TASK", "BUG"],
    },
    versionId: filters.versionId,
    ...(visibilityOr.length > 0
      ? {
          OR: visibilityOr,
        }
      : {
          id: {
            in: [],
          },
        }),
  };
}

function buildVisibleRequirementWhere(
  context: ViewAccessContext,
  filters: {
    organizationId: string;
    versionId?: string;
  },
): Prisma.DocumentWhereInput {
  return {
    deletedAt: null,
    kind: REQUIREMENT_DOCUMENT_KIND,
    organizationId: filters.organizationId,
    spaceId: {
      in: context.spaceIds,
    },
    versionId: filters.versionId,
  };
}

function getAggregateActorUserId(
  input: SpaceListInput,
  accessibleByUserId?: string,
) {
  return input.aggregateActorUserId ?? accessibleByUserId;
}

function buildTimelineWhere(
  context: ViewAccessContext,
  organizationId: string,
): Prisma.TimelineEventWhereInput | undefined {
  if (context.spaceIds.length === 0) {
    return undefined;
  }

  return excludeRedundantWorkflowActionEvents({
    deletedAt: null,
    organizationId,
    spaceId: {
      in: context.spaceIds,
    },
    targetType: {
      in: [...RECENT_ACTIVITY_TARGET_TYPES],
    },
  });
}

function andWorkItemWhere(
  left: Prisma.WorkItemWhereInput,
  right: Prisma.WorkItemWhereInput,
): Prisma.WorkItemWhereInput {
  return {
    AND: [left, right],
  };
}

function blockedWorkItemWhere(): Prisma.WorkItemWhereInput {
  return {
    ...workflowStateTokenWhere(SPACE_EXCEPTION_STATE_RULES.blockedTokens),
    statusCategory: nonTerminalStatusWhere(),
  };
}

function pendingRegressionWhere(): Prisma.WorkItemWhereInput {
  return {
    statusCategory: nonTerminalStatusWhere(),
    type: "BUG",
    AND: [
      {
        bugDetail: {
          is: {
            deletedAt: null,
            regressionAt: null,
          },
        },
      },
      {
        OR: [
          workflowStateExactWhere(
            SPACE_EXCEPTION_STATE_RULES.pendingRegressionCodes,
            SPACE_EXCEPTION_STATE_RULES.pendingRegressionNames,
          ),
        ],
      },
    ],
  };
}

function workflowStateExactWhere(
  codes: readonly string[],
  names: readonly string[],
): Prisma.WorkItemWhereInput {
  return {
    currentState: {
      is: {
        OR: [
          ...codes.map((code) => ({
            code: {
              equals: code,
              mode: "insensitive" as const,
            },
          })),
          ...names.map((name) => ({
            name: {
              equals: name,
              mode: "insensitive" as const,
            },
          })),
        ],
      },
    },
  };
}

function pendingConfirmWhere(): Prisma.WorkItemWhereInput {
  return {
    statusCategory: nonTerminalStatusWhere(),
    NOT: pendingRegressionWhere(),
    OR: [
      workflowStateTokenWhere(SPACE_EXCEPTION_STATE_RULES.pendingConfirmTokens),
    ],
  };
}

function staleWorkItemWhere(
  now: Date,
  staleThresholdDays: number,
): Prisma.WorkItemWhereInput {
  return {
    statusCategory: nonTerminalStatusWhere(),
    lastStatusChangedAt: {
      lte: addDays(now, -staleThresholdDays),
    },
  };
}

function staleWorkItemWhereForContext(
  context: ViewAccessContext,
  now: Date,
): Prisma.WorkItemWhereInput {
  return {
    OR: context.accesses.map((access) => ({
      lastStatusChangedAt: {
        lte: addDays(now, -access.staleThresholdDays),
      },
      statusCategory: nonTerminalStatusWhere(),
      spaceId: access.spaceId,
    })),
  };
}

function workbenchWorkItemFilterWhere(
  input: MyWorkbenchViewInput,
  context: ViewAccessContext,
  now: Date,
): Prisma.WorkItemWhereInput {
  const baseWhere = removeUndefined({
    assigneeId: input.assigneeId,
    statusCategory: input.statusCategory,
    type: input.workItemType,
  });

  if (!input.exceptionType) {
    return baseWhere;
  }

  return andWorkItemWhere(
    baseWhere,
    exceptionTypeWhere(
      input.exceptionType,
      now,
      minStaleThresholdDays(context.accesses),
      staleWorkItemWhereForContext(context, now),
    ),
  );
}

function hasWorkbenchScopeFilters(input: MyWorkbenchViewInput) {
  return Boolean(
    input.assigneeId ||
    input.statusCategory ||
    input.workItemType ||
    input.exceptionType,
  );
}

function exceptionWorkItemWhere(
  exceptionType: ViewExceptionType | undefined,
  now: Date,
  staleThresholdDays: number,
  staleWhere?: Prisma.WorkItemWhereInput,
): Prisma.WorkItemWhereInput {
  if (exceptionType) {
    return exceptionTypeWhere(
      exceptionType,
      now,
      staleThresholdDays,
      staleWhere,
    );
  }

  return {
    OR: SPACE_EXCEPTION_TYPES.map((type) =>
      exceptionTypeWhere(type, now, staleThresholdDays, staleWhere),
    ),
  };
}

function exceptionTypeWhere(
  exceptionType: ViewExceptionType,
  now: Date,
  staleThresholdDays: number,
  staleWhere?: Prisma.WorkItemWhereInput,
): Prisma.WorkItemWhereInput {
  switch (exceptionType) {
    case "overdue":
      return {
        dueDate: {
          lt: now,
        },
        statusCategory: nonTerminalStatusWhere(),
      };
    case "blocked":
      return blockedWorkItemWhere();
    case "pending_confirm":
      return pendingConfirmWhere();
    case "pending_regression":
      return pendingRegressionWhere();
    case "stale":
      return staleWhere ?? staleWorkItemWhere(now, staleThresholdDays);
  }
}

function nonTerminalStatusWhere() {
  return {
    notIn: TERMINAL_STATUS_CATEGORIES,
  };
}

function workflowStateTokenWhere(
  tokens: readonly string[],
): Prisma.WorkItemWhereInput {
  return {
    currentState: {
      is: {
        OR: tokens.flatMap((token) => [
          {
            code: {
              contains: token,
              mode: "insensitive" as const,
            },
          },
          {
            name: {
              contains: token,
              mode: "insensitive" as const,
            },
          },
        ]),
      },
    },
  };
}

function timelineTargetKey(target: {
  targetId: string;
  targetType: TargetType;
}) {
  return `${target.targetType}:${target.targetId}`;
}

function setTimelineTargetIdentity(
  identities: Map<string, TimelineTargetIdentityRecord>,
  type: TargetType,
  id: string,
  identity: TimelineTargetIdentityRecord,
) {
  const title = identity.title?.trim();

  if (!title && identity.sequence == null) {
    return;
  }

  identities.set(`${type}:${id}`, {
    ...identity,
    title: title ? identity.title : undefined,
  });
}

function toViewWorkItemSummary(
  record: ViewWorkItemRecord,
  context: ViewAccessContext,
  now: Date,
): ViewWorkItemSummary {
  return {
    id: record.id,
    ...toWorkItemDisplayIdentity(record.type, record.sequence),
    type: record.type,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    versionId: record.versionId ?? undefined,
    requirementId: record.requirementId ?? undefined,
    intakeItemId: record.intakeItemId ?? undefined,
    title: record.title,
    priority: record.priority,
    assigneeId: record.assigneeId ?? undefined,
    reporterId: record.reporterId,
    createdAt: record.createdAt.toISOString(),
    createdById: record.createdById ?? undefined,
    dueDate: record.dueDate?.toISOString(),
    lastActionAt: record.lastActionAt?.toISOString(),
    currentStatus: {
      workflowVersionId: record.workflowVersionId,
      currentStateId: record.currentStateId,
      stateCode: record.currentState.code,
      stateName: record.currentState.name,
      statusCategory: record.currentState.category,
      lastStatusChangedAt: record.lastStatusChangedAt.toISOString(),
      exceptionHints: {
        blocked: isBlockedRecord(record),
        pendingConfirm: isPendingConfirmRecord(record),
        pendingRegression: isPendingRegressionRecord(record),
      },
    },
    exceptionSignals: buildExceptionSignals(record, context, now),
  };
}

function toWorkItemDisplayIdentity(
  type: ViewWorkItemSummary["type"],
  sequence: number | null | undefined,
) {
  return sequence == null
    ? {}
    : {
        sequence,
        displayCode: formatDisplayCode(type, sequence),
      };
}

function buildExceptionSignals(
  record: ViewWorkItemRecord,
  context: ViewAccessContext,
  now: Date,
): ViewExceptionSignal[] {
  return buildSpaceExceptionSignals(record, {
    now,
    staleThresholdDays: staleThresholdForSpace(record.spaceId, context),
  });
}

function toWorkbenchActionTodo(
  actorUserId: string,
  workItem: ViewWorkItemRecord,
  action: ViewWorkflowActionRecord,
  access: ViewSpaceAccess,
  context: ViewAccessContext,
  now: Date,
): WorkbenchActionTodo {
  const currentStatus = toViewWorkItemSummary(
    workItem,
    context,
    now,
  ).currentStatus;
  const reason = resolveActionReason(actorUserId, workItem, action, access);

  return {
    id: `${workItem.id}:${action.id}`,
    workItem: toViewWorkItemSummary(workItem, context, now),
    currentStatus,
    availableAction: toWorkflowActionSummary(action),
    actionTarget: {
      workItemId: workItem.id,
      actionId: action.id,
      executePath: `/work-items/${workItem.id}/actions/${action.id}/execute`,
    },
    reason,
  };
}

function resolveActionReason(
  actorUserId: string,
  workItem: ViewWorkItemRecord,
  action: ViewWorkflowActionRecord,
  access: ViewSpaceAccess,
): {
  code: WorkbenchActionReasonCode;
  description: string;
} {
  if (action.allowedSpaceRoles.includes(access.role)) {
    return {
      code: "SPACE_ROLE_MATCHED",
      description: "当前空间角色允许处理该流程动作",
    };
  }

  if (
    action.actorRelations.includes("ASSIGNEE") &&
    workItem.assigneeId === actorUserId
  ) {
    return {
      code: "ASSIGNED_TO_ME",
      description: "我是该工作项负责人",
    };
  }

  if (
    action.actorRelations.includes("REPORTER") &&
    workItem.reporterId === actorUserId
  ) {
    return {
      code: "REPORTED_BY_ME",
      description: "我是该工作项报告人",
    };
  }

  if (
    action.actorRelations.includes("CREATOR") &&
    workItem.createdById === actorUserId
  ) {
    return {
      code: "EXPLICIT_PARTICIPANT",
      description: "我是该工作项创建人",
    };
  }

  return {
    code: "WORKFLOW_POLICY",
    description: "流程策略允许我处理该动作",
  };
}

function toWorkflowActionSummary(
  action: ViewWorkflowActionRecord,
): WorkflowActionSummary {
  return {
    id: action.id,
    code: action.code,
    name: action.name,
    fromStateId: action.fromStateId,
    toStateId: action.toStateId,
    requiresComment: action.requiresComment,
    formFields: action.formFields.map((field) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      options: field.options.length > 0 ? field.options : undefined,
      order: field.sortOrder,
    })),
    order: action.sortOrder,
  };
}

function hasActionPermission(
  actorUserId: string,
  workItem: ViewWorkItemRecord,
  action: ViewWorkflowActionRecord,
  access: ViewSpaceAccess,
) {
  if (access.role === "VIEWER") {
    return false;
  }

  return (
    action.allowedSpaceRoles.includes(access.role) ||
    action.actorRelations.some((relation) => {
      switch (relation) {
        case "ASSIGNEE":
          return workItem.assigneeId === actorUserId;
        case "REPORTER":
          return workItem.reporterId === actorUserId;
        case "CREATOR":
          return workItem.createdById === actorUserId;
        case "SPACE_OWNER":
          return access.spaceOwnerId === actorUserId;
      }
    })
  );
}

function actionKey(item: ViewWorkItemRecord) {
  return `${item.workflowVersionId}:${item.currentStateId}`;
}

function emptyWorkbenchResponse(
  input: MyWorkbenchViewInput,
): GetMyWorkbenchViewResponse {
  const emptyWorkItems = emptyPage<ViewWorkItemSummary>(input);
  const emptyActionTodos = emptyPage<WorkbenchActionTodo>(input);
  const emptyActivities =
    emptyPage<
      GetMyWorkbenchViewResponse["sections"]["recentActivities"]["items"]["items"][number]
    >(input);

  return {
    filters: removeUndefined({
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      versionId: input.versionId,
      assigneeId: input.assigneeId,
      statusCategory: input.statusCategory,
      workItemType: input.workItemType,
      exceptionType: input.exceptionType,
    }),
    stats: {
      assignedWorkItemCount: 0,
      actionTodoCount: 0,
      overdueCount: 0,
      blockedCount: 0,
      pendingConfirmCount: 0,
      pendingRegressionCount: 0,
      staleCount: 0,
    },
    sections: {
      myTodos: {
        title: "我的待办",
        total: 0,
        items: emptyWorkItems,
      },
      assignedTasks: {
        title: "我负责的任务",
        total: 0,
        items: emptyWorkItems,
      },
      assignedBugs: {
        title: "我负责的 Bug",
        total: 0,
        items: emptyWorkItems,
      },
      actionTodos: {
        title: "待我处理的流程动作",
        total: 0,
        items: emptyActionTodos,
      },
      pendingConfirm: {
        title: "待确认",
        total: 0,
        items: emptyWorkItems,
      },
      dueSoon: {
        title: "即将到期",
        total: 0,
        items: emptyWorkItems,
      },
      blocked: {
        title: "阻塞中",
        total: 0,
        items: emptyWorkItems,
      },
      recentActivities: {
        title: "最近动态",
        total: 0,
        items: emptyActivities,
      },
    },
    actionTodos: emptyActionTodos,
  };
}

function emptySpaceExceptionsResponse(
  input: Pick<
    SpaceExceptionsViewInput,
    | "assigneeId"
    | "exceptionType"
    | "page"
    | "pageSize"
    | "space"
    | "statusCategory"
    | "tagIds"
    | "tagMatch"
    | "versionId"
    | "workItemType"
  >,
): GetSpaceExceptionsViewResponse {
  return {
    filters: removeUndefined({
      organizationId: input.space.organizationId,
      spaceId: input.space.id,
      versionId: input.versionId,
      assigneeId: input.assigneeId,
      statusCategory: input.statusCategory,
      workItemType: input.workItemType,
      exceptionType: input.exceptionType,
      tagIds: input.tagIds,
      tagMatch: input.tagIds ? input.tagMatch : undefined,
    }),
    counts: SPACE_EXCEPTION_TYPES.map((exceptionType) => ({
      exceptionType,
      count: 0,
    })),
    items: emptyPage(input),
  };
}

function emptyPage<T>(
  input: Pick<MyWorkbenchViewInput, "page" | "pageSize">,
): PageResult<T> {
  return {
    items: [],
    page: input.page,
    pageSize: input.pageSize,
    total: 0,
  };
}

function minStaleThresholdDays(accesses: ViewSpaceAccess[]) {
  return Math.min(...accesses.map((access) => access.staleThresholdDays));
}

function staleThresholdForSpace(spaceId: string, context: ViewAccessContext) {
  return context.accessBySpaceId.get(spaceId)?.staleThresholdDays ?? 3;
}

function isStale(
  lastStatusChangedAt: Date,
  spaceId: string,
  context: ViewAccessContext,
  now: Date,
) {
  return (
    elapsedDays(lastStatusChangedAt, now) >=
    staleThresholdForSpace(spaceId, context)
  );
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);

  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
