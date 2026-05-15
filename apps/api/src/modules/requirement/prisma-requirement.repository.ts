import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { toRequirement } from "./requirement.mappers";
import type { RequirementRepository } from "./requirement.repository";
import type {
  ArchiveRequirementInput,
  CreateRequirementDraftInput,
  RequirementListInput,
  SaveRequirementInput,
} from "./requirement.types";

@Injectable()
export class PrismaRequirementRepository implements RequirementRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async createDraft(input: CreateRequirementDraftInput) {
    const requirement = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.requirement.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          versionId: input.versionId,
          authorId: input.createdById,
          createdById: input.createdById,
          updatedById: input.createdById,
        },
      });

      await ensureParticipant(tx, {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: created.id,
        userId: input.createdById,
        relationType: "CREATOR",
        actorUserId: input.createdById,
      });

      return created;
    });

    return toRequirement(requirement);
  }

  async findById(requirementId: string) {
    const requirement = await this.prisma.client.requirement.findFirst({
      where: {
        deletedAt: null,
        id: requirementId,
      },
    });

    return requirement
      ? toRequirement(
          requirement,
          await this.listAttachmentRefsForRequirement(requirement.id),
        )
      : undefined;
  }

  async isParticipant(spaceId: string, requirementId: string, userId: string) {
    const participant = await this.prisma.client.objectParticipant.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetId: requirementId,
        targetType: "REQUIREMENT",
        userId,
      },
    });

    return Boolean(participant);
  }

  async listBySpaceId(spaceId: string, input: RequirementListInput) {
    const where = buildListWhere(spaceId, input);
    const participantIds =
      input.visibility === "ALL"
        ? []
        : await this.listParticipantRequirementIds(spaceId, input.actorUserId);

    applyVisibility(where, input, participantIds);

    if (isKnownEmptyIdFilter(where.id)) {
      return {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      };
    }

    const [requirements, total] = await this.prisma.client.$transaction([
      this.prisma.client.requirement.findMany({
        orderBy: {
          createdAt: "asc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.requirement.count({
        where,
      }),
    ]);
    const attachmentsByRequirementId = await this.listAttachmentRefsByRequirementIds(
      requirements.map((requirement) => requirement.id),
    );

    return {
      items: requirements.map((requirement) =>
        toRequirement(
          requirement,
          attachmentsByRequirementId.get(requirement.id) ?? [],
        ),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async save(input: SaveRequirementInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.requirement.updateMany({
        data: {
          title: input.title,
          summary: input.summary,
          contentJson: input.contentJson as Prisma.InputJsonValue,
          contentText: input.contentText,
          contentMarkdownCache: input.contentMarkdownCache,
          versionId: input.versionId,
          priority: input.priority,
          ownerId: input.shouldUpdateOwner ? input.ownerId : undefined,
          status: "CONFIRMED",
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const requirement = await tx.requirement.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (!requirement) {
        return undefined;
      }

      if (input.shouldUpdateOwner && input.ownerId) {
        await tx.objectParticipant.updateMany({
          data: {
            deletedAt: new Date(),
            updatedById: input.updatedById,
          },
          where: {
            deletedAt: null,
            relationType: "ASSIGNEE",
            spaceId: requirement.spaceId,
            targetId: requirement.id,
            targetType: "REQUIREMENT",
            userId: {
              not: input.ownerId,
            },
          },
        });
        await ensureParticipant(tx, {
          organizationId: requirement.organizationId,
          spaceId: requirement.spaceId,
          targetId: requirement.id,
          userId: input.ownerId,
          relationType: "ASSIGNEE",
          actorUserId: input.updatedById,
        });
      }

      return requirement;
    });

    return updated
      ? toRequirement(
          updated,
          await this.listAttachmentRefsForRequirement(updated.id),
        )
      : undefined;
  }

  async archive(input: ArchiveRequirementInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.requirement.updateMany({
        data: {
          status: "ARCHIVED",
          updatedById: input.updatedById,
        },
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      return tx.requirement.findFirst({
        where: {
          deletedAt: null,
          id: input.requirementId,
        },
      });
    });

    return updated
      ? toRequirement(
          updated,
          await this.listAttachmentRefsForRequirement(updated.id),
        )
      : undefined;
  }

  private async listAttachmentRefsForRequirement(requirementId: string) {
    const records = await this.prisma.client.attachment.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        targetId: requirementId,
        targetType: "REQUIREMENT",
      },
    });

    return records;
  }

  private async listAttachmentRefsByRequirementIds(requirementIds: string[]) {
    const result = new Map<string, Awaited<ReturnType<typeof this.listAttachmentRefsForRequirement>>>();

    if (requirementIds.length === 0) {
      return result;
    }

    const records = await this.prisma.client.attachment.findMany({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        targetId: {
          in: requirementIds,
        },
        targetType: "REQUIREMENT",
      },
    });

    for (const record of records) {
      const current = result.get(record.targetId) ?? [];
      current.push(record);
      result.set(record.targetId, current);
    }

    return result;
  }

  private async listParticipantRequirementIds(spaceId: string, userId: string) {
    const participants = await this.prisma.client.objectParticipant.findMany({
      distinct: ["targetId"],
      select: {
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetType: "REQUIREMENT",
        userId,
      },
    });

    return participants.map((participant) => participant.targetId);
  }
}

function buildListWhere(
  spaceId: string,
  input: RequirementListInput,
): Prisma.RequirementWhereInput {
  const where: Prisma.RequirementWhereInput = {
    deletedAt: null,
    ownerId: input.ownerId,
    spaceId,
    versionId: input.versionId,
  };

  if (input.status) {
    where.status = input.status;
    return where;
  }

  if (!input.includeDrafts) {
    where.status = {
      not: "DRAFT",
    };
  }

  return where;
}

function applyVisibility(
  where: Prisma.RequirementWhereInput,
  input: RequirementListInput,
  participantIds: string[],
) {
  if (input.visibility === "ALL") {
    return;
  }

  if (input.visibility === "PARTICIPANT") {
    where.id = {
      in: participantIds,
    };
    return;
  }

  where.AND = [
    ...toArray(where.AND),
    {
      OR: [
        {
          status: {
            not: "DRAFT",
          },
        },
        {
          id: {
            in: participantIds,
          },
        },
      ],
    },
  ];
}

function isKnownEmptyIdFilter(
  value: Prisma.RequirementWhereInput["id"],
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "in" in value &&
    Array.isArray(value.in) &&
    value.in.length === 0
  );
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

async function ensureParticipant(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    relationType: "CREATOR" | "ASSIGNEE";
    spaceId: string;
    targetId: string;
    userId: string;
  },
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
      targetType: "REQUIREMENT",
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
      targetType: "REQUIREMENT",
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}
