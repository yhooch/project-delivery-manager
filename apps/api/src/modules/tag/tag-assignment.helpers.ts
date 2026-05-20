import { HttpStatus } from "@nestjs/common";
import type { TagDto, TagMatch, TagTargetType } from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { ApiException } from "../../http/api-exception";
import type { PrismaService } from "../../prisma/prisma.service";
import { toTagDto } from "./tag.mappers";

type TagAssignmentClient = Prisma.TransactionClient | PrismaService["client"];

type TargetScope = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: TagTargetType;
};

export type ReplaceTagAssignmentsInTransactionInput = TargetScope & {
  assignedById: string;
  tagIds?: string[];
};

export type ListTagsByTargetsInput = {
  organizationId: string;
  spaceId: string;
  targetIds: string[];
  targetType: TagTargetType;
};

export type FindTaggedTargetIdsInput = {
  spaceId: string;
  tagIds?: string;
  tagMatch?: TagMatch;
  targetType: TagTargetType;
};

export async function replaceTagAssignmentsInTransaction(
  tx: Prisma.TransactionClient,
  input: ReplaceTagAssignmentsInTransactionInput,
): Promise<TagDto[]> {
  const tagIds = unique(input.tagIds ?? []);
  const tags = await findActiveTagsOrThrow(tx, {
    organizationId: input.organizationId,
    spaceId: input.spaceId,
    tagIds,
  });
  const targetWhere = {
    deletedAt: null,
    organizationId: input.organizationId,
    spaceId: input.spaceId,
    targetId: input.targetId,
    targetType: input.targetType,
  } satisfies Prisma.TagAssignmentWhereInput;
  const removeWhere: Prisma.TagAssignmentWhereInput = { ...targetWhere };

  if (tagIds.length > 0) {
    removeWhere.tagId = {
      notIn: tagIds,
    };
  }

  await tx.tagAssignment.updateMany({
    data: {
      deletedAt: new Date(),
    },
    where: removeWhere,
  });

  if (tagIds.length === 0) {
    return [];
  }

  const existingAssignments = await tx.tagAssignment.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    where: {
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      tagId: {
        in: tagIds,
      },
      targetId: input.targetId,
      targetType: input.targetType,
    },
  });
  const existingByTagId = new Map<
    string,
    (typeof existingAssignments)[number]
  >();

  for (const assignment of existingAssignments) {
    if (!existingByTagId.has(assignment.tagId)) {
      existingByTagId.set(assignment.tagId, assignment);
    }
  }

  for (const tagId of tagIds) {
    const existing = existingByTagId.get(tagId);

    if (existing?.deletedAt === null) {
      continue;
    }

    if (existing) {
      await tx.tagAssignment.update({
        data: {
          assignedById: input.assignedById,
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
        assignedById: input.assignedById,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        tagId,
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
  }

  return sortTags(tags);
}

export async function listTagsByTarget(
  client: TagAssignmentClient,
  input: TargetScope,
): Promise<TagDto[]> {
  const grouped = await listTagsByTargets(client, {
    organizationId: input.organizationId,
    spaceId: input.spaceId,
    targetIds: [input.targetId],
    targetType: input.targetType,
  });

  return grouped.get(input.targetId) ?? [];
}

export async function listTagsByTargets(
  client: TagAssignmentClient,
  input: ListTagsByTargetsInput,
): Promise<Map<string, TagDto[]>> {
  const targetIds = unique(input.targetIds);
  const result = new Map(targetIds.map((targetId) => [targetId, [] as TagDto[]]));

  if (targetIds.length === 0) {
    return result;
  }

  const assignments = await client.tagAssignment.findMany({
    include: {
      tag: true,
    },
    where: {
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      tag: {
        deletedAt: null,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
      targetId: {
        in: targetIds,
      },
      targetType: input.targetType,
    },
  });

  for (const assignment of assignments) {
    const current = result.get(assignment.targetId) ?? [];
    current.push(toTagDto(assignment.tag));
    result.set(assignment.targetId, current);
  }

  for (const [targetId, tags] of result) {
    result.set(targetId, sortTags(tags));
  }

  return result;
}

export async function findTaggedTargetIds(
  client: TagAssignmentClient,
  input: FindTaggedTargetIdsInput,
): Promise<string[] | undefined> {
  const tagIds = parseTagIds(input.tagIds);

  if (tagIds.length === 0) {
    return undefined;
  }

  const assignments = await client.tagAssignment.findMany({
    select: {
      tagId: true,
      targetId: true,
    },
    where: {
      deletedAt: null,
      spaceId: input.spaceId,
      tag: {
        deletedAt: null,
        spaceId: input.spaceId,
      },
      tagId: {
        in: tagIds,
      },
      targetType: input.targetType,
    },
  });

  if ((input.tagMatch ?? "ANY") === "ANY") {
    return unique(assignments.map((assignment) => assignment.targetId));
  }

  const tagIdsByTargetId = new Map<string, Set<string>>();

  for (const assignment of assignments) {
    const current = tagIdsByTargetId.get(assignment.targetId) ?? new Set();
    current.add(assignment.tagId);
    tagIdsByTargetId.set(assignment.targetId, current);
  }

  return [...tagIdsByTargetId.entries()]
    .filter(([, assignedTagIds]) =>
      tagIds.every((tagId) => assignedTagIds.has(tagId)),
    )
    .map(([targetId]) => targetId);
}

function parseTagIds(value: string | undefined) {
  if (!value) {
    return [];
  }

  return unique(
    value
      .split(",")
      .map((tagId) => tagId.trim())
      .filter(Boolean),
  );
}

async function findActiveTagsOrThrow(
  client: TagAssignmentClient,
  input: {
    organizationId: string;
    spaceId: string;
    tagIds: string[];
  },
) {
  if (input.tagIds.length === 0) {
    return [];
  }

  const tags = await client.tag.findMany({
    where: {
      deletedAt: null,
      id: {
        in: input.tagIds,
      },
      organizationId: input.organizationId,
      spaceId: input.spaceId,
    },
  });

  if (tags.length !== input.tagIds.length) {
    throwTagNotFound();
  }

  return tags.map((tag) => toTagDto(tag));
}

function sortTags(tags: TagDto[]) {
  return [...tags].sort((left, right) => {
    const byName = left.normalizedName.localeCompare(right.normalizedName);

    return byName === 0 ? left.id.localeCompare(right.id) : byName;
  });
}

function unique(values: readonly string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function throwTagNotFound(): never {
  throw new ApiException(
    "TAG_NOT_FOUND",
    "Tag not found",
    HttpStatus.NOT_FOUND,
  );
}
