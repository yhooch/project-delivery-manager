import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ApiErrorCode,
  SpaceRole,
  TargetType,
} from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import { PrismaService } from "../../prisma/prisma.service";
import {
  REQUIREMENT_REPOSITORY,
  type RequirementRepository,
} from "../requirement/requirement.repository";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import type {
  ResolvedTargetContext,
  ResolveTargetOptions,
  TargetRecord,
} from "./target.types";

const REQUIREMENT_DRAFT_READER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);
const WORK_ITEM_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "TESTER",
  "VIEWER",
]);

@Injectable()
export class TargetResolverService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(REQUIREMENT_REPOSITORY)
    private readonly requirements: RequirementRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
  ) {}

  async resolve(
    actorUserId: string,
    targetType: TargetType,
    targetId: string,
    options: ResolveTargetOptions = {},
  ): Promise<ResolvedTargetContext> {
    const target = await this.findTarget(targetType, targetId);

    if (!target) {
      throwTargetNotFound(targetType, options.notFoundCode);
    }

    const access = await this.spaces.findAccessibleById(
      actorUserId,
      target.spaceId,
    );

    if (!access) {
      if (options.hideInaccessible) {
        throwTargetNotFound(targetType, options.notFoundCode);
      }

      throwSpaceAccessDenied();
    }

    if (
      target.isDraftRequirement &&
      !REQUIREMENT_DRAFT_READER_ROLES.has(access.role)
    ) {
      throwTargetNotFound(targetType, options.notFoundCode);
    }

    if (
      target.targetType === "WORK_ITEM" &&
      !WORK_ITEM_READ_ALL_ROLES.has(access.role) &&
      !(await this.isWorkItemParticipant(
        target.spaceId,
        target.targetId,
        actorUserId,
      ))
    ) {
      throwTargetNotFound(targetType, options.notFoundCode);
    }

    const canWrite = access.role !== "VIEWER";

    if (options.access === "write" && !canWrite) {
      throwSpaceAccessDenied();
    }

    return {
      ...target,
      role: access.role,
      canWrite,
    };
  }

  private async findTarget(
    targetType: TargetType,
    targetId: string,
  ): Promise<TargetRecord | undefined> {
    switch (targetType) {
      case "SPACE":
        return this.findSpaceTarget(targetId);
      case "VERSION":
        return this.findVersionTarget(targetId);
      case "REQUIREMENT":
        return this.findRequirementTarget(targetId);
      case "INTAKE_ITEM":
        return this.findIntakeItemTarget(targetId);
      case "WORK_ITEM":
        return this.findWorkItemTarget(targetId);
    }
  }

  private async findSpaceTarget(
    targetId: string,
  ): Promise<TargetRecord | undefined> {
    const space = await this.prisma.client.space.findFirst({
      select: {
        id: true,
        name: true,
        organizationId: true,
      },
      where: {
        deletedAt: null,
        id: targetId,
      },
    });

    return space
      ? {
          organizationId: space.organizationId,
          spaceId: space.id,
          targetId: space.id,
          targetType: "SPACE",
          title: nonEmptyTitle(space.name),
        }
      : undefined;
  }

  private async findVersionTarget(
    targetId: string,
  ): Promise<TargetRecord | undefined> {
    const version = await this.prisma.client.version.findFirst({
      select: {
        id: true,
        name: true,
        organizationId: true,
        spaceId: true,
      },
      where: {
        deletedAt: null,
        id: targetId,
      },
    });

    return version
      ? {
          organizationId: version.organizationId,
          spaceId: version.spaceId,
          targetId: version.id,
          targetType: "VERSION",
          title: nonEmptyTitle(version.name),
        }
      : undefined;
  }

  private async findRequirementTarget(
    targetId: string,
  ): Promise<TargetRecord | undefined> {
    const requirement = await this.requirements.findById(targetId);

    return requirement
      ? {
          organizationId: requirement.organizationId,
          spaceId: requirement.spaceId,
          targetId: requirement.id,
          targetType: "REQUIREMENT",
          title: nonEmptyTitle(requirement.title),
          isDraftRequirement: requirement.status === "DRAFT",
        }
      : undefined;
  }

  private async findIntakeItemTarget(
    targetId: string,
  ): Promise<TargetRecord | undefined> {
    const intakeItem = await this.prisma.client.intakeItem.findFirst({
      select: {
        id: true,
        organizationId: true,
        spaceId: true,
        title: true,
      },
      where: {
        deletedAt: null,
        id: targetId,
      },
    });

    return intakeItem
      ? {
          organizationId: intakeItem.organizationId,
          spaceId: intakeItem.spaceId,
          targetId: intakeItem.id,
          targetType: "INTAKE_ITEM",
          title: nonEmptyTitle(intakeItem.title),
        }
      : undefined;
  }

  private async findWorkItemTarget(
    targetId: string,
  ): Promise<TargetRecord | undefined> {
    const workItem = await this.prisma.client.workItem.findFirst({
      select: {
        id: true,
        organizationId: true,
        spaceId: true,
        title: true,
      },
      where: {
        deletedAt: null,
        id: targetId,
      },
    });

    return workItem
      ? {
          organizationId: workItem.organizationId,
          spaceId: workItem.spaceId,
          targetId: workItem.id,
          targetType: "WORK_ITEM",
          title: nonEmptyTitle(workItem.title),
        }
      : undefined;
  }

  private async isWorkItemParticipant(
    spaceId: string,
    workItemId: string,
    userId: string,
  ): Promise<boolean> {
    const participant = await this.prisma.client.objectParticipant.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM",
        userId,
      },
    });

    return Boolean(participant);
  }
}

function nonEmptyTitle(title: string): string | undefined {
  const trimmed = title.trim();
  return trimmed ? trimmed : undefined;
}

function throwTargetNotFound(
  targetType: TargetType,
  overrideCode?: ApiErrorCode,
): never {
  const code = overrideCode ?? targetNotFoundCode(targetType);
  throw new ApiException(code, "Target not found", HttpStatus.NOT_FOUND);
}

function targetNotFoundCode(targetType: TargetType): ApiErrorCode {
  switch (targetType) {
    case "SPACE":
      return "SPACE_NOT_FOUND";
    case "REQUIREMENT":
      return "REQUIREMENT_NOT_FOUND";
    case "INTAKE_ITEM":
      return "INTAKE_ITEM_NOT_FOUND";
    case "WORK_ITEM":
      return "WORK_ITEM_NOT_FOUND";
    case "VERSION":
      return "NOT_FOUND";
  }
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}
