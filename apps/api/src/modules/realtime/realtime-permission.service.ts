import { Inject, Injectable } from "@nestjs/common";
import type {
  ObjectParticipantTargetType,
  RealtimeEvent,
  SpaceRole,
  StatusCategory,
  WorkItemType,
} from "@project-delivery/shared";

import { PrismaService } from "../../prisma/prisma.service";

const WORK_ITEM_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
]);
const REQUIREMENT_NON_DRAFT_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
  "VIEWER",
]);
const INTAKE_ITEM_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
]);
const RECENT_PARTICIPANT_REMOVAL_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class RealtimePermissionService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async canReadEvent(userId: string, event: RealtimeEvent): Promise<boolean> {
    const [organizationMember, spaceMember] = await Promise.all([
      this.prisma.client.organizationMember.findFirst({
        select: { id: true },
        where: {
          deletedAt: null,
          organizationId: event.organizationId,
          status: "ACTIVE",
          userId,
        },
      }),
      this.prisma.client.spaceMember.findFirst({
        select: { role: true },
        where: {
          deletedAt: null,
          organizationId: event.organizationId,
          spaceId: event.spaceId,
          status: "ACTIVE",
          userId,
        },
      }),
    ]);

    if (!organizationMember || !spaceMember) {
      return false;
    }

    return this.canReadTarget(userId, event, spaceMember.role);
  }

  private async canReadTarget(
    userId: string,
    event: RealtimeEvent,
    role: SpaceRole,
  ): Promise<boolean> {
    switch (event.target.type) {
      case "SPACE":
        return this.canReadSpaceTarget(event);
      case "VERSION":
        return this.canReadVersionTarget(event);
      case "WORK_ITEM":
        return this.canReadWorkItemTarget(userId, event, role);
      case "REQUIREMENT":
        return this.canReadRequirementTarget(userId, event, role);
      case "INTAKE_ITEM":
        return this.canReadIntakeItemTarget(userId, event, role);
    }
  }

  private async canReadSpaceTarget(event: RealtimeEvent): Promise<boolean> {
    if (event.target.id !== event.spaceId) {
      return false;
    }

    const space = await this.prisma.client.space.findFirst({
      select: { id: true },
      where: {
        deletedAt: null,
        id: event.spaceId,
        organizationId: event.organizationId,
      },
    });

    return Boolean(space);
  }

  private async canReadVersionTarget(event: RealtimeEvent): Promise<boolean> {
    const version = await this.prisma.client.version.findFirst({
      select: { id: true },
      where: {
        deletedAt: null,
        id: event.target.id,
        organizationId: event.organizationId,
        spaceId: event.spaceId,
      },
    });

    return Boolean(version);
  }

  private async canReadWorkItemTarget(
    userId: string,
    event: RealtimeEvent,
    role: SpaceRole,
  ): Promise<boolean> {
    const workItem = await this.prisma.client.workItem.findFirst({
      select: {
        id: true,
        statusCategory: true,
        type: true,
      },
      where: {
        deletedAt: null,
        id: event.target.id,
        organizationId: event.organizationId,
        spaceId: event.spaceId,
      },
    });

    if (!workItem) {
      return false;
    }

    if (WORK_ITEM_READ_ALL_ROLES.has(role)) {
      return true;
    }

    if (
      role === "TESTER" &&
      isTesterVisibleWorkItem({
        statusCategory: workItem.statusCategory,
        type: workItem.type,
      })
    ) {
      return true;
    }

    return this.isObjectParticipant(userId, event, "WORK_ITEM", {
      includeRecentlyRemoved: true,
    });
  }

  private async canReadRequirementTarget(
    userId: string,
    event: RealtimeEvent,
    role: SpaceRole,
  ): Promise<boolean> {
    const includeDeletedTarget = event.operation === "DELETED";
    const requirement = await this.prisma.client.requirement.findFirst({
      select: {
        deletedAt: true,
        id: true,
        status: true,
      },
      where: {
        id: event.target.id,
        organizationId: event.organizationId,
        spaceId: event.spaceId,
        ...(includeDeletedTarget ? {} : { deletedAt: null }),
      },
    });

    if (!requirement) {
      return false;
    }

    if (
      requirement.status !== "DRAFT" &&
      REQUIREMENT_NON_DRAFT_READ_ALL_ROLES.has(role)
    ) {
      return true;
    }

    if (includeDeletedTarget) {
      return requirement.deletedAt
        ? this.isObjectParticipant(userId, event, "REQUIREMENT", {
            deletedAt: requirement.deletedAt,
          })
        : false;
    }

    return this.isObjectParticipant(userId, event, "REQUIREMENT");
  }

  private async canReadIntakeItemTarget(
    userId: string,
    event: RealtimeEvent,
    role: SpaceRole,
  ): Promise<boolean> {
    const intakeItem = await this.prisma.client.intakeItem.findFirst({
      select: { id: true },
      where: {
        deletedAt: null,
        id: event.target.id,
        organizationId: event.organizationId,
        spaceId: event.spaceId,
      },
    });

    if (!intakeItem) {
      return false;
    }

    if (INTAKE_ITEM_READ_ALL_ROLES.has(role)) {
      return true;
    }

    return this.isObjectParticipant(userId, event, "INTAKE_ITEM");
  }

  private async isObjectParticipant(
    userId: string,
    event: RealtimeEvent,
    targetType: ObjectParticipantTargetType,
    options: { deletedAt?: Date; includeRecentlyRemoved?: boolean } = {},
  ): Promise<boolean> {
    const deletedAt = this.resolveParticipantDeletedAtFilter(event, options);
    const participant = await this.prisma.client.objectParticipant.findFirst({
      select: { id: true },
      where: {
        ...deletedAt,
        organizationId: event.organizationId,
        spaceId: event.spaceId,
        targetId: event.target.id,
        targetType,
        userId,
      },
    });

    return Boolean(participant);
  }

  private resolveParticipantDeletedAtFilter(
    event: RealtimeEvent,
    options: { deletedAt?: Date; includeRecentlyRemoved?: boolean },
  ) {
    if (options.deletedAt) {
      return { deletedAt: options.deletedAt };
    }

    if (options.includeRecentlyRemoved !== true) {
      return { deletedAt: null };
    }

    const occurredAtMs = Date.parse(event.occurredAt);

    if (!Number.isFinite(occurredAtMs)) {
      return { deletedAt: null };
    }

    return {
      OR: [
        { deletedAt: null },
        {
          deletedAt: {
            gte: new Date(occurredAtMs - RECENT_PARTICIPANT_REMOVAL_WINDOW_MS),
            lte: new Date(occurredAtMs),
          },
          updatedById: event.actorId,
        },
      ],
    };
  }
}

function isTesterVisibleWorkItem(input: {
  statusCategory?: StatusCategory;
  type: WorkItemType;
}): boolean {
  return input.type === "BUG" || input.statusCategory === "VERIFYING";
}
