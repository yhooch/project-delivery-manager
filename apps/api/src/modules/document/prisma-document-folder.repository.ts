import { Inject, Injectable } from "@nestjs/common";
import type { DocumentFolderTreeNode } from "@project-delivery/shared";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import { toDocumentFolder } from "./document.mappers";
import type { DocumentFolderRepository } from "./document-folder.repository";
import type {
  CreateDocumentFolderInput,
  DeleteDocumentFolderInput,
  DocumentFolderMutationResult,
  DocumentFolderTreeMutationResult,
  MoveDocumentFolderInput,
  ReorderDocumentFolderInput,
  ReorderDocumentFoldersInput,
  UpdateDocumentFolderInput,
} from "./document.types";

const DOCUMENT_FOLDER_MAX_DEPTH = 6;

@Injectable()
export class PrismaDocumentFolderRepository implements DocumentFolderRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listTree(input: { organizationId: string; spaceId: string }) {
    const [folders, documentCounts] = await Promise.all([
      this.prisma.client.documentFolder.findMany({
        orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        where: {
          deletedAt: null,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
        },
      }),
      this.prisma.client.document.groupBy({
        by: ["folderId"],
        _count: { _all: true },
        where: {
          deletedAt: null,
          folderId: { not: null },
          organizationId: input.organizationId,
          spaceId: input.spaceId,
        },
      }),
    ]);
    const directCounts = new Map(
      documentCounts
        .filter((entry) => entry.folderId)
        .map((entry) => [entry.folderId as string, entry._count._all]),
    );

