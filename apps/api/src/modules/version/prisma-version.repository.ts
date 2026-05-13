import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import { toVersion } from "./version.mappers";
import type { VersionRepository } from "./version.repository";
import type {
  CreateVersionInput,
  UpdateVersionInput,
  VersionListInput,
  VersionListResult,
} from "./version.types";

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
}
