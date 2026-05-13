import { Inject, Injectable } from "@nestjs/common";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { toTimelineEvent } from "./timeline.mappers";
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

    return {
      items: events.map((event) => toTimelineEvent(event, input.targetTitle)),
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

    return toTimelineEvent(event, input.targetTitle);
  }
}