    return {
      items: buildFolderTree(folders, directCounts),
    };
  }

  async findById(folderId: string) {
    const folder = await this.prisma.client.documentFolder.findFirst({
      where: {
        deletedAt: null,
        id: folderId,
      },
    });

    return folder ? toDocumentFolder(folder) : undefined;
  }

  async listDescendantIds(folderId: string): Promise<string[]> {
    const folder = await this.prisma.client.documentFolder.findFirst({
      select: {
        id: true,
        spaceId: true,
      },
      where: {
        deletedAt: null,
        id: folderId,
      },
    });

    if (!folder) {
      return [];
    }

    const folders = await this.prisma.client.documentFolder.findMany({
      select: {
        id: true,
        parentId: true,
      },
      where: {
        deletedAt: null,
        spaceId: folder.spaceId,
      },
    });

    return collectDescendantIds(folderId, folders);
  }

  async create(
    input: CreateDocumentFolderInput,
  ): Promise<DocumentFolderMutationResult> {
    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        const parent = input.parentId
          ? await tx.documentFolder.findFirst({
              where: {
                deletedAt: null,
                id: input.parentId,
              },
            })
          : undefined;

        if (input.parentId && !parent) {
          return { status: "not_found" as const };
        }
        if (
          parent &&
          (parent.organizationId !== input.organizationId ||
            parent.spaceId !== input.spaceId)
        ) {
          return { status: "cross_space" as const };
        }

        const depth = parent ? parent.depth + 1 : 0;

        if (depth > DOCUMENT_FOLDER_MAX_DEPTH) {
          return { status: "depth_exceeded" as const };
        }

        const folder = await tx.documentFolder.create({
          data: {
            id: input.id,
            organizationId: input.organizationId,
            spaceId: input.spaceId,
            parentId: parent?.id,
            name: input.name,
            normalizedName: input.normalizedName,
            sortOrder: input.sortOrder ?? 0,
            depth,
            createdById: input.createdById,
            updatedById: input.createdById,
          },
        });

        await createFolderTimeline(tx, {
          actorUserId: input.createdById,
          after: folderSnapshot(folder),
          folderId: folder.id,
          operation: "DOCUMENT_FOLDER_CREATED",
          organizationId: folder.organizationId,
          spaceId: folder.spaceId,
          title: "Document folder created",
        });

        return { status: "updated" as const, folder: toDocumentFolder(folder) };
      });

      return result;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { status: "name_conflict" };
      }
      throw error;
    }
  }

  async update(
    input: UpdateDocumentFolderInput,
  ): Promise<DocumentFolderMutationResult> {
    try {
      const result = await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.documentFolder.findFirst({
          where: {
            deletedAt: null,
            id: input.folderId,
          },
        });

        if (!existing) {
          return { status: "not_found" as const };
        }
        if (input.version !== undefined && existing.version !== input.version) {
          return { status: "version_conflict" as const };
        }

        const updated = await tx.documentFolder.update({
          data: {
            name: input.name,
            normalizedName: input.normalizedName,
            updatedById: input.updatedById,
            version: { increment: 1 },
          },
          where: {
            id: existing.id,
          },
        });

        await createFolderTimeline(tx, {
          actorUserId: input.updatedById,
          after: folderSnapshot(updated),
          before: folderSnapshot(existing),
          folderId: updated.id,
          operation: "DOCUMENT_FOLDER_RENAMED",
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          title: "Document folder renamed",
        });

        return { status: "updated" as const, folder: toDocumentFolder(updated) };
      });

      return result;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { status: "name_conflict" };
      }
      throw error;
    }
  }

  async move(input: MoveDocumentFolderInput): Promise<DocumentFolderMutationResult> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.documentFolder.findFirst({
          where: {
            deletedAt: null,
            id: input.folderId,
          },
        });

        if (!existing) {
          return { status: "not_found" as const };
        }
        if (input.version !== undefined && existing.version !== input.version) {
          return { status: "version_conflict" as const };
        }
        if (input.parentId === existing.id) {
          return { status: "cycle" as const };
        }

        const parent = input.parentId
          ? await tx.documentFolder.findFirst({
              where: {
                deletedAt: null,
                id: input.parentId,
              },
            })
          : undefined;

        if (input.parentId && !parent) {
          return { status: "not_found" as const };
        }
        if (
          parent &&
          (parent.organizationId !== existing.organizationId ||
            parent.spaceId !== existing.spaceId)
        ) {
          return { status: "cross_space" as const };
        }

        const allFolders = await tx.documentFolder.findMany({
          select: {
            depth: true,
            id: true,
            parentId: true,
          },
          where: {
            deletedAt: null,
            spaceId: existing.spaceId,
          },
        });
        const descendantIds = collectDescendantIds(existing.id, allFolders);

        if (input.parentId && descendantIds.includes(input.parentId)) {
          return { status: "cycle" as const };
        }

        const nextDepth = parent ? parent.depth + 1 : 0;
        const maxDescendantDelta = maxDescendantDepthDelta(
          existing.id,
          existing.depth,
          allFolders,
        );

        if (nextDepth + maxDescendantDelta > DOCUMENT_FOLDER_MAX_DEPTH) {
          return { status: "depth_exceeded" as const };
        }

        const nameConflict = await tx.documentFolder.findFirst({
          select: { id: true },
          where: {
            deletedAt: null,
            id: { not: existing.id },
            normalizedName: existing.normalizedName,
            parentId: parent?.id ?? null,
            spaceId: existing.spaceId,
          },
        });

        if (nameConflict) {
          return { status: "name_conflict" as const };
        }

        const updated = await tx.documentFolder.update({
          data: {
            parentId: parent?.id ?? null,
            sortOrder: input.sortOrder ?? existing.sortOrder,
            depth: nextDepth,
            updatedById: input.updatedById,
            version: { increment: 1 },
          },
          where: { id: existing.id },
        });
        const depthDelta = nextDepth - existing.depth;

        if (depthDelta !== 0 && descendantIds.length > 0) {
          await tx.documentFolder.updateMany({
            data: {
              depth: { increment: depthDelta },
              updatedById: input.updatedById,
            },
            where: {
              id: { in: descendantIds },
            },
          });
        }

        await createFolderTimeline(tx, {
          actorUserId: input.updatedById,
          after: folderSnapshot(updated),
          before: folderSnapshot(existing),
          folderId: updated.id,
          operation: "DOCUMENT_FOLDER_MOVED",
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          title: "Document folder moved",
        });

        return { status: "updated" as const, folder: toDocumentFolder(updated) };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { status: "name_conflict" };
      }
      throw error;
    }
  }

  async reorder(
    input: ReorderDocumentFolderInput,
  ): Promise<DocumentFolderMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.documentFolder.findFirst({
        where: {
          deletedAt: null,
          id: input.folderId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }
      if (input.version !== undefined && existing.version !== input.version) {
        return { status: "version_conflict" as const };
      }

      const updated = await tx.documentFolder.update({
        data: {
          sortOrder: input.sortOrder,
          updatedById: input.updatedById,
          version: { increment: 1 },
        },
        where: {
          id: existing.id,
        },
      });

      await createFolderTimeline(tx, {
        actorUserId: input.updatedById,
        after: folderSnapshot(updated),
        before: folderSnapshot(existing),
        folderId: updated.id,
        operation: "DOCUMENT_FOLDER_REORDERED",
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
        title: "Document folder reordered",
      });

      return { status: "updated" as const, folder: toDocumentFolder(updated) };
    });

    return result;
  }

  async reorderMany(
    input: ReorderDocumentFoldersInput,
  ): Promise<DocumentFolderTreeMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const parentId = input.parentId ?? null;
      const requestedFolders = await tx.documentFolder.findMany({
        where: {
          deletedAt: null,
          id: { in: input.orderedFolderIds },
        },
      });

      if (requestedFolders.length !== input.orderedFolderIds.length) {
        return { status: "not_found" as const };
      }
      if (
        requestedFolders.some(
          (folder) =>
            folder.organizationId !== input.organizationId ||
            folder.spaceId !== input.spaceId,
        )
      ) {
        return { status: "cross_space" as const };
      }
      if (requestedFolders.some((folder) => folder.parentId !== parentId)) {
        return { status: "not_found" as const };
      }

      const siblingIds = await tx.documentFolder.findMany({
        select: { id: true },
        where: {
          deletedAt: null,
          organizationId: input.organizationId,
          parentId,
          spaceId: input.spaceId,
        },
      });
      const orderedIds = new Set(input.orderedFolderIds);

      if (
        siblingIds.length !== orderedIds.size ||
        siblingIds.some((folder) => !orderedIds.has(folder.id))
      ) {
        return { status: "not_found" as const };
      }

      await Promise.all(
        input.orderedFolderIds.map((folderId, index) =>
          tx.documentFolder.update({
            data: {
              sortOrder: index * 1024,
              updatedById: input.updatedById,
              version: { increment: 1 },
            },
            where: { id: folderId },
          }),
        ),
      );

      await createFolderTimeline(tx, {
        actorUserId: input.updatedById,
        after: {
          orderedFolderIds: input.orderedFolderIds,
          parentId,
        },
        folderId: parentId ?? input.spaceId,
        operation: "DOCUMENT_FOLDERS_REORDERED",
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        title: "Document folders reordered",
      });

      return { status: "updated" as const };
    });

    if (result.status !== "updated") {
      return result;
    }

    return {
      status: "updated",
      tree: await this.listTree({
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      }),
    };
  }

  async delete(
    input: DeleteDocumentFolderInput,
  ): Promise<DocumentFolderMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.documentFolder.findFirst({
        where: {
          deletedAt: null,
          id: input.folderId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }

      const [childCount, documentCount] = await Promise.all([
        tx.documentFolder.count({
          where: {
            deletedAt: null,
            parentId: existing.id,
          },
        }),
        tx.document.count({
          where: {
            deletedAt: null,
            folderId: existing.id,
          },
        }),
      ]);

      if (childCount > 0 || documentCount > 0) {
        return { status: "not_empty" as const };
      }

      const deletedAt = new Date();
      const deleted = await tx.documentFolder.update({
        data: {
          deletedAt,
          updatedById: input.updatedById,
          version: { increment: 1 },
        },
        where: {
          id: existing.id,
        },
      });

      await createFolderTimeline(tx, {
        actorUserId: input.updatedById,
        after: {
          ...folderSnapshot(deleted),
          deletedAt: deletedAt.toISOString(),
        },
        before: folderSnapshot(existing),
        folderId: deleted.id,
        operation: "DOCUMENT_FOLDER_DELETED",
        organizationId: deleted.organizationId,
        spaceId: deleted.spaceId,
        title: "Document folder deleted",
      });

      return { status: "updated" as const, folder: toDocumentFolder(deleted) };
    });

    return result;
  }
}

