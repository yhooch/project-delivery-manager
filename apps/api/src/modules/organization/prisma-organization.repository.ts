import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import {
  toOrganization,
  toOrganizationMember,
  toOrganizationMemberWithUser,
  toOrganizationRole,
} from "./organization.mappers";
import type { OrganizationRepository } from "./organization.repository";
import type {
  CreateOrganizationInput,
  CreatedOrganizationWithOwner,
  OrganizationAccess,
  OrganizationListInput,
  OrganizationListResult,
  OrganizationSummaryWithRole,
  SpaceSummaryWithRole,
} from "./organization.types";

@Injectable()
export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async createWithOwner(
    input: CreateOrganizationInput,
  ): Promise<CreatedOrganizationWithOwner> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: input.id,
          code: input.code,
          name: input.name,
          ownerId: input.ownerId,
        },
      });
      const ownerMembership = await tx.organizationMember.create({
        data: {
          id: input.memberId,
          organizationId: organization.id,
          role: "OWNER",
          userId: input.ownerId,
        },
      });

      return {
        organization,
        ownerMembership,
      };
    });

    return {
      organization: toOrganization(result.organization),
      ownerMembership: toOrganizationMember(result.ownerMembership),
    };
  }

  async addMember(input: {
    id: string;
    organizationId: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    userId: string;
    createdById: string;
  }) {
    const member = await this.prisma.client.organizationMember.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        role: input.role,
        userId: input.userId,
        createdById: input.createdById,
        updatedById: input.createdById,
      },
      include: {
        user: true,
      },
    });

    return toOrganizationMemberWithUser(member);
  }

  async countActiveOwners(organizationId: string): Promise<number> {
    return this.prisma.client.organizationMember.count({
      where: {
        deletedAt: null,
        organizationId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
  }

  async findAccessibleById(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationAccess | undefined> {
    const member = await this.prisma.client.organizationMember.findFirst({
      include: {
        organization: true,
      },
      where: {
        deletedAt: null,
        organizationId,
        status: "ACTIVE",
        userId,
        organization: {
          deletedAt: null,
        },
      },
    });

    return member
      ? {
          organization: toOrganization(member.organization),
          role: toOrganizationRole(member.role),
        }
      : undefined;
  }

  async findByCode(code: string): Promise<{ id: string } | undefined> {
    const organization = await this.prisma.client.organization.findFirst({
      select: {
        id: true,
      },
      where: {
        code,
        deletedAt: null,
      },
    });

    return organization ?? undefined;
  }

  async findMemberById(organizationId: string, memberId: string) {
    const member = await this.prisma.client.organizationMember.findFirst({
      include: {
        user: true,
      },
      where: {
        deletedAt: null,
        id: memberId,
        organizationId,
      },
    });

    return member ? toOrganizationMemberWithUser(member) : undefined;
  }

  async findMemberByUserId(organizationId: string, userId: string) {
    const member = await this.prisma.client.organizationMember.findFirst({
      include: {
        user: true,
      },
      where: {
        deletedAt: null,
        organizationId,
        userId,
      },
    });

    return member ? toOrganizationMemberWithUser(member) : undefined;
  }

  async listByUserId(
    userId: string,
    input: OrganizationListInput,
  ): Promise<OrganizationListResult> {
    const where = {
      deletedAt: null,
      status: "ACTIVE" as const,
      userId,
      organization: {
        deletedAt: null,
      },
    };
    const [members, total] = await this.prisma.client.$transaction([
      this.prisma.client.organizationMember.findMany({
        include: {
          organization: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.organizationMember.count({
        where,
      }),
    ]);

    return {
      items: members.map((member) => toOrganization(member.organization)),
      total,
    };
  }

  async listMembers(
    organizationId: string,
    input: {
      page: number;
      pageSize: number;
      role?: "OWNER" | "ADMIN" | "MEMBER";
      status?: "ACTIVE" | "DISABLED";
    },
  ) {
    const where = {
      deletedAt: null,
      organizationId,
      role: input.role,
      status: input.status,
    };
    const [members, total] = await this.prisma.client.$transaction([
      this.prisma.client.organizationMember.findMany({
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
      this.prisma.client.organizationMember.count({
        where,
      }),
    ]);

    return {
      items: members.map((member) => toOrganizationMemberWithUser(member)),
      total,
    };
  }

  async listSessionSummaries(
    userId: string,
  ): Promise<OrganizationSummaryWithRole[]> {
    const members = await this.prisma.client.organizationMember.findMany({
      include: {
        organization: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        status: "ACTIVE",
        userId,
        organization: {
          deletedAt: null,
        },
      },
    });

    return members.map((member) => ({
      id: member.organization.id,
      name: member.organization.name,
      code: member.organization.code,
      role: toOrganizationRole(member.role),
      status: member.organization.status,
    }));
  }

  async listSessionSpaceSummaries(
    userId: string,
  ): Promise<SpaceSummaryWithRole[]> {
    const members = await this.prisma.client.spaceMember.findMany({
      include: {
        space: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
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

    return members.map((member) => ({
      id: member.space.id,
      name: member.space.name,
      code: member.space.code,
      organizationId: member.space.organizationId,
      role: member.role,
      status: member.space.status,
    }));
  }

  async updateMember(input: {
    memberId: string;
    organizationId: string;
    role?: "OWNER" | "ADMIN" | "MEMBER";
    status?: "ACTIVE" | "DISABLED";
    updatedById: string;
  }) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.organizationMember.updateMany({
        data: {
          role: input.role,
          status: input.status,
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.memberId,
          organizationId: input.organizationId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      return tx.organizationMember.findFirst({
        include: {
          user: true,
        },
        where: {
          deletedAt: null,
          id: input.memberId,
          organizationId: input.organizationId,
        },
      });
    });

    return updated ? toOrganizationMemberWithUser(updated) : undefined;
  }
}
