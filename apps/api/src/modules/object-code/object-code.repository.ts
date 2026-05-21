import { Inject, Injectable } from "@nestjs/common";
import type {
  ObjectCodeType,
  SpaceRole,
  StatusCategory,
  WorkItemType,
} from "@project-delivery/shared";

import { PrismaService } from "../../prisma/prisma.service";
import type {
  ObjectCodeLookupRecord,
  ObjectCodeLookupRepositoryInput,
} from "./object-code.types";
import { formatDisplayCode } from "./object-code.types";

export const OBJECT_CODE_REPOSITORY = Symbol("OBJECT_CODE_REPOSITORY");

export type ObjectCodeRepository = {
  findByCode(
    input: ObjectCodeLookupRepositoryInput,
  ): Promise<ObjectCodeLookupRecord[]>;
};

type LookupRecordWithoutParticipant = Omit<
  ObjectCodeLookupRecord,
  "isParticipant"
>;

type SpaceRoleCarrier = {
  space: {
    members: { role: SpaceRole }[];
  };
};

@Injectable()
export class PrismaObjectCodeRepository implements ObjectCodeRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async findByCode(
    input: ObjectCodeLookupRepositoryInput,
  ): Promise<ObjectCodeLookupRecord[]> {
    const records = await this.findRecordsByCode(input);

    return this.withParticipantFlags(
      input.actorUserId,
      input.objectType,
      records,
    );
  }

  private async findRecordsByCode(
    input: ObjectCodeLookupRepositoryInput,
  ): Promise<LookupRecordWithoutParticipant[]> {
    switch (input.objectType) {
      case "REQUIREMENT":
        return this.findRequirements(input);
      case "INTAKE_ITEM":
        return this.findIntakeItems(input);
      case "TASK":
      case "BUG":
        return this.findWorkItems(input);
    }
  }

  private async findRequirements(
    input: ObjectCodeLookupRepositoryInput,
  ): Promise<LookupRecordWithoutParticipant[]> {
    const requirements = await this.prisma.client.requirement.findMany({
      select: {
        id: true,
        organizationId: true,
        sequence: true,
        spaceId: true,
        status: true,
        title: true,
        space: roleSelect(input.actorUserId),
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        sequence: input.sequence,
        spaceId: input.spaceId,
        status: {
          not: "DRAFT",
        },
        space: accessibleSpaceWhere(input),
      },
    });

    return requirements.flatMap((record) => {
      const role = readRole(record);

      if (!role || record.sequence === null) {
        return [];
      }

      return {
        id: record.id,
        type: "REQUIREMENT" as const,
        organizationId: record.organizationId,
        objectType: "REQUIREMENT" as const,
        sequence: record.sequence,
        displayCode: formatDisplayCode("REQUIREMENT", record.sequence),
        spaceId: record.spaceId,
        title: record.title,
        role,
        requirementStatus: record.status,
      };
    });
  }

  private async findIntakeItems(
    input: ObjectCodeLookupRepositoryInput,
  ): Promise<LookupRecordWithoutParticipant[]> {
    const items = await this.prisma.client.intakeItem.findMany({
      select: {
        id: true,
        organizationId: true,
        sequence: true,
        spaceId: true,
        title: true,
        space: roleSelect(input.actorUserId),
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        sequence: input.sequence,
        spaceId: input.spaceId,
        space: accessibleSpaceWhere(input),
      },
    });

    return items.flatMap((record) => {
      const role = readRole(record);

      if (!role || record.sequence === null) {
        return [];
      }

      return {
        id: record.id,
        type: "INTAKE_ITEM" as const,
        organizationId: record.organizationId,
        objectType: "INTAKE_ITEM" as const,
        sequence: record.sequence,
        displayCode: formatDisplayCode("INTAKE_ITEM", record.sequence),
        spaceId: record.spaceId,
        title: record.title,
        role,
      };
    });
  }

  private async findWorkItems(
    input: ObjectCodeLookupRepositoryInput,
  ): Promise<LookupRecordWithoutParticipant[]> {
    const workItemType = input.objectType === "BUG" ? "BUG" : "TASK";
    const items = await this.prisma.client.workItem.findMany({
      select: {
        currentState: {
          select: {
            code: true,
            name: true,
          },
        },
        id: true,
        organizationId: true,
        sequence: true,
        spaceId: true,
        statusCategory: true,
        title: true,
        type: true,
        space: roleSelect(input.actorUserId),
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        sequence: input.sequence,
        spaceId: input.spaceId,
        type: workItemType,
        space: accessibleSpaceWhere(input),
      },
    });

    return items.flatMap((record) => {
      const role = readRole(record);

      if (!role || record.sequence === null) {
        return [];
      }

      return {
        id: record.id,
        type: "WORK_ITEM" as const,
        workItemType: record.type as WorkItemType,
        organizationId: record.organizationId,
        objectType: input.objectType,
        sequence: record.sequence,
        displayCode: formatDisplayCode(input.objectType, record.sequence),
        spaceId: record.spaceId,
        title: record.title,
        role,
        workItem: {
          currentState: record.currentState,
          statusCategory: record.statusCategory as StatusCategory,
          type: record.type as WorkItemType,
        },
      };
    });
  }

  private async withParticipantFlags(
    actorUserId: string,
    objectType: ObjectCodeType,
    records: LookupRecordWithoutParticipant[],
  ): Promise<ObjectCodeLookupRecord[]> {
    if (records.length === 0) {
      return [];
    }

    const participantRows =
      await this.prisma.client.objectParticipant.findMany({
        select: {
          targetId: true,
        },
        where: {
          deletedAt: null,
          targetId: {
            in: records.map((record) => record.id),
          },
          targetType: toParticipantTargetType(objectType),
          userId: actorUserId,
        },
      });
    const participantIds = new Set(
      participantRows.map((row) => row.targetId),
    );

    return records.map((record) => ({
      ...record,
      isParticipant: participantIds.has(record.id),
    }));
  }
}

function roleSelect(actorUserId: string) {
  return {
    select: {
      members: {
        select: {
          role: true,
        },
        take: 1,
        where: {
          deletedAt: null,
          status: "ACTIVE" as const,
          userId: actorUserId,
        },
      },
    },
  };
}

function accessibleSpaceWhere(input: ObjectCodeLookupRepositoryInput) {
  return {
    deletedAt: null,
    organizationId: input.organizationId,
    status: "ACTIVE" as const,
    members: {
      some: {
        deletedAt: null,
        status: "ACTIVE" as const,
        userId: input.actorUserId,
      },
    },
  };
}

function readRole(record: SpaceRoleCarrier): SpaceRole | undefined {
  return record.space.members[0]?.role;
}

function toParticipantTargetType(
  objectType: ObjectCodeType,
): "REQUIREMENT" | "INTAKE_ITEM" | "WORK_ITEM" {
  if (objectType === "REQUIREMENT") {
    return "REQUIREMENT";
  }

  if (objectType === "INTAKE_ITEM") {
    return "INTAKE_ITEM";
  }

  return "WORK_ITEM";
}