type FolderParentRecord = {
  id: string;
  parentId: string | null;
};

type FolderDepthRecord = FolderParentRecord & {
  depth: number;
};

type FolderTreeNodeRecord = Parameters<typeof toDocumentFolder>[0];

function buildFolderTree(
  folders: FolderTreeNodeRecord[],
  directCounts: Map<string, number>,
): DocumentFolderTreeNode[] {
  const nodesById = new Map<string, DocumentFolderTreeNode>(
    folders.map((folder) => [
      folder.id,
      {
        ...toDocumentFolder(folder),
        children: [],
        descendantDocumentCount: 0,
        documentCount: directCounts.get(folder.id) ?? 0,
      },
    ]),
  );
  const roots: DocumentFolderTreeNode[] = [];

  for (const folder of folders) {
    const node = nodesById.get(folder.id);

    if (!node) {
      continue;
    }

    if (folder.parentId && nodesById.has(folder.parentId)) {
      nodesById.get(folder.parentId)?.children.push(node);
      continue;
    }

    roots.push(node);
  }

  for (const folder of [...folders].sort((left, right) => right.depth - left.depth)) {
    const node = nodesById.get(folder.id);

    if (!node) {
      continue;
    }

    node.descendantDocumentCount =
      node.documentCount +
      node.children.reduce(
        (total, child) => total + child.descendantDocumentCount,
        0,
      );
  }

  return roots;
}

