import { Inject, Injectable } from "@nestjs/common";
import type {
  TagDto,
  TagTargetType,
  TimelineEventMetadata,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { buildSpaceExceptionSignals } from "../space/space-exception.helpers";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import {
  listTagsByTarget,
  listTagsByTargets,
  lockActiveTagsInTransaction,
  replaceTagAssignmentsInTransaction,
} from "./tag-assignment.helpers";
import { toTagDto } from "./tag.mappers";
import type { TagRepository } from "./tag.repository";
import type {
  CreateTagInput,
  MergeTagsInput,
  TagFilterOptionsInput,
  ListTagsByTargetsInput,
  ReplaceTagAssignmentsInput,
  SoftDeleteTagInput,
  TagAssignmentTargetInput,
  TagListInput,
} from "./tag.types";

const TERMINAL_STATUS_CATEGORIES = ["DONE", "TERMINATED"] as const;
const REQUIREMENT_DOCUMENT_KIND = "REQUIREMENT" as const;
const REQUIREMENT_TAG_TARGET_TYPE = "DOCUMENT" as const;
const TAG_TARGET_TYPES: TagTargetType[] = [
  "INTAKE_ITEM",
  "WORK_ITEM",
  "DOCUMENT",
];

type TagAssignmentTargetFields = {
  targetId: string;
  targetType: TagTargetType;
};

@Injectable()
export class PrismaTagRepository implements TagRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listBySpace(input: TagListInput) {
    const where: Prisma.TagWhereInput = {
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      ...(input.normalizedQuery
        ? {
            normalizedName: {
              contains: input.normalizedQuery,
            },
          }
        : {}),
    };

    const [tags, total] = await this.prisma.client.$transaction([
      this.prisma.client.tag.findMany({
        orderBy: toTagOrderBy(input),
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.tag.count({
        where,
      }),
    ]);
    const usageByTagId = input.includeUsage
      ? await this.getUsageByTagId(
          input.spaceId,
          tags.map((tag) => tag.id),
        )
      : undefined;

    return {
      items: tags.map((tag) =>
        toTagDto(
          tag,
          usageByTagId ? { usageCount: usageByTagId.get(tag.id) ?? 0 } : {},
        ),
      ),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async listFilterOptions(input: TagFilterOptionsInput): Promise<TagDto[]> {
    const target = await this.listTagFilterTargetIds(input);

    return this.listTagsForTargets({
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetIds: target.targetIds,
      targetType: target.targetType,
    });
  }

  async findActiveById(tagId: string) {
    const tag = await this.prisma.client.tag.findFirst({
      where: {
        deletedAt: null,
        id: tagId,
      },
    });

    return tag ? toTagDto(tag) : undefined;
  }

  async findActiveByNormalizedName(spaceId: string, normalizedName: string) {
    const tag = await this.prisma.client.tag.findFirst({
      where: {
        deletedAt: null,
        normalizedName,
        spaceId,
      },
    });

    return tag ? toTagDto(tag) : undefined;
  }

  async create(input: CreateTagInput) {
    const tag = await this.prisma.client.tag.create({
      data: {
        id: input.id,
        colorKey: input.colorKey,
        createdById: input.createdById,
        name: input.name,
        normalizedName: input.normalizedName,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        updatedById: input.createdById,
      },
    });

    return toTagDto(tag);
  }

  async listTagsByTarget(input: TagAssignmentTargetInput) {
    return listTagsByTarget(this.prisma.client, input);
  }

  async listTagsByTargets(input: ListTagsByTargetsInput) {
    return listTagsByTargets(this.prisma.client, input);
  }

  async replaceAssignments(input: ReplaceTagAssignmentsInput) {
    return this.prisma.client.$transaction((tx) =>
      replaceTagAssignmentsInTransaction(tx, input),
    );
  }

  async merge(input: MergeTagsInput) {
    const sourceTagIds = unique(input.sourceTagIds);
    const tagIdsToLock = unique([input.targetTagId, ...sourceTagIds]).sort();

    return this.prisma.client.$transaction(async (tx) => {
      const lockedTags = await lockActiveTagsInTransaction(tx, {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        tagIds: tagIdsToLock,
      });

      if (lockedTags.length !== tagIdsToLock.length) {
        return undefined;
      }

      const tagsById = new Map(lockedTags.map((tag) => [tag.id, tag]));
      const targetTag = tagsById.get(input.targetTagId);
      const sourceTags = sourceTagIds.map((tagId) => tagsById.get(tagId));
      const resolvedSourceTags = sourceTags.filter(
        (tag): tag is TagDto => Boolean(tag),
      );

      if (!targetTag || resolvedSourceTags.length !== sourceTagIds.length) {
        return undefined;
      }

      const activeSourceAssignments = await tx.tagAssignment.findMany({
        orderBy: [{ targetType: "asc" }, { targetId: "asc" }, { tagId: "asc" }],
        where: {
          deletedAt: null,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          tagId: {
            in: sourceTagIds,
          },
        },
      });
      const affectedTargetsByType = countAffectedTargetsByType(
        activeSourceAssignments,
      );
      const affectedTargetIds = unique(
        activeSourceAssignments.map((assignment) => assignment.targetId),
      );
      const targetAssignments =
        affectedTargetIds.length === 0
          ? []
          : await tx.tagAssignment.findMany({
              orderBy: {
                updatedAt: "desc",
              },
              where: {
                organizationId: input.organizationId,
                spaceId: input.spaceId,
                tagId: input.targetTagId,
                targetId: {
                  in: affectedTargetIds,
                },
              },
            });
      const targetAssignmentByTargetKey = new Map<
        string,
        (typeof targetAssignments)[number]
      >();

      for (const assignment of targetAssignments) {
        const key = tagTargetKey(assignment);

        if (!targetAssignmentByTargetKey.has(key)) {
          targetAssignmentByTargetKey.set(key, assignment);
        }
      }

      const targetAssignmentsToMaterialize = new Map<
        string,
        Pick<(typeof activeSourceAssignments)[number], "targetId" | "targetType">
      >();
      const targetAlreadyMaterialized = new Set(
        targetAssignments
          .filter((assignment) => assignment.deletedAt === null)
          .map((assignment) => tagTargetKey(assignment)),
      );
      let duplicateAssignmentsSkipped = 0;

      for (const assignment of activeSourceAssignments) {
        const key = tagTargetKey(assignment);

        if (targetAlreadyMaterialized.has(key)) {
          duplicateAssignmentsSkipped += 1;
          continue;
        }

        targetAlreadyMaterialized.add(key);
        targetAssignmentsToMaterialize.set(key, {
          targetId: assignment.targetId,
          targetType: assignment.targetType,
        });
      }

      const targetAssignmentsCreated = targetAssignmentsToMaterialize.size;
      const sourceAssignmentsRemoved = activeSourceAssignments.length;
      const deletedSourceTags = sourceTagIds.length;
      const mergeMetadata = buildTagMergeTimelineMetadata({
        affectedTargetsByType,
        deletedSourceTags,
        duplicateAssignmentsSkipped,
        sourceAssignmentsRemoved,
        sourceTagIds,
        targetAssignmentsCreated,
        targetTagId: input.targetTagId,
      });

      if (!input.dryRun) {
        for (const [key, target] of targetAssignmentsToMaterialize) {
          const existing = targetAssignmentByTargetKey.get(key);

          if (existing) {
            await tx.tagAssignment.update({
              data: {
                assignedById: input.updatedById,
                deletedAt: null,
              },
              where: {
                id: existing.id,
              },
            });
            continue;
          }

          await tx.tagAssignment.create({
            data: {
              id: ulid(),
              assignedById: input.updatedById,
              organizationId: input.organizationId,
              spaceId: input.spaceId,
              tagId: input.targetTagId,
              targetId: target.targetId,
              targetType: target.targetType,
            },
          });
        }

        const deletedAt = new Date();

        if (activeSourceAssignments.length > 0) {
          await tx.tagAssignment.updateMany({
            data: {
              deletedAt,
            },
            where: {
              deletedAt: null,
              id: {
                in: activeSourceAssignments.map((assignment) => assignment.id),
              },
            },
          });
        }

        await tx.tag.updateMany({
          data: {
            deletedAt,
            updatedById: input.updatedById,
          },
          where: {
            deletedAt: null,
            id: {
              in: sourceTagIds,
            },
            organizationId: input.organizationId,
            spaceId: input.spaceId,
          },
        });

        await createTimelineEventRecord(tx, {
          actorUserId: input.updatedById,
          after: {
            ...mergeMetadata,
          },
          before: {
            sourceTags: resolvedSourceTags,
            targetTag,
          },
          detail: formatTagMergeTimelineDetail(resolvedSourceTags, targetTag),
          eventType: "UPDATED",
          metadata: mergeMetadata,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          targetId: input.spaceId,
          targetType: "SPACE",
          title: "合并标签",
        });
      }

      return {
        targetTag,
        sourceTags: resolvedSourceTags,
        dryRun: input.dryRun,
        sourceAssignmentsRemoved,
        targetAssignmentsCreated,
        duplicateAssignmentsSkipped,
        deletedSourceTags,
        affectedTargetsByType,
      };
    });
  }

  async softDeleteOrphan(input: SoftDeleteTagInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const tag = await tx.tag.findFirst({
        where: {
          deletedAt: null,
          id: input.tagId,
        },
      });

      if (!tag) {
        return { status: "not_found" as const };
      }

      const activeAssignmentCount = await tx.tagAssignment.count({
        where: {
          deletedAt: null,
          tagId: input.tagId,
        },
      });

      if (activeAssignmentCount > 0) {
        return { status: "in_use" as const };
      }

      const deletedAt = new Date();

      const deleted = await tx.tag.updateMany({
        data: {
          deletedAt,
          updatedById: input.updatedById,
        },
        where: {
          assignments: {
            none: {
              deletedAt: null,
            },
          },
          deletedAt: null,
          id: input.tagId,
        },
      });

      if (deleted.count === 0) {
        const stillActive = await tx.tag.findFirst({
          select: {
            id: true,
          },
          where: {
            deletedAt: null,
            id: input.tagId,
          },
        });

        return stillActive
          ? ({ status: "in_use" as const })
          : ({ status: "not_found" as const });
      }

      return {
        status: "deleted" as const,
        deletedAt,
        tag: toTagDto(tag),
      };
    });
  }

  private async getUsageByTagId(spaceId: string, tagIds: string[]) {
    if (tagIds.length === 0) {
      return new Map<string, number>();
    }

    const usageGroups = await this.prisma.client.tagAssignment.groupBy({
      by: ["tagId"],
      _count: {
        _all: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        tagId: {
          in: tagIds,
        },
      },
    });

    return new Map(
      usageGroups.map((group) => [group.tagId, group._count._all]),
    );
  }

  private async listTagFilterTargetIds(input: TagFilterOptionsInput): Promise<{
    targetIds: string[];
    targetType: TagTargetType;
  }> {
    switch (input.scope) {
      case "TASK":
        return {
          targetIds: await this.listWorkItemTargetIds(input, "TASK"),
          targetType: "WORK_ITEM",
        };
      case "BUG":
        return {
          targetIds: await this.listWorkItemTargetIds(input, "BUG"),
          targetType: "WORK_ITEM",
        };
      case "REQUIREMENT":
        return {
          targetIds: await this.listRequirementTargetIds(input),
          targetType: REQUIREMENT_TAG_TARGET_TYPE,
        };
      case "INTAKE_ITEM":
        return {
          targetIds: await this.listIntakeTargetIds(input),
          targetType: "INTAKE_ITEM",
        };
      case "DOCUMENT":
        return {
          targetIds: await this.listDocumentTargetIds(input),
          targetType: "DOCUMENT",
        };
      case "SPACE_EXCEPTION":
        return {
          targetIds: await this.listSpaceExceptionTargetIds(input),
          targetType: "WORK_ITEM",
        };
    }
  }

  private async listWorkItemTargetIds(
    input: Pick<TagFilterOptionsInput, "organizationId" | "spaceId">,
    type: "BUG" | "TASK",
  ): Promise<string[]> {
    const items = await this.prisma.client.workItem.findMany({
      distinct: ["id"],
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        type,
      },
    });

    return items.map((item) => item.id);
  }

  private async listRequirementTargetIds(
    input: Pick<TagFilterOptionsInput, "organizationId" | "spaceId">,
  ): Promise<string[]> {
    const requirements = await this.prisma.client.document.findMany({
      distinct: ["id"],
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        kind: REQUIREMENT_DOCUMENT_KIND,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
    });

    return requirements.map((requirement) => requirement.id);
  }

  private async listIntakeTargetIds(
    input: Pick<TagFilterOptionsInput, "organizationId" | "spaceId">,
  ): Promise<string[]> {
    const items = await this.prisma.client.intakeItem.findMany({
      distinct: ["id"],
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
    });

    return items.map((item) => item.id);
  }

  private async listDocumentTargetIds(
    input: Pick<TagFilterOptionsInput, "organizationId" | "spaceId">,
  ): Promise<string[]> {
    const documents = await this.prisma.client.document.findMany({
      distinct: ["id"],
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
    });

    return documents.map((document) => document.id);
  }

  private async listSpaceExceptionTargetIds(
    input: TagFilterOptionsInput,
  ): Promise<string[]> {
    const items = await this.prisma.client.workItem.findMany({
      distinct: ["id"],
      include: {
        bugDetail: {
          select: {
            deletedAt: true,
            regressionAt: true,
          },
        },
        currentState: {
          select: {
            code: true,
            name: true,
          },
        },
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        statusCategory: {
          notIn: [...TERMINAL_STATUS_CATEGORIES],
        },
        type: {
          in: ["TASK", "BUG"],
        },
      },
    });

    return items
      .filter(
        (item) =>
          buildSpaceExceptionSignals(item, {
            now: input.now,
            staleThresholdDays: input.staleThresholdDays,
          }).length > 0,
      )
      .map((item) => item.id);
  }

  private async listTagsForTargets(input: {
    organizationId: string;
    spaceId: string;
    targetIds: string[];
    targetType: TagTargetType;
  }): Promise<TagDto[]> {
    const targetIds = unique(input.targetIds);

    if (targetIds.length === 0) {
      return [];
    }

    const usageGroups = await this.prisma.client.tagAssignment.groupBy({
      by: ["tagId"],
      _count: {
        _all: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: {
          in: targetIds,
        },
        targetType: input.targetType,
        tag: {
          deletedAt: null,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
        },
      },
    });
    const usageByTagId = new Map(
      usageGroups.map((group) => [group.tagId, group._count._all]),
    );
    const tags = await this.prisma.client.tag.findMany({
      orderBy: [{ normalizedName: "asc" }, { createdAt: "asc" }],
      where: {
        deletedAt: null,
        id: {
          in: [...usageByTagId.keys()],
        },
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
    });

    return tags.map((tag) =>
      toTagDto(tag, { usageCount: usageByTagId.get(tag.id) ?? 0 }),
    );
  }
}

function buildTagMergeTimelineMetadata(input: {
  affectedTargetsByType: Array<{ targetType: TagTargetType; count: number }>;
  deletedSourceTags: number;
  duplicateAssignmentsSkipped: number;
  sourceAssignmentsRemoved: number;
  sourceTagIds: string[];
  targetAssignmentsCreated: number;
  targetTagId: string;
}): TimelineEventMetadata {
  return {
    operation: "MERGE_TAGS",
    sourceTagIds: input.sourceTagIds,
    targetTagId: input.targetTagId,
    sourceAssignmentsRemoved: input.sourceAssignmentsRemoved,
    targetAssignmentsCreated: input.targetAssignmentsCreated,
    duplicateAssignmentsSkipped: input.duplicateAssignmentsSkipped,
    deletedSourceTags: input.deletedSourceTags,
    affectedTargetsByType: input.affectedTargetsByType,
  };
}

function formatTagMergeTimelineDetail(
  sourceTags: TagDto[],
  targetTag: TagDto,
) {
  const sourceNames = sourceTags.map((tag) => tag.displayName).join(", ");

  return sourceNames
    ? `将 ${sourceNames} 合并到 ${targetTag.displayName}`
    : `合并到 ${targetTag.displayName}`;
}

function toTagOrderBy(
  input: Pick<TagListInput, "sortBy" | "sortOrder">,
): Prisma.TagOrderByWithRelationInput[] {
  const direction = input.sortOrder ?? "asc";

  switch (input.sortBy) {
    case "createdAt":
      return [{ createdAt: direction }, { id: "asc" }];
    case "updatedAt":
      return [{ updatedAt: direction }, { id: "asc" }];
    case "name":
    default:
      return [{ normalizedName: direction }, { createdAt: "asc" }];
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tagTargetKey(input: TagAssignmentTargetFields) {
  return `${input.targetType}:${input.targetId}`;
}

function countAffectedTargetsByType(assignments: TagAssignmentTargetFields[]) {
  const targetsByType = new Map<TagTargetType, Set<string>>(
    TAG_TARGET_TYPES.map((targetType) => [targetType, new Set<string>()]),
  );

  for (const assignment of assignments) {
    targetsByType.get(assignment.targetType)?.add(assignment.targetId);
  }

  return TAG_TARGET_TYPES.map((targetType) => ({
    targetType,
    count: targetsByType.get(targetType)?.size ?? 0,
  })).filter((item) => item.count > 0);
}
