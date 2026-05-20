import { Inject, Injectable } from "@nestjs/common";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  listTagsByTarget,
  listTagsByTargets,
  replaceTagAssignmentsInTransaction,
} from "./tag-assignment.helpers";
import { toTagDto } from "./tag.mappers";
import type { TagRepository } from "./tag.repository";
import type {
  CreateTagInput,
  ListTagsByTargetsInput,
  ReplaceTagAssignmentsInput,
  SoftDeleteTagInput,
  TagAssignmentTargetInput,
  TagListInput,
} from "./tag.types";

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

      await tx.tag.updateMany({
        data: {
          deletedAt,
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.tagId,
        },
      });

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
