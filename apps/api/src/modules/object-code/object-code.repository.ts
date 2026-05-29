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

const REQUIREMENT_DOCUMENT_KIND = "REQUIREMENT" as const;
const REQUIREMENT_OBJECT_CODE_TARGET_TYPE = "DOCUMENT" as const;

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
    const requirements = await this.prisma.client.document.findMany({
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
        kind: REQUIREMENT_DOCUMENT_KIND,
        organizationId: input.organizationId,
        sequence: input.sequence,
        spaceId: input.spaceId,
        status: {
          not: "DRAFT",
        },
        space: accessibleSpaceWhere(input),
      },
    });

    if (requirements.length > 0) {
      return requirements.flatMap((record) =>
        toRequirementLookupRecord(record, record.sequence),
      );
    }

    const activeCodeHistory =
      await this.prisma.client.documentCodeHistory.findMany({
        select: {
          sequence: true,
          document: {
            select: {
              id: true,
              organizationId: true,
              sequence: true,
              spaceId: true,
              status: true,
              title: true,
              space: roleSelect(input.actorUserId),
            },
          },
        },
        where: {
          codeStatus: "ASSIGNED",
          kind: REQUIREMENT_DOCUMENT_KIND,
          organizationId: input.organizationId,
          sequence: input.sequence,
          spaceId: input.spaceId,
          document: {
            deletedAt: null,
            kind: REQUIREMENT_DOCUMENT_KIND,
            status: {
              not: "DRAFT",
            },
            space: accessibleSpaceWhere(input),
          },
        },
      });

    if (activeCodeHistory.length > 0) {
      return activeCodeHistory.flatMap((history) =>
        toRequirementLookupRecord(history.document, history.sequence),
      );
    }

    if (!input.includeHistorical) {
      return [];
    }

    const historicalCodeHistory =
      await this.prisma.client.documentCodeHistory.findMany({
        select: {
          codeStatus: true,
          displayCode: true,
          sequence: true,
          document: {
            select: {
              deletedAt: true,
              id: true,
              kind: true,
              organizationId: true,
              sequence: true,
              spaceId: true,
              status: true,
              title: true,
              space: roleSelect(input.actorUserId),
            },
          },
        },
        where: {
          kind: REQUIREMENT_DOCUMENT_KIND,
          organizationId: input.organizationId,
          sequence: input.sequence,
          spaceId: input.spaceId,
          document: {
            space: accessibleSpaceWhere(input),
          },
        },
      });

    return historicalCodeHistory.flatMap(toHistoricalRequirementLookupRecord);
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
        targetType: "INTAKE_ITEM" as const,
        targetId: record.id,
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
        targetType: "WORK_ITEM" as const,
        targetId: record.id,
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
): "DOCUMENT" | "INTAKE_ITEM" | "WORK_ITEM" {
  if (objectType === "REQUIREMENT") {
    return REQUIREMENT_OBJECT_CODE_TARGET_TYPE;
  }

  if (objectType === "INTAKE_ITEM") {
    return "INTAKE_ITEM";
  }

  return "WORK_ITEM";
}

function toRequirementLookupRecord(
  record: SpaceRoleCarrier & {
    id: string;
    organizationId: string;
    sequence: number | null;
    spaceId: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    title: string;
  },
  sequence: number | null,
): LookupRecordWithoutParticipant[] {
  const role = readRole(record);

  if (!role || sequence === null) {
    return [];
  }

  return [
    {
      id: record.id,
      type: "REQUIREMENT" as const,
      targetType: "DOCUMENT" as const,
      targetId: record.id,
      kind: "REQUIREMENT" as const,
      organizationId: record.organizationId,
      objectType: "REQUIREMENT" as const,
      sequence,
      displayCode: formatDisplayCode("REQUIREMENT", sequence),
      spaceId: record.spaceId,
      title: record.title,
      role,
      requirementStatus:
        record.status === "ACTIVE" ? "CONFIRMED" : record.status,
    },
  ];
}

function toHistoricalRequirementLookupRecord(history: {
  codeStatus: "ASSIGNED" | "CANCELLED" | "DELETED";
  displayCode: string;
  sequence: number;
  document: SpaceRoleCarrier & {
    deletedAt: Date | null;
    id: string;
    kind: "GENERAL" | "REQUIREMENT";
    organizationId: string;
    sequence: number | null;
    spaceId: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    title: string;
  };
}): LookupRecordWithoutParticipant[] {
  const role = readRole(history.document);

  if (!role) {
    return [];
  }

  return [
    {
      id: history.document.id,
      type: "REQUIREMENT" as const,
      targetType: "DOCUMENT" as const,
      targetId: history.document.id,
      kind: history.document.kind,
      ...(history.document.kind === "REQUIREMENT"
        ? {}
        : { previousKind: "REQUIREMENT" as const }),
      codeStatus: history.codeStatus,
      organizationId: history.document.organizationId,
      objectType: "REQUIREMENT" as const,
      sequence: history.sequence,
      displayCode: history.displayCode,
      spaceId: history.document.spaceId,
      title: history.document.title,
      role,
      ...(history.document.kind === "REQUIREMENT"
        ? {
            requirementStatus:
              history.document.status === "ACTIVE"
                ? ("CONFIRMED" as const)
                : history.document.status,
          }
        : {}),
    },
  ];
}
