import { Inject, Injectable } from "@nestjs/common";
import type { TagDto, TagTargetType } from "@project-delivery/shared";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { buildSpaceExceptionSignals } from "../space/space-exception.helpers";
import {
  listTagsByTarget,
  listTagsByTargets,
  replaceTagAssignmentsInTransaction,
} from "./tag-assignment.helpers";
import { toTagDto } from "./tag.mappers";
import type { TagRepository } from "./tag.repository";
import type {
  CreateTagInput,
  TagFilterOptionsInput,
  ListTagsByTargetsInput,
  ReplaceTagAssignmentsInput,
  SoftDeleteTagInput,
  TagAssignmentTargetInput,
  TagListInput,
} from "./tag.types";

const TERMINAL_STATUS_CATEGORIES = ["DONE", "TERMINATED"] as const;

@Injectable()
export class PrismaTagRepository implements TagRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listBySpace(input: TagListInput) {
    const where: Prisma.TagWhereInput = {
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      ...(input.normalizedQuery
        ? {
            normalizedName: {
              contains: input.normalizedQuery,
            },
          }
        : {}),
    };

    const [tags, total] = await this.prisma.client.$transaction([
      this.prisma.client.tag.findMany({
        orderBy: toTagOrderBy(input),
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.tag.count({
        where,
      }),
    ]);
    const usageByTagId = input.includeUsage
      ? await this.getUsageByTagId(
          input.spaceId,
          tags.map((tag) => tag.id),
        )
      : undefined;

    return {
      items: tags.map((tag) =>
        toTagDto(
          tag,
          usageByTagId ? { usageCount: usageByTagId.get(tag.id) ?? 0 } : {},
        ),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async listFilterOptions(input: TagFilterOptionsInput): Promise<TagDto[]> {
    const target = await this.listTagFilterTargetIds(input);

    return this.listTagsForTargets({
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetIds: target.targetIds,
      targetType: target.targetType,
    });
  }

  async findActiveById(tagId: string) {
    const tag = await this.prisma.client.tag.findFirst({
      where: {
        deletedAt: null,
        id: tagId,
      },
    });

    return tag ? toTagDto(tag) : undefined;
  }

  async findActiveByNormalizedName(spaceId: string, normalizedName: string) {
    const tag = await this.prisma.client.tag.findFirst({
      where: {
        deletedAt: null,
        normalizedName,
        spaceId,
      },
    });

    return tag ? toTagDto(tag) : undefined;
  }

  async create(input: CreateTagInput) {
    const tag = await this.prisma.client.tag.create({
      data: {
        id: input.id,
        colorKey: input.colorKey,
        createdById: input.createdById,
        name: input.name,
        normalizedName: input.normalizedName,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        updatedById: input.createdById,
      },
    });

    return toTagDto(tag);
  }

  async listTagsByTarget(input: TagAssignmentTargetInput) {
    return listTagsByTarget(this.prisma.client, input);
  }

  async listTagsByTargets(input: ListTagsByTargetsInput) {
    return listTagsByTargets(this.prisma.client, input);
  }

  async replaceAssignments(input: ReplaceTagAssignmentsInput) {
    return this.prisma.client.$transaction((tx) =>
      replaceTagAssignmentsInTransaction(tx, input),
    );
  }

  async softDeleteOrphan(input: SoftDeleteTagInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const tag = await tx.tag.findFirst({
        where: {
          deletedAt: null,
          id: input.tagId,
        },
      });

      if (!tag) {
        return { status: "not_found" as const };
      }

      const activeAssignmentCount = await tx.tagAssignment.count({
        where: {
          deletedAt: null,
          tagId: input.tagId,
        },
      });

      if (activeAssignmentCount > 0) {
        return { status: "in_use" as const };
      }

      const deletedAt = new Date();

      const deleted = await tx.tag.updateMany({
        data: {
          deletedAt,
          updatedById: input.updatedById,
        },
        where: {
          assignments: {
            none: {
              deletedAt: null,
            },
          },
          deletedAt: null,
          id: input.tagId,
        },
      });

      if (deleted.count === 0) {
        const stillActive = await tx.tag.findFirst({
          select: {
            id: true,
          },
          where: {
            deletedAt: null,
            id: input.tagId,
          },
        });

        return stillActive
          ? ({ status: "in_use" as const })
          : ({ status: "not_found" as const });
      }

      return {
        status: "deleted" as const,
        deletedAt,
        tag: toTagDto(tag),
      };
    });
  }

  private async getUsageByTagId(spaceId: string, tagIds: string[]) {
    if (tagIds.length === 0) {
      return new Map<string, number>();
    }

    const usageGroups = await this.prisma.client.tagAssignment.groupBy({
      by: ["tagId"],
      _count: {
        _all: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        tagId: {
          in: tagIds,
        },
      },
    });

    return new Map(
      usageGroups.map((group) => [group.tagId, group._count._all]),
    );
  }

  private async listTagFilterTargetIds(input: TagFilterOptionsInput): Promise<{
    targetIds: string[];
    targetType: TagTargetType;
  }> {
    switch (input.scope) {
      case "TASK":
        return {
          targetIds: await this.listWorkItemTargetIds(input, "TASK"),
          targetType: "WORK_ITEM",
        };
      case "BUG":
        return {
          targetIds: await this.listWorkItemTargetIds(input, "BUG"),
          targetType: "WORK_ITEM",
        };
      case "REQUIREMENT":
        return {
          targetIds: await this.listRequirementTargetIds(input),
          targetType: "REQUIREMENT",
        };
      case "INTAKE_ITEM":
        return {
          targetIds: await this.listIntakeTargetIds(input),
          targetType: "INTAKE_ITEM",
        };
      case "SPACE_EXCEPTION":
        return {
          targetIds: await this.listSpaceExceptionTargetIds(input),
          targetType: "WORK_ITEM",
        };
    }
  }

  private async listWorkItemTargetIds(
    input: Pick<TagFilterOptionsInput, "organizationId" | "spaceId">,
    type: "BUG" | "TASK",
  ): Promise<string[]> {
    const items = await this.prisma.client.workItem.findMany({
      distinct: ["id"],
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        type,
      },
    });

    return items.map((item) => item.id);
  }

  private async listRequirementTargetIds(
    input: Pick<TagFilterOptionsInput, "organizationId" | "spaceId">,
  ): Promise<string[]> {
    const requirements = await this.prisma.client.requirement.findMany({
      distinct: ["id"],
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
    });

    return requirements.map((requirement) => requirement.id);
  }

  private async listIntakeTargetIds(
    input: Pick<TagFilterOptionsInput, "organizationId" | "spaceId">,
  ): Promise<string[]> {
    const items = await this.prisma.client.intakeItem.findMany({
      distinct: ["id"],
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
    });

    return items.map((item) => item.id);
  }

  private async listSpaceExceptionTargetIds(
    input: TagFilterOptionsInput,
  ): Promise<string[]> {
    const items = await this.prisma.client.workItem.findMany({
      distinct: ["id"],
      include: {
        bugDetail: {
          select: {
            deletedAt: true,
            regressionAt: true,
          },
        },
        currentState: {
          select: {
            code: true,
            name: true,
          },
        },
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        statusCategory: {
          notIn: [...TERMINAL_STATUS_CATEGORIES],
        },
        type: {
          in: ["TASK", "BUG"],
        },
      },
    });

    return items
      .filter(
        (item) =>
          buildSpaceExceptionSignals(item, {
            now: input.now,
            staleThresholdDays: input.staleThresholdDays,
          }).length > 0,
      )
      .map((item) => item.id);
  }

  private async listTagsForTargets(input: {
    organizationId: string;
    spaceId: string;
    targetIds: string[];
    targetType: TagTargetType;
  }): Promise<TagDto[]> {
    const targetIds = unique(input.targetIds);

    if (targetIds.length === 0) {
      return [];
    }

    const usageGroups = await this.prisma.client.tagAssignment.groupBy({
      by: ["tagId"],
      _count: {
        _all: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: {
          in: targetIds,
        },
        targetType: input.targetType,
        tag: {
          deletedAt: null,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
        },
      },
    });
    const usageByTagId = new Map(
      usageGroups.map((group) => [group.tagId, group._count._all]),
    );
    const tags = await this.prisma.client.tag.findMany({
      orderBy: [{ normalizedName: "asc" }, { createdAt: "asc" }],
      where: {
        deletedAt: null,
        id: {
          in: [...usageByTagId.keys()],
        },
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
    });

    return tags.map((tag) =>
      toTagDto(tag, { usageCount: usageByTagId.get(tag.id) ?? 0 }),
    );
  }
}

function toTagOrderBy(
  input: Pick<TagListInput, "sortBy" | "sortOrder">,
): Prisma.TagOrderByWithRelationInput[] {
  const direction = input.sortOrder ?? "asc";

  switch (input.sortBy) {
    case "createdAt":
      return [{ createdAt: direction }, { id: "asc" }];
    case "updatedAt":
      return [{ updatedAt: direction }, { id: "asc" }];
    case "name":
    default:
      return [{ normalizedName: direction }, { createdAt: "asc" }];
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
