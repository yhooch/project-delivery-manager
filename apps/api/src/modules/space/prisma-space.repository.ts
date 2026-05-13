import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
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
  UpdateSpaceInput,
  UpdateSpaceMemberInput,
} from "./space.types";

const DEFAULT_WORKFLOW_CODES = ["DEVELOPMENT_TASK", "GENERAL_TASK", "BUG"];

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
}
