import { Inject, Injectable } from "@nestjs/common";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  toTimelineEvent,
  type TimelineTargetIdentityRecord,
} from "./timeline.mappers";
import type { TimelineRepository } from "./timeline.repository";
import type {
  CreateTimelineEventInput,
  TimelineListInput,
} from "./timeline.types";

@Injectable()
export class PrismaTimelineRepository implements TimelineRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listByTarget(input: TimelineListInput) {
    const where: Prisma.TimelineEventWhereInput = {
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: input.targetType,
    };
    const [events, total] = await this.prisma.client.$transaction([
      this.prisma.client.timelineEvent.findMany({
        include: {
          actor: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.timelineEvent.count({
        where,
      }),
    ]);
    const targetIdentity =
      (await this.findTimelineTargetIdentity(input)) ??
      (input.targetTitle ? { title: input.targetTitle } : undefined);

    return {
      items: events.map((event) => toTimelineEvent(event, targetIdentity)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async create(input: CreateTimelineEventInput) {
    const event = await this.prisma.client.timelineEvent.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetType: input.targetType,
        targetId: input.targetId,
        eventType: input.eventType,
        actorId: input.actorId,
        title: input.title,
        detail: input.detail,
        before: input.before as Prisma.InputJsonValue | undefined,
        after: input.after as Prisma.InputJsonValue | undefined,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        createdById: input.createdById,
        updatedById: input.createdById,
      },
      include: {
        actor: true,
      },
    });
    const targetIdentity =
      (await this.findTimelineTargetIdentity(input)) ??
      (input.targetTitle ? { title: input.targetTitle } : undefined);

    return toTimelineEvent(event, targetIdentity);
  }

  private async findTimelineTargetIdentity(input: {
    organizationId: string;
    spaceId: string;
    targetId: string;
    targetTitle?: string;
    targetType: CreateTimelineEventInput["targetType"];
  }): Promise<TimelineTargetIdentityRecord | undefined> {
    switch (input.targetType) {
      case "SPACE": {
        const space = await this.prisma.client.space.findFirst({
          select: {
            name: true,
          },
          where: {
            deletedAt: null,
            id: input.targetId,
            organizationId: input.organizationId,
          },
        });

        return space ? { title: space.name } : undefined;
      }
      case "VERSION": {
        const version = await this.prisma.client.version.findFirst({
          select: {
            name: true,
          },
          where: {
            deletedAt: null,
            id: input.targetId,
            organizationId: input.organizationId,
            spaceId: input.spaceId,
          },
        });

        return version ? { title: version.name } : undefined;
      }
      case "REQUIREMENT": {
        const requirement = await this.prisma.client.requirement.findFirst({
          select: {
            sequence: true,
            title: true,
          },
          where: {
            deletedAt: null,
            id: input.targetId,
            organizationId: input.organizationId,
            spaceId: input.spaceId,
          },
        });

        return requirement
          ? {
              sequence: requirement.sequence,
              title: requirement.title,
            }
          : undefined;
      }
      case "INTAKE_ITEM": {
        const intakeItem = await this.prisma.client.intakeItem.findFirst({
          select: {
            sequence: true,
            title: true,
          },
          where: {
            deletedAt: null,
            id: input.targetId,
            organizationId: input.organizationId,
            spaceId: input.spaceId,
          },
        });

        return intakeItem
          ? {
              sequence: intakeItem.sequence,
              title: intakeItem.title,
            }
          : undefined;
      }
      case "WORK_ITEM": {
        const workItem = await this.prisma.client.workItem.findFirst({
          select: {
            sequence: true,
            title: true,
            type: true,
          },
          where: {
            deletedAt: null,
            id: input.targetId,
            organizationId: input.organizationId,
            spaceId: input.spaceId,
          },
        });

        return workItem
          ? {
              sequence: workItem.sequence,
              title: workItem.title,
              workItemType: workItem.type,
            }
          : undefined;
      }
      case "DOCUMENT": {
        const document = await this.prisma.client.document.findFirst({
          select: {
            title: true,
          },
          where: {
            deletedAt: null,
            id: input.targetId,
            organizationId: input.organizationId,
            spaceId: input.spaceId,
          },
        });

        return document ? { title: document.title } : undefined;
      }
    }
  }
}
