import { Inject, Injectable } from "@nestjs/common";
import type { ObjectParticipantTargetType } from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { toVersion, toVersionBoardWorkItemSummary } from "./version.mappers";
import { testerVisibleWorkItemWhere } from "../workitem/workitem-visibility";
import type { VersionRepository } from "./version.repository";
import type {
  CreateVersionInput,
  UpdateVersionInput,
  VersionBoardInput,
  VersionBoardWorkItemRecord,
  VersionListInput,
  VersionListResult,
  VersionStatsScope,
} from "./version.types";

const BOARD_STATUS_CATEGORIES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
] as const;

const BOARD_STATUS_TITLES = {
  DONE: "Done",
  IN_PROGRESS: "In progress",
  NOT_STARTED: "Not started",
  TERMINATED: "Terminated",
  VERIFYING: "Verifying",
  WAITING: "Waiting",
} as const;
const BLOCKED_STATE_TOKENS = ["blocked", "阻塞"] as const;

@Injectable()
export class PrismaVersionRepository implements VersionRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateVersionInput) {
    const version = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.version.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          name: input.name,
          target: input.target,
          description: input.description,
          ownerId: input.ownerId,
          status: input.status,
          startDate: input.startDate,
          targetDate: input.targetDate,
          releaseDate: input.releaseDate,
          createdById: input.createdById,
          updatedById: input.createdById,
        },
      });

      await createTimelineEvent(tx, {
        actorUserId: input.createdById,
        after: versionTimelineSnapshot(created),
        eventType: "CREATED",
        organizationId: created.organizationId,
        spaceId: created.spaceId,
        targetId: created.id,
        title: "创建版本",
      });

      return created;
    });

    return this.toVersionWithStats(version);
  }

  async findById(versionId: string, statsScope?: VersionStatsScope) {
    const version = await this.prisma.client.version.findFirst({
      where: {
        deletedAt: null,
        id: versionId,
      },
    });

    return version ? this.toVersionWithStats(version, statsScope) : undefined;
  }

  async findByName(spaceId: string, name: string) {
    const version = await this.prisma.client.version.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        name,
        spaceId,
      },
    });

    return version ?? undefined;
  }

  async listBySpaceId(
    spaceId: string,
    input: VersionListInput,
  ): Promise<VersionListResult> {
    const where = {
      deletedAt: null,
      ownerId: input.ownerId,
      spaceId,
      status: input.status,
    };
    const [versions, total] = await this.prisma.client.$transaction([
      this.prisma.client.version.findMany({
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.version.count({
        where,
      }),
    ]);
    const stats = await this.countStatsByVersionIds(
      versions.map((version) => version.id),
      {
        actorUserId: input.actorUserId,
        spaceId,
        visibility: input.visibility,
      },
    );

    return {
      items: versions.map((version) =>
        toVersion(version, stats.get(version.id)),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async listBoard(input: VersionBoardInput) {
    const where = await this.buildBoardWhere(input);

    if (!where) {
      return {
        columns: toBoardColumns([]),
        items: {
          items: [],
          page: input.page,
          pageSize: input.pageSize,
          total: 0,
        },
      };
    }

    const [items, total, counts] = await this.prisma.client.$transaction([
      this.prisma.client.workItem.findMany({
        include: {
          bugDetail: {
            select: {
              deletedAt: true,
              regressionAt: true,
            },
          },
          currentState: {
            select: {
              category: true,
              code: true,
              name: true,
            },
          },
        },
        orderBy: buildBoardOrderBy(input),
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
        where,
      }),
    ]);
    const now = new Date();

    return {
      columns: toBoardColumns(
        counts.map((count) => ({
          count: count._count._all,
          statusCategory: count.statusCategory,
        })),
      ),
      items: {
        items: items.map((item) =>
          toVersionBoardWorkItemSummary(item as VersionBoardWorkItemRecord, {
            now,
            staleThresholdDays: input.staleThresholdDays,
          }),
        ),
        page: input.page,
        pageSize: input.pageSize,
        total,
      },
    };
  }

  async update(input: UpdateVersionInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const previous = await tx.version.findFirst({
        where: {
          deletedAt: null,
          id: input.versionId,
        },
      });

      if (!previous) {
        return undefined;
      }

      const result = await tx.version.updateMany({
        data: {
          name: input.name,
          target: input.target,
          description: input.description,
          ownerId: input.ownerId,
          status: input.status,
          startDate: input.startDate,
          targetDate: input.targetDate,
          releaseDate: input.releaseDate,
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.versionId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const version = await tx.version.findFirst({
        where: {
          deletedAt: null,
          id: input.versionId,
        },
      });

      if (!version) {
        return undefined;
      }

      await createTimelineEvent(tx, {
        actorUserId: input.updatedById,
        after: versionTimelineSnapshot(version),
        before: versionTimelineSnapshot(previous),
        eventType:
          input.status && input.status !== previous.status
            ? "STATUS_CHANGED"
            : "UPDATED",
        organizationId: version.organizationId,
        spaceId: version.spaceId,
        targetId: version.id,
        title:
          input.status && input.status !== previous.status
            ? "更新版本状态"
            : "更新版本",
      });

      return version;
    });

    return updated ? this.toVersionWithStats(updated) : undefined;
  }

  private async toVersionWithStats(
    version: Parameters<typeof toVersion>[0],
    statsScope?: VersionStatsScope,
  ) {
    const stats = await this.countStatsByVersionIds([version.id], statsScope);

    return toVersion(version, stats.get(version.id));
  }

  private async countStatsByVersionIds(
    versionIds: string[],
    statsScope?: VersionStatsScope,
  ) {
    const stats = new Map<
      string,
      {
        blockedCount: number;
        bugCount: number;
        requirementCount: number;
        taskCount: number;
      }
    >();

    if (versionIds.length === 0) {
      return stats;
    }

    for (const versionId of versionIds) {
      stats.set(versionId, {
        blockedCount: 0,
        bugCount: 0,
        requirementCount: 0,
        taskCount: 0,
      });
    }

    const participantTargetIdsByType =
      statsScope && statsScope.visibility !== "SPACE"
        ? await this.listParticipantTargetIds(
            statsScope.spaceId,
            statsScope.actorUserId,
            ["WORK_ITEM", "REQUIREMENT"],
          )
        : new Map<ObjectParticipantTargetType, string[]>();
    const participantRequirementIds =
      participantTargetIdsByType.get("REQUIREMENT") ?? [];
    const participantWorkItemIds =
      participantTargetIdsByType.get("WORK_ITEM") ?? [];
    const requirementWhere = versionStatsRequirementWhere(
      versionIds,
      statsScope,
      participantRequirementIds,
    );
    const workItemWhere = versionStatsWorkItemWhere(
      versionIds,
      statsScope,
      participantWorkItemIds,
    );

    const [requirementGroups, workItemGroups, blockedGroups] =
      await Promise.all([
        this.prisma.client.requirement.groupBy({
          by: ["versionId"],
          _count: {
            _all: true,
          },
          where: requirementWhere,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["versionId", "type"],
          _count: {
            _all: true,
          },
          where: workItemWhere,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["versionId"],
          _count: {
            _all: true,
          },
          where: {
            AND: [
              workItemWhere,
              {
                OR: blockedWorkItemWhere(),
              },
            ],
          },
        }),
      ]);

    for (const group of requirementGroups) {
      const current = group.versionId ? stats.get(group.versionId) : undefined;

      if (group.versionId && current) {
        stats.set(group.versionId, {
          ...current,
          requirementCount: group._count._all,
        });
      }
    }

    for (const group of workItemGroups) {
      if (!group.versionId) {
        continue;
      }

      const current = stats.get(group.versionId);

      if (!current) {
        continue;
      }

      stats.set(group.versionId, {
        ...current,
        bugCount: group.type === "BUG" ? group._count._all : current.bugCount,
        taskCount:
          group.type === "TASK" ? group._count._all : current.taskCount,
      });
    }

    for (const group of blockedGroups) {
      const current = group.versionId ? stats.get(group.versionId) : undefined;

      if (group.versionId && current) {
        stats.set(group.versionId, {
          ...current,
          blockedCount: group._count._all,
        });
      }
    }

    return stats;
  }

  private async buildBoardWhere(
    input: VersionBoardInput,
  ): Promise<Prisma.WorkItemWhereInput | undefined> {
    const workItemTypeConstraints = buildWorkItemTypeConstraints(
      input.workItemType,
    );
    const where: Prisma.WorkItemWhereInput = {
      assigneeId: input.assigneeId,
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      statusCategory: input.statusCategory,
      type: input.workItemType,
      versionId: input.versionId,
      AND:
        workItemTypeConstraints.length > 0
          ? workItemTypeConstraints
          : undefined,
    };

    if (input.visibility === "PARTICIPANT") {
      const visibleIds = await this.listParticipantWorkItemIds(
        input.spaceId,
        input.actorUserId,
      );

      if (visibleIds.length === 0) {
        return undefined;
      }

      where.id = {
        in: visibleIds,
      };
    }

    if (input.visibility === "TESTER") {
      const visibleIds = await this.listParticipantWorkItemIds(
        input.spaceId,
        input.actorUserId,
      );
      const visibilityOr: Prisma.WorkItemWhereInput[] = [
        testerVisibleWorkItemWhere(),
      ];

      if (visibleIds.length > 0) {
        visibilityOr.push({
          id: {
            in: visibleIds,
          },
        });
      }

      where.AND = [...toArray(where.AND), { OR: visibilityOr }];
    }

    return where;
  }

  private async listParticipantWorkItemIds(spaceId: string, userId: string) {
    const participantTargetIdsByType = await this.listParticipantTargetIds(
      spaceId,
      userId,
      ["WORK_ITEM"],
    );

    return participantTargetIdsByType.get("WORK_ITEM") ?? [];
  }

  private async listParticipantTargetIds(
    spaceId: string,
    userId: string,
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
        spaceId,
        targetType: {
          in: targetTypes,
        },
        userId,
      },
    });
    const idsByType = new Map<ObjectParticipantTargetType, string[]>();

    for (const participant of participants) {
      const ids = idsByType.get(participant.targetType) ?? [];
      ids.push(participant.targetId);
      idsByType.set(participant.targetType, ids);
    }

    return new Map(
      Array.from(idsByType, ([targetType, targetIds]) => [
        targetType,
        Array.from(new Set(targetIds)),
      ]),
    );
  }
}

function buildWorkItemTypeConstraints(
  workItemType: VersionBoardInput["workItemType"],
): Prisma.WorkItemWhereInput[] {
  if (workItemType === "BUG") {
    return [
      {
        bugDetail: {
          is: {
            deletedAt: null,
          },
        },
      },
    ];
  }

  if (workItemType === "TASK") {
    return [];
  }

  return [
    {
      OR: [
        {
          type: "TASK",
        },
        {
          bugDetail: {
            is: {
              deletedAt: null,
            },
          },
          type: "BUG",
        },
      ],
    },
  ];
}

function versionStatsWorkItemWhere(
  versionIds: string[],
  statsScope?: VersionStatsScope,
  participantWorkItemIds: string[] = [],
): Prisma.WorkItemWhereInput {
  const baseWhere: Prisma.WorkItemWhereInput = {
    deletedAt: null,
    ...(statsScope ? { spaceId: statsScope.spaceId } : {}),
    versionId: {
      in: versionIds,
    },
    OR: [
      {
        type: "TASK",
      },
      {
        bugDetail: {
          is: {
            deletedAt: null,
          },
        },
        type: "BUG",
      },
    ],
  };

  if (!statsScope || statsScope.visibility === "SPACE") {
    return baseWhere;
  }

  if (statsScope.visibility === "TESTER") {
    const visibilityOr: Prisma.WorkItemWhereInput[] = [
      testerVisibleWorkItemWhere(),
    ];

    if (participantWorkItemIds.length > 0) {
      visibilityOr.push({
        id: {
          in: participantWorkItemIds,
        },
      });
    }

    return {
      AND: [baseWhere, { OR: visibilityOr }],
    };
  }

  return {
    AND: [
      baseWhere,
      {
        id: {
          in: participantWorkItemIds,
        },
      },
    ],
  };
}

function versionStatsRequirementWhere(
  versionIds: string[],
  statsScope?: VersionStatsScope,
  participantRequirementIds: string[] = [],
): Prisma.RequirementWhereInput {
  const baseWhere: Prisma.RequirementWhereInput = {
    deletedAt: null,
    ...(statsScope ? { spaceId: statsScope.spaceId } : {}),
    versionId: {
      in: versionIds,
    },
  };

  if (!statsScope || statsScope.visibility === "SPACE") {
    return baseWhere;
  }

  return {
    ...baseWhere,
    id: {
      in: participantRequirementIds,
    },
  };
}

function blockedWorkItemWhere(): Prisma.WorkItemWhereInput[] {
  return [
    {
      currentState: {
        is: {
          OR: BLOCKED_STATE_TOKENS.flatMap((token) => [
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
    },
  ];
}

function buildBoardOrderBy(
  input: VersionBoardInput,
): Prisma.WorkItemOrderByWithRelationInput[] {
  const sortOrder = input.sortOrder ?? "asc";

  switch (input.sortBy) {
    case "dueDate":
      return [{ dueDate: sortOrder }, { createdAt: "asc" }];
    case "lastStatusChangedAt":
      return [{ lastStatusChangedAt: sortOrder }, { createdAt: "asc" }];
    case "priority":
      return [{ priority: sortOrder }, { createdAt: "asc" }];
    case "title":
      return [{ title: sortOrder }, { createdAt: "asc" }];
    case "createdAt":
    default:
      return [{ createdAt: sortOrder }];
  }
}

function toBoardColumns(
  counts: {
    statusCategory: (typeof BOARD_STATUS_CATEGORIES)[number];
    count: number;
  }[],
) {
  const countByStatus = new Map(
    counts.map((count) => [count.statusCategory, count.count]),
  );

  return BOARD_STATUS_CATEGORIES.map((statusCategory) => ({
    statusCategory,
    title: BOARD_STATUS_TITLES[statusCategory],
    total: countByStatus.get(statusCategory) ?? 0,
  }));
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

type VersionTimelineRecord = {
  description: string | null;
  name: string;
  ownerId: string | null;
  releaseDate: Date | null;
  startDate: Date | null;
  status: string;
  target: string | null;
  targetDate: Date | null;
};

function versionTimelineSnapshot(record: VersionTimelineRecord) {
  return {
    description: record.description ?? null,
    name: record.name,
    ownerId: record.ownerId ?? null,
    releaseDate: record.releaseDate?.toISOString() ?? null,
    startDate: record.startDate?.toISOString() ?? null,
    status: record.status,
    target: record.target ?? null,
    targetDate: record.targetDate?.toISOString() ?? null,
  };
}

async function createTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    after?: Record<string, unknown>;
    before?: Record<string, unknown>;
    eventType: "CREATED" | "STATUS_CHANGED" | "UPDATED";
    organizationId: string;
    spaceId: string;
    targetId: string;
    title: string;
  },
) {
  await tx.timelineEvent.create({
    data: {
      id: ulid(),
      actorId: input.actorUserId,
      after: toJson(input.after),
      before: toJson(input.before),
      createdById: input.actorUserId,
      eventType: input.eventType,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "VERSION",
      title: input.title,
      updatedById: input.actorUserId,
    },
  });
}

function toJson(value: Record<string, unknown> | undefined) {
  return value && Object.keys(value).length > 0
    ? (value as Prisma.InputJsonObject)
    : undefined;
}
