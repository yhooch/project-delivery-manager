import { Inject, Injectable } from "@nestjs/common";
import type {
  GetMyWorkbenchViewResponse,
  GetSpaceExceptionsViewResponse,
  GetSpaceOverviewViewResponse,
  PageResult,
  SpaceRole,
  StatusCategory,
  ViewExceptionSignal,
  ViewExceptionType,
  ViewWorkItemSummary,
  WorkbenchActionReasonCode,
  WorkbenchActionTodo,
  WorkflowActionSummary,
} from "@project-delivery/shared";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { toTimelineEvent } from "../timeline/timeline.mappers";
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
  SpaceOverviewViewInput,
  UpdateSpaceInput,
  UpdateSpaceMemberInput,
} from "./space.types";

const DEFAULT_WORKFLOW_CODES = ["DEVELOPMENT_TASK", "GENERAL_TASK", "BUG"];
const TERMINAL_STATUS_CATEGORIES: StatusCategory[] = ["DONE", "TERMINATED"];
const DUE_SOON_DAYS = 7;

@Injectable()
export class PrismaSpaceRepository implements SpaceRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async createWithAdmin(
    input: CreateSpaceInput,
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

      return {
        adminMembership,
        space,
      };
    });

    return {
      space: toSpace(result.space),
      adminMembership: toSpaceMember(result.adminMembership),
    };
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

    return {
      items: spaces.map((space) => toSpaceSummary(space)),
      total,
    };
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
          title: "待我确认",
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
      this.prisma.client.requirement.count({
        where: {
          deletedAt: null,
          spaceId: input.space.id,
          versionId: input.versionId,
        },
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

    return {
      space: input.space,
      currentVersion,
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
    const nonTerminalWhere = andWorkItemWhere(baseWhere, {
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
      filters: {
        organizationId: input.space.organizationId,
        spaceId: input.space.id,
        versionId: input.versionId,
        assigneeId: input.assigneeId,
        statusCategory: input.statusCategory,
        workItemType: input.workItemType,
        exceptionType: input.exceptionType,
      },
      counts,
      items,
    };
  }

  async getOverviewStats(spaceId: string) {
    const [versionCount, requirementCount] =
      await this.prisma.client.$transaction([
        this.prisma.client.version.count({
          where: {
            deletedAt: null,
            spaceId,
          },
        }),
        this.prisma.client.requirement.count({
          where: {
            deletedAt: null,
            spaceId,
          },
        }),
      ]);

    return {
      versionCount,
      requirementCount,
      taskCount: 0,
      completedTaskCount: 0,
      bugCount: 0,
      openBugCount: 0,
      blockedCount: 0,
      overdueCount: 0,
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
    const testerSpaceIds = accesses
      .filter((access) => access.role === "TESTER")
      .map((access) => access.spaceId);
    const participantSpaceIds = accesses
      .filter((access) => !canReadAllSpaceWorkItems(access.role))
      .map((access) => access.spaceId);
    const participantWorkItemIds =
      participantSpaceIds.length === 0
        ? []
        : await this.listParticipantWorkItemIds(
            input.actorUserId,
            participantSpaceIds,
          );
    const testerWorkItemIds =
      testerSpaceIds.length === 0
        ? []
        : await this.listTesterVisibleWorkItemIds(testerSpaceIds);

    return {
      accessBySpaceId: new Map(
        accesses.map((access) => [access.spaceId, access]),
      ),
      accesses,
      participantSpaceIds,
      participantWorkItemIds,
      readAllSpaceIds,
      spaceIds: accesses.map((access) => access.spaceId),
      testerSpaceIds,
      testerWorkItemIds,
    };
  }

  private async listParticipantWorkItemIds(
    actorUserId: string,
    spaceIds: string[],
  ) {
    const participants = await this.prisma.client.objectParticipant.findMany({
      distinct: ["targetId"],
      select: {
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId: {
          in: spaceIds,
        },
        targetType: "WORK_ITEM",
        userId: actorUserId,
      },
    });

    return participants.map((participant) => participant.targetId);
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

    return {
      items: items.map((item) => {
        const workItem = toViewWorkItemSummary(item, context, now);

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

    if (input.versionId || scopedWorkItemWhere) {
      const scopedTargetIds = await this.listVisibleWorkItemIds(
        context,
        {
          organizationId,
          versionId: input.versionId,
        },
        scopedWorkItemWhere,
      );

      if (scopedTargetIds.length === 0) {
        return {
          items: [],
          page: input.page,
          pageSize: input.pageSize,
          total: 0,
        };
      }

      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          targetId: {
            in: scopedTargetIds,
          },
        },
      ];
    }

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
    const targetTitles = await this.findWorkItemTitles(
      unique(events.map((event) => event.targetId)),
    );

    return {
      items: events.map((event) =>
        toTimelineEvent(event, targetTitles.get(event.targetId)),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  private async findWorkItemTitles(workItemIds: string[]) {
    const titles = new Map<string, string>();

    if (workItemIds.length === 0) {
      return titles;
    }

    const items = await this.prisma.client.workItem.findMany({
      select: {
        id: true,
        title: true,
      },
      where: {
        deletedAt: null,
        id: {
          in: workItemIds,
        },
      },
    });

    for (const item of items) {
      titles.set(item.id, item.title);
    }

    return titles;
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
  spaceId: string;
  statusCategory: StatusCategory;
  title: string;
  type: ViewWorkItemSummary["type"];
  versionId: string | null;
  workflowVersionId: string;
};

type ViewWorkflowActionRecord = {
  actorRelations: WorkflowActionSummary["actorRelations"];
  allowedSpaceRoles: WorkflowActionSummary["allowedSpaceRoles"];
  code: string;
  formFields: Array<{
    fieldType: WorkflowActionSummary["formFields"][number]["fieldType"];
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

function buildTimelineWhere(
  context: ViewAccessContext,
  organizationId: string,
): Prisma.TimelineEventWhereInput | undefined {
  const visibilityOr: Prisma.TimelineEventWhereInput[] = [];

  if (context.readAllSpaceIds.length > 0) {
    visibilityOr.push({
      spaceId: {
        in: context.readAllSpaceIds,
      },
      targetType: "WORK_ITEM",
    });
  }

  if (context.participantWorkItemIds.length > 0) {
    visibilityOr.push({
      targetId: {
        in: context.participantWorkItemIds,
      },
      targetType: "WORK_ITEM",
    });
  }

  if (context.testerWorkItemIds.length > 0) {
    visibilityOr.push({
      targetId: {
        in: context.testerWorkItemIds,
      },
      targetType: "WORK_ITEM",
    });
  }

  if (visibilityOr.length === 0) {
    return undefined;
  }

  return {
    deletedAt: null,
    organizationId,
    OR: visibilityOr,
    spaceId: {
      in: context.spaceIds,
    },
  };
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
    OR: [
      {
        blockedAt: {
          not: null,
        },
      },
      {
        blockedReason: {
          not: null,
        },
      },
    ],
  };
}

function pendingRegressionWhere(): Prisma.WorkItemWhereInput {
  return {
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
      workflowStateTokenWhere("regression"),
    ],
  };
}

function pendingConfirmWhere(): Prisma.WorkItemWhereInput {
  return workflowStateTokenWhere("confirm");
}

function staleWorkItemWhere(
  now: Date,
  staleThresholdDays: number,
): Prisma.WorkItemWhereInput {
  return {
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
    input.versionId ||
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

function workflowStateTokenWhere(token: string): Prisma.WorkItemWhereInput {
  return {
    currentState: {
      is: {
        OR: [
          {
            code: {
              contains: token,
              mode: "insensitive",
            },
          },
          {
            name: {
              contains: token,
              mode: "insensitive",
            },
          },
        ],
      },
    },
  };
}

function toViewWorkItemSummary(
  record: ViewWorkItemRecord,
  context: ViewAccessContext,
  now: Date,
): ViewWorkItemSummary {
  return {
    id: record.id,
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
    allowedSpaceRoles: action.allowedSpaceRoles,
    actorRelations: action.actorRelations,
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
        title: "待我确认",
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
    | "versionId"
    | "workItemType"
  >,
): GetSpaceExceptionsViewResponse {
  return {
    filters: {
      organizationId: input.space.organizationId,
      spaceId: input.space.id,
      versionId: input.versionId,
      assigneeId: input.assigneeId,
      statusCategory: input.statusCategory,
      workItemType: input.workItemType,
      exceptionType: input.exceptionType,
    },
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
