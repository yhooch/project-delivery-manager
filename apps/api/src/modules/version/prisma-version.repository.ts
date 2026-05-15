import { Inject, Injectable } from "@nestjs/common";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  toVersion,
  toVersionBoardWorkItemSummary,
} from "./version.mappers";
import { testerVisibleWorkItemWhere } from "../workitem/workitem-visibility";
import type { VersionRepository } from "./version.repository";
import type {
  CreateVersionInput,
  UpdateVersionInput,
  VersionBoardInput,
  VersionBoardWorkItemRecord,
  VersionListInput,
  VersionListResult,
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

@Injectable()
export class PrismaVersionRepository implements VersionRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateVersionInput) {
    const version = await this.prisma.client.version.create({
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

    return this.toVersionWithRequirementCount(version);
  }

  async findById(versionId: string) {
    const version = await this.prisma.client.version.findFirst({
      where: {
        deletedAt: null,
        id: versionId,
      },
    });

    return version ? this.toVersionWithRequirementCount(version) : undefined;
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
    const requirementCounts = await this.countRequirementsByVersionIds(
      versions.map((version) => version.id),
    );

    return {
      items: versions.map((version) =>
        toVersion(version, {
          requirementCount: requirementCounts.get(version.id) ?? 0,
        }),
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
          toVersionBoardWorkItemSummary(
            item as VersionBoardWorkItemRecord,
            {
              now,
              staleThresholdDays: input.staleThresholdDays,
            },
          ),
        ),
        page: input.page,
        pageSize: input.pageSize,
        total,
      },
    };
  }

  async update(input: UpdateVersionInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
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

      return tx.version.findFirst({
        where: {
          deletedAt: null,
          id: input.versionId,
        },
      });
    });

    return updated ? this.toVersionWithRequirementCount(updated) : undefined;
  }

  private async toVersionWithRequirementCount(
    version: Parameters<typeof toVersion>[0],
  ) {
    const requirementCount = await this.prisma.client.requirement.count({
      where: {
        deletedAt: null,
        versionId: version.id,
      },
    });

    return toVersion(version, { requirementCount });
  }

  private async countRequirementsByVersionIds(versionIds: string[]) {
    const counts = new Map<string, number>();

    if (versionIds.length === 0) {
      return counts;
    }

    const groups = await this.prisma.client.requirement.groupBy({
      by: ["versionId"],
      _count: {
        _all: true,
      },
      where: {
        deletedAt: null,
        versionId: {
          in: versionIds,
        },
      },
    });

    for (const group of groups) {
      if (group.versionId) {
        counts.set(group.versionId, group._count._all);
      }
    }

    return counts;
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
        workItemTypeConstraints.length > 0 ? workItemTypeConstraints : undefined,
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

    return Array.from(
      new Set(participants.map((participant) => participant.targetId)),
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
  counts: { statusCategory: (typeof BOARD_STATUS_CATEGORIES)[number]; count: number }[],
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
