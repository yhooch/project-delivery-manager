import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import type {
  ApiErrorCode,
  ObjectParticipantTargetType,
  SpaceRole,
  TargetType,
} from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import { PrismaService } from "../../prisma/prisma.service";
import { auditAccessDenied } from "../audit/audit-access-denied";
import { AuditService } from "../audit/audit.service";
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
  TargetWritePolicy,
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
    @Optional()
    @Inject(AuditService)
    private readonly audit?: AuditService,
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

    const canWrite = await this.canWriteTarget(
      actorUserId,
      target,
      access.role,
      options.writePolicy ?? "default",
    );

    if (options.access === "write" && !canWrite) {
      await this.auditTargetAccessDenied(actorUserId, target, {
        operation: options.audit?.operation ?? "resolveTargetWrite",
        reason: "TARGET_WRITE_DENIED",
        requestMetadata: options.audit,
        role: access.role,
      });
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
      case "DOCUMENT":
        return this.findDocumentTarget(targetId);
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

  private async findDocumentTarget(
    targetId: string,
  ): Promise<TargetRecord | undefined> {
    const document = await this.prisma.client.document.findFirst({
      select: {
        createdById: true,
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

    return document
      ? {
          createdById: document.createdById,
          organizationId: document.organizationId,
          spaceId: document.spaceId,
          targetId: document.id,
          targetType: "DOCUMENT",
          title: nonEmptyTitle(document.title),
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
      case "DOCUMENT":
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
        if (target.isDraftRequirement) {
          return this.isRequirementParticipant(
            target.spaceId,
            target.targetId,
            actorUserId,
          );
        }

        if (
          REQUIREMENT_READ_ALL_ROLES.has(role) ||
          REQUIREMENT_NON_DRAFT_READ_ALL_ROLES.has(role)
        ) {
          return true;
        }

        return this.isRequirementParticipant(
          target.spaceId,
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
    policy: TargetWritePolicy,
  ) {
    if (role === "VIEWER") {
      return false;
    }

    if (policy === "objectUpdate") {
      return this.canUpdateTarget(actorUserId, target, role);
    }

    switch (target.targetType) {
      case "SPACE":
      case "VERSION":
        return MANAGER_ROLES.has(role);
      case "DOCUMENT":
        return MANAGER_ROLES.has(role) || target.createdById === actorUserId;
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
        if (target.isDraftRequirement) {
          return this.isRequirementParticipant(
            target.spaceId,
            target.targetId,
            actorUserId,
          );
        }

        if (REQUIREMENT_WRITE_ALL_ROLES.has(role)) {
          return true;
        }

        return this.isRequirementParticipant(
          target.spaceId,
          target.targetId,
          actorUserId,
        );
    }
  }

  private async canUpdateTarget(
    actorUserId: string,
    target: TargetRecord,
    role: SpaceRole,
  ) {
    switch (target.targetType) {
      case "SPACE":
      case "VERSION":
      case "WORK_ITEM":
      case "INTAKE_ITEM":
        return MANAGER_ROLES.has(role);
      case "DOCUMENT":
        return MANAGER_ROLES.has(role) || target.createdById === actorUserId;
      case "REQUIREMENT":
        if (!REQUIREMENT_WRITE_ALL_ROLES.has(role)) {
          return false;
        }

        return target.isDraftRequirement
          ? this.isRequirementParticipant(
              target.spaceId,
              target.targetId,
              actorUserId,
            )
          : true;
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

  private async isRequirementParticipant(
    spaceId: string,
    requirementId: string,
    userId: string,
  ): Promise<boolean> {
    return this.requirements.isParticipant(spaceId, requirementId, userId);
  }

  private async auditTargetAccessDenied(
    actorUserId: string,
    target: TargetRecord,
    input: {
      operation: string;
      reason: string;
      requestMetadata?: ResolveTargetOptions["audit"];
      role?: SpaceRole;
    },
  ) {
    if (!this.audit) {
      return;
    }

    await auditAccessDenied(this.audit, {
      ...input.requestMetadata,
      actorId: actorUserId,
      metadata: {
        role: input.role,
      },
      operation: input.operation,
      organizationId: target.organizationId,
      reason: input.reason,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: target.targetType,
    });
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
    case "DOCUMENT":
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