function collectDescendantIds(folderId: string, folders: FolderParentRecord[]) {
  const childrenByParentId = new Map<string, string[]>();

  for (const folder of folders) {
    if (!folder.parentId) {
      continue;
    }
    childrenByParentId.set(folder.parentId, [
      ...(childrenByParentId.get(folder.parentId) ?? []),
      folder.id,
    ]);
  }

  const result: string[] = [];
  const queue = [...(childrenByParentId.get(folderId) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    result.push(current);
    queue.push(...(childrenByParentId.get(current) ?? []));
  }

  return result;
}

function maxDescendantDepthDelta(
  folderId: string,
  folderDepth: number,
  folders: FolderDepthRecord[],
) {
  const descendants = new Set(collectDescendantIds(folderId, folders));

  return folders.reduce((max, folder) => {
    if (!descendants.has(folder.id)) {
      return max;
    }

    return Math.max(max, folder.depth - folderDepth);
  }, 0);
}

function folderSnapshot(folder: {
  depth: number;
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  version: number;
}) {
  return {
    folderId: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    sortOrder: folder.sortOrder,
    depth: folder.depth,
    version: folder.version,
  };
}

async function createFolderTimeline(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    after?: Record<string, unknown>;
    before?: Record<string, unknown>;
    folderId: string;
    operation: string;
    organizationId: string;
    spaceId: string;
    title: string;
  },
) {
  await createTimelineEventRecord(tx, {
    actorUserId: input.actorUserId,
    after: input.after,
    before: input.before,
    eventType: "UPDATED",
    metadata: {
      folderId: input.folderId,
      operation: input.operation,
    },
    organizationId: input.organizationId,
    spaceId: input.spaceId,
    targetId: input.spaceId,
    targetType: "SPACE",
    title: input.title,
  });
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
