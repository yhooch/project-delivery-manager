import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ApiErrorCode,
  ObjectParticipantTargetType,
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
import {
  canReadAllSpaceWorkItems,
  isTesterVisibleWorkItem,
} from "../workitem/workitem-visibility";
import type {
  ResolvedTargetContext,
  ResolveTargetOptions,
  TargetRecord,
} from "./target.types";

const REQUIREMENT_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);
const REQUIREMENT_NON_DRAFT_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
  "REQUIREMENT",
]);
const INTAKE_ITEM_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
]);
const MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);
const REQUIREMENT_WRITE_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
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

    if (!(await this.canReadTarget(actorUserId, target, access.role))) {
      throwTargetNotFound(targetType, options.notFoundCode);
    }

    const canWrite = await this.canWriteTarget(actorUserId, target, access.role);

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
        currentState: {
          select: {
            code: true,
            name: true,
          },
        },
        id: true,
        organizationId: true,
        spaceId: true,
        statusCategory: true,
        title: true,
        type: true,
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
          workItemType: workItem.type,
          statusCategory: workItem.statusCategory,
          currentState: workItem.currentState,
        }
      : undefined;
  }

  private async canReadTarget(
    actorUserId: string,
    target: TargetRecord,
    role: SpaceRole,
  ) {
    switch (target.targetType) {
      case "SPACE":
      case "VERSION":
        return true;
      case "WORK_ITEM":
        if (canReadAllSpaceWorkItems(role)) {
          return true;
        }
        if (
          role === "TESTER" &&
          target.workItemType &&
          isTesterVisibleWorkItem({
            type: target.workItemType,
            statusCategory: target.statusCategory,
            currentState: target.currentState,
          })
        ) {
          return true;
        }
        return this.isObjectParticipant(
          target.spaceId,
          target.targetType,
          target.targetId,
          actorUserId,
        );
      case "REQUIREMENT":
        if (REQUIREMENT_READ_ALL_ROLES.has(role)) {
          return true;
        }
        if (
          !target.isDraftRequirement &&
          REQUIREMENT_NON_DRAFT_READ_ALL_ROLES.has(role)
        ) {
          return true;
        }
        return this.isObjectParticipant(
          target.spaceId,
          target.targetType,
          target.targetId,
          actorUserId,
        );
      case "INTAKE_ITEM":
        if (INTAKE_ITEM_READ_ALL_ROLES.has(role)) {
          return true;
        }
        return this.isObjectParticipant(
          target.spaceId,
          target.targetType,
          target.targetId,
          actorUserId,
        );
    }
  }

  private async canWriteTarget(
    actorUserId: string,
    target: TargetRecord,
    role: SpaceRole,
  ) {
    switch (target.targetType) {
      case "SPACE":
      case "VERSION":
        return MANAGER_ROLES.has(role);
      case "WORK_ITEM":
      case "INTAKE_ITEM":
        if (MANAGER_ROLES.has(role)) {
          return true;
        }

        return this.isObjectParticipant(
          target.spaceId,
          target.targetType,
          target.targetId,
          actorUserId,
        );
      case "REQUIREMENT":
        if (REQUIREMENT_WRITE_ALL_ROLES.has(role)) {
          return true;
        }

        return this.isObjectParticipant(
          target.spaceId,
          target.targetType,
          target.targetId,
          actorUserId,
        );
    }
  }

  private async isObjectParticipant(
    spaceId: string,
    targetType: ObjectParticipantTargetType,
    targetId: string,
    userId: string,
  ): Promise<boolean> {
    const participant = await this.prisma.client.objectParticipant.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetId,
        targetType,
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
