import { Inject, Injectable } from "@nestjs/common";
import type {
  DocumentChunk,
  DocumentFolderPathItem,
  DocumentLink,
  WorkItemType,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  findTaggedTargetIds,
  listTagsByTargets,
  replaceTagAssignmentsInTransaction,
} from "../tag/tag-assignment.helpers";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import {
  toDocument,
  toDocumentChunk,
  toDocumentDetail,
  toDocumentListItem,
  toDocumentLink,
  toDocumentRevision,
  type DocumentActorDisplayContext,
} from "./document.mappers";
import type { DocumentRepository } from "./document.repository";
import type {
  CreateDocumentInput,
  DocumentListInput,
  DocumentBatchMutationResult,
  DocumentMutationResult,
  MoveDocumentsToFolderInput,
  MoveDocumentToFolderInput,
  ReplaceDocumentLinksInput,
  SearchCurrentRevisionChunksInput,
  UpdateDocumentContentInput,
  UpdateDocumentMetadataInput,
  UpdateDocumentStateInput,
} from "./document.types";

type DocumentLinkRecord = {
  createdAt: Date;
  createdById: string;
  deletedAt: Date | null;
  documentId: string;
  id: string;
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: DocumentLink["targetType"];
};

type HydratedDocumentLinkRecord = DocumentLinkRecord & {
  displayCode?: string | null;
  title?: string | null;
  workItemType?: WorkItemType | null;
};

type PrismaDocumentRecord = Parameters<typeof toDocument>[0];
type PrismaDocumentListRecord = Parameters<typeof toDocumentListItem>[0];

const DOCUMENT_DETAIL_OVERVIEW_LIMIT = 5;
const documentListSelect = {
  archivedAt: true,
  createdAt: true,
  createdById: true,
  createdMcpClientId: true,
  createdVia: true,
  deletedAt: true,
  folderId: true,
  id: true,
  lastEditedAt: true,
  lastEditedById: true,
  lastEditedMcpClientId: true,
  lastEditedVia: true,
  organizationId: true,
  revision: true,
  sourceAttachmentId: true,
  sourceType: true,
  spaceId: true,
  status: true,
  title: true,
  updatedAt: true,
} satisfies Prisma.DocumentSelect;

@Injectable()
export class PrismaDocumentRepository implements DocumentRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async create(input: CreateDocumentInput) {
    const document = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          folderId: input.folderId,
          title: input.title,
          contentMarkdown: input.contentMarkdown,
          contentText: input.contentText,
          sourceType: input.sourceType,
          createdVia: input.actorType,
          createdMcpClientId: input.mcpClientId,
          lastEditedById: input.actorUserId,
          lastEditedVia: input.actorType,
          lastEditedMcpClientId: input.mcpClientId,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
      });

      const sourceAttachment = input.sourceAttachment
        ? await tx.attachment.create({
            data: {
              id: ulid(),
              organizationId: input.organizationId,
              spaceId: input.spaceId,
              targetType: "DOCUMENT",
              targetId: created.id,
              fileName: input.sourceAttachment.fileName,
              fileKey: input.sourceAttachment.fileKey,
              mimeType: input.sourceAttachment.mimeType,
              size: input.sourceAttachment.size,
              uploadedById: input.actorUserId,
              createdById: input.actorUserId,
              updatedById: input.actorUserId,
            },
          })
        : undefined;

      const withSource = sourceAttachment
        ? await tx.document.update({
            data: {
              sourceAttachmentId: sourceAttachment.id,
            },
            where: {
              id: created.id,
            },
          })
        : created;

      await createRevision(tx, input, {
        changeType: input.sourceType === "MCP_CREATED" ? "CREATED" : "IMPORTED",
        documentId: created.id,
        organizationId: input.organizationId,
        revision: withSource.revision,
        spaceId: input.spaceId,
        title: withSource.title,
        contentMarkdown: withSource.contentMarkdown,
        contentText: withSource.contentText,
      });
      await replaceChunks(tx, {
        chunks: input.chunks,
        document: withSource,
      });
      await ensureCreatorParticipant(tx, input);
      await replaceTagAssignmentsInTransaction(tx, {
        assignedById: input.actorUserId,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        tagIds: input.tagIds,
        targetId: created.id,
        targetType: "DOCUMENT",
      });
      await replaceLinksInTransaction(tx, {
        actorUserId: input.actorUserId,
        documentId: created.id,
        links: input.links ?? [],
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      });
      await createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          revision: withSource.revision,
          sourceType: input.sourceType,
          title: input.title,
        },
        eventType: "CREATED",
        metadata: {
          operation: "DOCUMENT_CREATED",
          ...(sourceAttachment ? { attachmentId: sourceAttachment.id } : {}),
        },
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: created.id,
        targetType: "DOCUMENT",
        title: "Document created",
      });

      return withSource;
    });

    return (await this.findById(document.id)) ?? toDocument(document);
  }

  async findById(documentId: string) {
    const document = await this.findLiveDocument(documentId);

    if (!document) {
      return undefined;
    }

    return toDocument(document, await this.loadDocumentContext(document));
  }

  async findDetailById(documentId: string) {
    const document = await this.findLiveDocument(documentId);

    if (!document) {
      return undefined;
    }

    const targetWhere = documentTargetWhere(document);
    const [
      context,
      attachments,
      attachmentTotal,
      comments,
      commentTotal,
      timeline,
      timelineTotal,
    ] = await Promise.all([
      this.loadDocumentContext(document),
      this.prisma.client.attachment.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: DOCUMENT_DETAIL_OVERVIEW_LIMIT,
        where: targetWhere,
      }),
      this.prisma.client.attachment.count({
        where: targetWhere,
      }),
      this.prisma.client.comment.findMany({
        include: {
          author: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: DOCUMENT_DETAIL_OVERVIEW_LIMIT,
        where: targetWhere,
      }),
      this.prisma.client.comment.count({
        where: targetWhere,
      }),
      this.prisma.client.timelineEvent.findMany({
        include: {
          actor: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: DOCUMENT_DETAIL_OVERVIEW_LIMIT,
        where: targetWhere,
      }),
      this.prisma.client.timelineEvent.count({
        where: targetWhere,
      }),
    ]);

    return toDocumentDetail(document, {
      ...context,
      attachments,
      attachmentTotal,
      comments,
      commentTotal,
      timeline,
      timelineTotal,
    });
  }

  private async loadDocumentContext(document: PrismaDocumentRecord) {
    const [
      links,
      chunks,
      tagsByDocumentId,
      actorContextByDocumentId,
      folderPaths,
    ] = await Promise.all([
      this.prisma.client.documentLink.findMany({
        orderBy: {
          createdAt: "asc",
        },
        where: {
          deletedAt: null,
          documentId: document.id,
          organizationId: document.organizationId,
          spaceId: document.spaceId,
        },
      }),
      this.prisma.client.documentChunk.findMany({
        orderBy: {
          ordinal: "asc",
        },
        take: 20,
        where: {
          documentId: document.id,
          organizationId: document.organizationId,
          revision: document.revision,
          spaceId: document.spaceId,
        },
      }),
      listTagsByTargets(this.prisma.client, {
        organizationId: document.organizationId,
        spaceId: document.spaceId,
        targetIds: [document.id],
        targetType: "DOCUMENT",
      }),
      this.loadDocumentActorContexts([document]),
      this.loadDocumentFolderPaths([document]),
    ]);
    const hydratedLinks = await this.hydrateLinks(
      links,
      document.organizationId,
      document.spaceId,
    );

    return {
      chunks,
      links: hydratedLinks,
      tags: tagsByDocumentId.get(document.id) ?? [],
      folderPath: folderPaths.get(document.id),
      ...actorContextByDocumentId.get(document.id),
    };
  }

  private async hydrateDocuments(documents: PrismaDocumentRecord[]) {
    if (documents.length === 0) {
      return [];
    }

    const first = documents[0];
    if (!first) {
      return [];
    }

    const targetIds = documents.map((document) => document.id);
    const [
      tagsByDocumentId,
      linksByDocumentId,
      actorContextByDocumentId,
      folderPathsByDocumentId,
    ] = await Promise.all([
      listTagsByTargets(this.prisma.client, {
        organizationId: first.organizationId,
        spaceId: first.spaceId,
        targetIds,
        targetType: "DOCUMENT",
      }),
      this.listLinksByDocumentIds({
        documentIds: targetIds,
        organizationId: first.organizationId,
        spaceId: first.spaceId,
      }),
      this.loadDocumentActorContexts(documents),
      this.loadDocumentFolderPaths(documents),
    ]);

    return documents.map((document) =>
      toDocument(document, {
        ...actorContextByDocumentId.get(document.id),
        folderPath: folderPathsByDocumentId.get(document.id),
        links: linksByDocumentId.get(document.id) ?? [],
        tags: tagsByDocumentId.get(document.id) ?? [],
      }),
    );
  }

  private async hydrateDocumentListItems(
    documents: PrismaDocumentListRecord[],
  ) {
    if (documents.length === 0) {
      return [];
    }

    const first = documents[0];
    if (!first) {
      return [];
    }

    const targetIds = documents.map((document) => document.id);
    const [
      tagsByDocumentId,
      linksByDocumentId,
      actorContextByDocumentId,
      folderPathsByDocumentId,
    ] = await Promise.all([
      listTagsByTargets(this.prisma.client, {
        organizationId: first.organizationId,
        spaceId: first.spaceId,
        targetIds,
        targetType: "DOCUMENT",
      }),
      this.listLinksByDocumentIds({
        documentIds: targetIds,
        organizationId: first.organizationId,
        spaceId: first.spaceId,
      }),
      this.loadDocumentActorContexts(documents),
      this.loadDocumentFolderPaths(documents),
    ]);

    return documents.map((document) =>
      toDocumentListItem(document, {
        ...actorContextByDocumentId.get(document.id),
        folderPath: folderPathsByDocumentId.get(document.id),
        links: linksByDocumentId.get(document.id) ?? [],
        tags: tagsByDocumentId.get(document.id) ?? [],
      }),
    );
  }

  private async loadDocumentActorContexts(
    documents: PrismaDocumentListRecord[],
  ): Promise<Map<string, DocumentActorDisplayContext>> {
    const result = new Map<string, DocumentActorDisplayContext>();

    if (documents.length === 0) {
      return result;
    }

    const userIds = new Set<string>();
    const clientIds = new Set<string>();

    for (const document of documents) {
      userIds.add(document.createdById ?? document.lastEditedById);
      userIds.add(document.lastEditedById);
      if (document.createdMcpClientId) {
        clientIds.add(document.createdMcpClientId);
      }
      if (document.lastEditedMcpClientId) {
        clientIds.add(document.lastEditedMcpClientId);
      }
    }

    const [users, clients] = await Promise.all([
      userIds.size > 0
        ? this.prisma.client.user.findMany({
            select: {
              id: true,
              name: true,
              username: true,
            },
            where: {
              id: {
                in: [...userIds],
              },
            },
          })
        : [],
      clientIds.size > 0
        ? this.prisma.client.mcpOAuthClient.findMany({
            select: {
              clientId: true,
              clientName: true,
            },
            where: {
              clientId: {
                in: [...clientIds],
              },
            },
          })
        : [],
    ]);

    const userNamesById = new Map(
      users.map((user) => [
        user.id,
        nonEmptyString(user.name) ?? user.username,
      ]),
    );
    const clientNamesById = new Map(
      clients.map((client) => [client.clientId, client.clientName]),
    );

    for (const document of documents) {
      const createdById = document.createdById ?? document.lastEditedById;

      result.set(document.id, {
        createdByName: userNamesById.get(createdById),
        createdMcpClientName: document.createdMcpClientId
          ? clientNamesById.get(document.createdMcpClientId)
          : undefined,
        lastEditedByName: userNamesById.get(document.lastEditedById),
        lastEditedMcpClientName: document.lastEditedMcpClientId
          ? clientNamesById.get(document.lastEditedMcpClientId)
          : undefined,
      });
    }

    return result;
  }

  private async loadDocumentFolderPaths(
    documents: PrismaDocumentListRecord[],
  ): Promise<Map<string, DocumentFolderPathItem[]>> {
    const result = new Map<string, DocumentFolderPathItem[]>();
    const folderIds = [
      ...new Set(
        documents
          .map((document) => document.folderId)
          .filter((folderId): folderId is string => Boolean(folderId)),
      ),
    ];

    if (folderIds.length === 0) {
      return result;
    }

    const spaceIds = [
      ...new Set(documents.map((document) => document.spaceId)),
    ];
    const folders = await this.prisma.client.documentFolder.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
      },
      where: {
        deletedAt: null,
        spaceId: { in: spaceIds },
      },
    });
    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));

    for (const document of documents) {
      if (!document.folderId) {
        continue;
      }

      result.set(document.id, buildFolderPath(document.folderId, foldersById));
    }

    return result;
  }

  private async findLiveDocument(documentId: string) {
    return this.prisma.client.document.findFirst({
      where: {
        deletedAt: null,
        id: documentId,
      },
    });
  }

  async list(input: DocumentListInput) {
    const where = await this.buildListWhere(input);

    if (isKnownEmptyIdFilter(where.id)) {
      return {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      };
    }

    const [documents, total] = await this.prisma.client.$transaction([
      this.prisma.client.document.findMany({
        orderBy: toDocumentOrderBy(input),
        select: documentListSelect,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.document.count({ where }),
    ]);
    return {
      items: await this.hydrateDocumentListItems(documents),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async updateMetadata(
    input: UpdateDocumentMetadataInput,
  ): Promise<DocumentMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.documentId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }
      if (
        input.baseRevision !== undefined &&
        existing.revision !== input.baseRevision
      ) {
        return { status: "conflict" as const };
      }

      const nextRevision = existing.revision + 1;
      const updated = await tx.document.update({
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          lastEditedAt: new Date(),
          lastEditedById: input.actorUserId,
          lastEditedVia: input.actorType,
          lastEditedMcpClientId: input.mcpClientId,
          revision: nextRevision,
          updatedById: input.actorUserId,
        },
        where: {
          id: existing.id,
        },
      });

      await createRevision(tx, input, {
        changeType: "METADATA_UPDATED",
        documentId: updated.id,
        organizationId: updated.organizationId,
        revision: updated.revision,
        spaceId: updated.spaceId,
        title: updated.title,
        contentMarkdown: updated.contentMarkdown,
        contentText: updated.contentText,
      });
      if (input.tagIds) {
        await replaceTagAssignmentsInTransaction(tx, {
          assignedById: input.actorUserId,
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          tagIds: input.tagIds,
          targetId: updated.id,
          targetType: "DOCUMENT",
        });
      }
      if (input.links) {
        await replaceLinksInTransaction(tx, {
          actorUserId: input.actorUserId,
          documentId: updated.id,
          links: input.links,
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
        });
      }
      await createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          revision: updated.revision,
          title: updated.title,
        },
        before: {
          revision: existing.revision,
          title: existing.title,
        },
        eventType: "UPDATED",
        metadata: { operation: "DOCUMENT_METADATA_UPDATED" },
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
        targetId: updated.id,
        targetType: "DOCUMENT",
        title: "Document metadata updated",
      });

      return { status: "updated" as const, document: updated };
    });

    return result.status === "updated"
      ? {
          status: "updated",
          document:
            (await this.findById(result.document.id)) ??
            toDocument(result.document),
        }
      : result;
  }

  async updateContent(
    input: UpdateDocumentContentInput,
  ): Promise<DocumentMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.documentId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }
      if (existing.revision !== input.baseRevision) {
        return { status: "conflict" as const };
      }

      const sourceAttachment = input.sourceAttachment
        ? await tx.attachment.create({
            data: {
              id: ulid(),
              organizationId: existing.organizationId,
              spaceId: existing.spaceId,
              targetType: "DOCUMENT",
              targetId: existing.id,
              fileName: input.sourceAttachment.fileName,
              fileKey: input.sourceAttachment.fileKey,
              mimeType: input.sourceAttachment.mimeType,
              size: input.sourceAttachment.size,
              uploadedById: input.actorUserId,
              createdById: input.actorUserId,
              updatedById: input.actorUserId,
            },
          })
        : undefined;
      const updated = await tx.document.update({
        data: {
          contentMarkdown: input.contentMarkdown,
          contentText: input.contentText,
          ...(sourceAttachment
            ? { sourceAttachmentId: sourceAttachment.id }
            : {}),
          lastEditedAt: new Date(),
          lastEditedById: input.actorUserId,
          lastEditedVia: input.actorType,
          lastEditedMcpClientId: input.mcpClientId,
          revision: existing.revision + 1,
          updatedById: input.actorUserId,
        },
        where: {
          id: existing.id,
        },
      });

      await createRevision(tx, input, {
        changeType: input.changeType,
        documentId: updated.id,
        organizationId: updated.organizationId,
        revision: updated.revision,
        spaceId: updated.spaceId,
        title: updated.title,
        contentMarkdown: updated.contentMarkdown,
        contentText: updated.contentText,
      });
      await replaceChunks(tx, {
        chunks: input.chunks,
        document: updated,
      });
      await createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          revision: updated.revision,
        },
        before: {
          revision: existing.revision,
        },
        eventType: "UPDATED",
        metadata: {
          operation: input.changeType,
          ...(sourceAttachment ? { attachmentId: sourceAttachment.id } : {}),
        },
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
        targetId: updated.id,
        targetType: "DOCUMENT",
        title: "Document content updated",
      });

      return { status: "updated" as const, document: updated };
    });

    return result.status === "updated"
      ? {
          status: "updated",
          document:
            (await this.findById(result.document.id)) ??
            toDocument(result.document),
        }
      : result;
  }

  async updateState(
    input: UpdateDocumentStateInput,
  ): Promise<DocumentMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.documentId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }

      const now = new Date();
      const updated = await tx.document.update({
        data:
          input.changeType === "DELETED"
            ? {
                deletedAt: now,
                lastEditedAt: now,
                lastEditedById: input.actorUserId,
                lastEditedVia: input.actorType,
                lastEditedMcpClientId: input.mcpClientId,
                revision: existing.revision + 1,
                updatedById: input.actorUserId,
              }
            : {
                archivedAt: input.changeType === "ARCHIVED" ? now : null,
                status: input.changeType === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
                lastEditedAt: now,
                lastEditedById: input.actorUserId,
                lastEditedVia: input.actorType,
                lastEditedMcpClientId: input.mcpClientId,
                revision: existing.revision + 1,
                updatedById: input.actorUserId,
              },
        where: {
          id: existing.id,
        },
      });

      await createRevision(tx, input, {
        changeType: input.changeType,
        documentId: updated.id,
        organizationId: updated.organizationId,
        revision: updated.revision,
        spaceId: updated.spaceId,
        title: updated.title,
        contentMarkdown: updated.contentMarkdown,
        contentText: updated.contentText,
      });
      await createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          revision: updated.revision,
          status: updated.status,
        },
        before: {
          revision: existing.revision,
          status: existing.status,
        },
        eventType:
          input.changeType === "DELETED" ? "UPDATED" : "STATUS_CHANGED",
        metadata: { operation: input.changeType },
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
        targetId: updated.id,
        targetType: "DOCUMENT",
        title: `Document ${input.changeType.toLowerCase()}`,
      });

      return { status: "updated" as const, document: updated };
    });

    return result.status === "updated"
      ? {
          status: "updated",
          document:
            (await this.findById(result.document.id)) ??
            toDocument(result.document),
        }
      : result;
  }

  async listRevisions(input: {
    documentId: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.DocumentRevisionWhereInput = {
      documentId: input.documentId,
    };
    const [revisions, total] = await this.prisma.client.$transaction([
      this.prisma.client.documentRevision.findMany({
        orderBy: { revision: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.documentRevision.count({ where }),
    ]);

    return {
      items: revisions.map(toDocumentRevision),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async listLinks(documentId: string) {
    const links = await this.prisma.client.documentLink.findMany({
      orderBy: { createdAt: "asc" },
      where: {
        deletedAt: null,
        documentId,
      },
    });

    const first = links[0];
    const hydratedLinks = first
      ? await this.hydrateLinks(links, first.organizationId, first.spaceId)
      : [];

    return hydratedLinks.map(toDocumentLink);
  }

  async moveToFolder(
    input: MoveDocumentToFolderInput,
  ): Promise<DocumentMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.documentId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }
      if (
        input.baseRevision !== undefined &&
        existing.revision !== input.baseRevision
      ) {
        return { status: "conflict" as const };
      }

      const updated = await tx.document.update({
        data: {
          folderId: input.folderId ?? null,
          lastEditedAt: new Date(),
          lastEditedById: input.actorUserId,
          lastEditedVia: input.actorType,
          lastEditedMcpClientId: input.mcpClientId ?? null,
          revision: existing.revision + 1,
          updatedById: input.actorUserId,
        },
        where: {
          id: existing.id,
        },
      });

      await createRevision(tx, input, {
        changeType: "METADATA_UPDATED",
        documentId: updated.id,
        organizationId: updated.organizationId,
        revision: updated.revision,
        spaceId: updated.spaceId,
        title: updated.title,
        contentMarkdown: updated.contentMarkdown,
        contentText: updated.contentText,
      });
      await createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          folderId: updated.folderId,
          revision: updated.revision,
        },
        before: {
          folderId: existing.folderId,
          revision: existing.revision,
        },
        eventType: "UPDATED",
        metadata: {
          operation: "DOCUMENT_FOLDER_UPDATED",
        },
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
        targetId: updated.id,
        targetType: "DOCUMENT",
        title: "Document folder updated",
      });

      return { status: "updated" as const, document: updated };
    });

    return result.status === "updated"
      ? {
          status: "updated",
          document:
            (await this.findById(result.document.id)) ??
            toDocument(result.document),
        }
      : result;
  }

  async moveManyToFolder(
    input: MoveDocumentsToFolderInput,
  ): Promise<DocumentBatchMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existingDocuments = await tx.document.findMany({
        where: {
          deletedAt: null,
          id: { in: input.documentIds },
        },
      });

      if (existingDocuments.length !== input.documentIds.length) {
        return { status: "not_found" as const };
      }
      if (
        existingDocuments.some(
          (document) =>
            document.organizationId !== input.organizationId ||
            document.spaceId !== input.spaceId,
        )
      ) {
        return { status: "not_found" as const };
      }

      const documentsById = new Map(
        existingDocuments.map((document) => [document.id, document]),
      );
      const updatedDocuments: PrismaDocumentRecord[] = [];

      for (const documentId of input.documentIds) {
        const existing = documentsById.get(documentId);

        if (!existing) {
          return { status: "not_found" as const };
        }

        const updated = await tx.document.update({
          data: {
            folderId: input.folderId ?? null,
            lastEditedAt: new Date(),
            lastEditedById: input.actorUserId,
            lastEditedVia: input.actorType,
            lastEditedMcpClientId: input.mcpClientId ?? null,
            revision: existing.revision + 1,
            updatedById: input.actorUserId,
          },
          where: {
            id: existing.id,
          },
        });

        await createRevision(tx, input, {
          changeType: "METADATA_UPDATED",
          documentId: updated.id,
          organizationId: updated.organizationId,
          revision: updated.revision,
          spaceId: updated.spaceId,
          title: updated.title,
          contentMarkdown: updated.contentMarkdown,
          contentText: updated.contentText,
        });
        await createTimelineEventRecord(tx, {
          actorUserId: input.actorUserId,
          after: {
            folderId: updated.folderId,
            revision: updated.revision,
          },
          before: {
            folderId: existing.folderId,
            revision: existing.revision,
          },
          eventType: "UPDATED",
          metadata: {
            operation: "DOCUMENT_FOLDER_UPDATED",
          },
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          targetId: updated.id,
          targetType: "DOCUMENT",
          title: "Document folder updated",
        });

        updatedDocuments.push(updated);
      }

      return { status: "updated" as const, documents: updatedDocuments };
    });

    return result.status === "updated"
      ? {
          status: "updated",
          documents: await this.hydrateDocuments(result.documents),
        }
      : result;
  }

  async replaceLinks(
    input: ReplaceDocumentLinksInput,
  ): Promise<DocumentMutationResult> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.documentId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }
      if (existing.revision !== input.baseRevision) {
        return { status: "conflict" as const };
      }

      const updated = await tx.document.update({
        data: {
          lastEditedAt: new Date(),
          lastEditedById: input.actorUserId,
          lastEditedVia: input.actorType,
          lastEditedMcpClientId: input.mcpClientId ?? null,
          revision: existing.revision + 1,
          updatedById: input.actorUserId,
        },
        where: {
          id: existing.id,
        },
      });
      await replaceLinksInTransaction(tx, {
        actorUserId: input.actorUserId,
        documentId: updated.id,
        links: input.links,
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
      });
      await createRevision(tx, input, {
        changeType: "METADATA_UPDATED",
        documentId: updated.id,
        organizationId: updated.organizationId,
        revision: updated.revision,
        spaceId: updated.spaceId,
        title: updated.title,
        contentMarkdown: updated.contentMarkdown,
        contentText: updated.contentText,
      });
      await createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          revision: updated.revision,
        },
        before: {
          revision: existing.revision,
        },
        eventType: "UPDATED",
        metadata: {
          operation: "DOCUMENT_LINKS_UPDATED",
        },
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
        targetId: updated.id,
        targetType: "DOCUMENT",
        title: "Document links updated",
      });

      return { status: "updated" as const, document: updated };
    });

    return result.status === "updated"
      ? {
          status: "updated",
          document:
            (await this.findById(result.document.id)) ??
            toDocument(result.document),
        }
      : result;
  }

  async listChunks(input: {
    documentId: string;
    page: number;
    pageSize: number;
  }) {
    const document = await this.prisma.client.document.findFirst({
      select: {
        revision: true,
      },
      where: {
        deletedAt: null,
        id: input.documentId,
      },
    });
    const where: Prisma.DocumentChunkWhereInput = {
      documentId: input.documentId,
      ...(document ? { revision: document.revision } : {}),
    };
    const [chunks, total] = await this.prisma.client.$transaction([
      this.prisma.client.documentChunk.findMany({
        orderBy: { ordinal: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.documentChunk.count({ where }),
    ]);

    return {
      items: chunks.map(toDocumentChunk),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async searchCurrentRevisionChunks(input: SearchCurrentRevisionChunksInput) {
    const normalizedQuery = normalizeSearchText(input.query);

    if (
      input.documents.length === 0 ||
      normalizedQuery === "" ||
      input.maxHitsPerDocument <= 0
    ) {
      return [];
    }

    const chunks = await this.prisma.client.documentChunk.findMany({
      orderBy: [{ documentId: "asc" }, { ordinal: "asc" }],
      where: {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        OR: input.documents.map((document) => ({
          documentId: document.documentId,
          revision: document.revision,
        })),
      },
    });
    const normalizedQueryLower = normalizedQuery.toLowerCase();
    const countsByDocumentId = new Map<string, number>();
    const result: DocumentChunk[] = [];

    for (const chunk of chunks) {
      const currentCount = countsByDocumentId.get(chunk.documentId) ?? 0;

      if (currentCount >= input.maxHitsPerDocument) {
        continue;
      }
      if (
        !normalizeSearchText(chunk.contentText)
          .toLowerCase()
          .includes(normalizedQueryLower)
      ) {
        continue;
      }

      countsByDocumentId.set(chunk.documentId, currentCount + 1);
      result.push(toDocumentChunk(chunk));
    }

    return result;
  }

  async listLinksByTarget(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    spaceId: string;
    targetId: string;
    targetType: DocumentLink["targetType"];
  }) {
    const where: Prisma.DocumentLinkWhereInput = {
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: input.targetType,
      document: {
        deletedAt: null,
      },
    };
    const [links, total] = await this.prisma.client.$transaction([
      this.prisma.client.documentLink.findMany({
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.documentLink.count({ where }),
    ]);

    return {
      items: (
        await this.hydrateLinks(links, input.organizationId, input.spaceId)
      ).map(toDocumentLink),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  private async buildListWhere(input: DocumentListInput) {
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      ...(input.lastEditedVia ? { lastEditedVia: input.lastEditedVia } : {}),
      ...(input.createdById ? { createdById: input.createdById } : {}),
      ...(await this.buildFolderWhere(input)),
      ...(input.query
        ? {
            OR: [
              { title: { contains: input.query, mode: "insensitive" } },
              { contentText: { contains: input.query, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(input.linkedTargetType && input.linkedTargetId
        ? {
            links: {
              some: {
                deletedAt: null,
                targetId: input.linkedTargetId,
                targetType: input.linkedTargetType,
              },
            },
          }
        : {}),
    };
    const taggedTargetIds = await findTaggedTargetIds(this.prisma.client, {
      spaceId: input.spaceId,
      tagIds: input.tagIds,
      tagMatch: input.tagMatch,
      targetType: "DOCUMENT",
    });

    applyTaggedTargetIds(where, taggedTargetIds);

    return where;
  }

  private async listLinksByDocumentIds(input: {
    documentIds: string[];
    organizationId: string;
    spaceId: string;
  }): Promise<Map<string, HydratedDocumentLinkRecord[]>> {
    const result = new Map(
      input.documentIds.map((documentId) => [
        documentId,
        [] as HydratedDocumentLinkRecord[],
      ]),
    );

    if (input.documentIds.length === 0) {
      return result;
    }

    const links = await this.prisma.client.documentLink.findMany({
      orderBy: { createdAt: "asc" },
      where: {
        deletedAt: null,
        documentId: { in: input.documentIds },
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      },
    });
    const hydratedLinks = await this.hydrateLinks(
      links,
      input.organizationId,
      input.spaceId,
    );

    for (const link of hydratedLinks) {
      const current = result.get(link.documentId) ?? [];
      current.push(link);
      result.set(link.documentId, current);
    }

    return result;
  }

  private async buildFolderWhere(
    input: Pick<
      DocumentListInput,
      "folderId" | "includeDescendants" | "unfiled"
    >,
  ): Promise<Prisma.DocumentWhereInput> {
    if (input.folderId) {
      return {
        folderId: {
          in: input.includeDescendants
            ? [
                input.folderId,
                ...(await this.listFolderDescendantIds(input.folderId)),
              ]
            : [input.folderId],
        },
      };
    }

    return input.unfiled === true ? { folderId: null } : {};
  }

  private async listFolderDescendantIds(folderId: string): Promise<string[]> {
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

    return collectFolderDescendantIds(folder.id, folders);
  }

  private async hydrateLinks(
    links: DocumentLinkRecord[],
    organizationId: string,
    spaceId: string,
  ): Promise<HydratedDocumentLinkRecord[]> {
    if (links.length === 0) {
      return [];
    }

    const targetIdsByType = new Map<DocumentLink["targetType"], string[]>();

    for (const link of links) {
      targetIdsByType.set(link.targetType, [
        ...(targetIdsByType.get(link.targetType) ?? []),
        link.targetId,
      ]);
    }

    const summaries = new Map<
      string,
      { displayCode?: string; title?: string; workItemType?: WorkItemType }
    >();
    const [documents, versions, requirements, intakeItems, workItems] =
      await Promise.all([
        this.prisma.client.document.findMany({
          select: { id: true, title: true },
          where: targetWhere(targetIdsByType.get("DOCUMENT"), {
            organizationId,
            spaceId,
          }),
        }),
        this.prisma.client.version.findMany({
          select: { id: true, name: true },
          where: targetWhere(targetIdsByType.get("VERSION"), {
            organizationId,
            spaceId,
          }),
        }),
        this.prisma.client.requirement.findMany({
          select: { id: true, sequence: true, title: true },
          where: targetWhere(targetIdsByType.get("REQUIREMENT"), {
            organizationId,
            spaceId,
          }),
        }),
        this.prisma.client.intakeItem.findMany({
          select: { id: true, sequence: true, title: true },
          where: targetWhere(targetIdsByType.get("INTAKE_ITEM"), {
            organizationId,
            spaceId,
          }),
        }),
        this.prisma.client.workItem.findMany({
          select: { id: true, sequence: true, title: true, type: true },
          where: targetWhere(targetIdsByType.get("WORK_ITEM"), {
            organizationId,
            spaceId,
          }),
        }),
      ]);

    for (const target of documents) {
      summaries.set(linkKey({ targetId: target.id, targetType: "DOCUMENT" }), {
        title: target.title,
      });
    }
    for (const target of versions) {
      summaries.set(linkKey({ targetId: target.id, targetType: "VERSION" }), {
        title: target.name,
      });
    }
    for (const target of requirements) {
      summaries.set(
        linkKey({ targetId: target.id, targetType: "REQUIREMENT" }),
        {
          displayCode: formatDisplayCode("REQ", target.sequence),
          title: target.title,
        },
      );
    }
    for (const target of intakeItems) {
      summaries.set(
        linkKey({ targetId: target.id, targetType: "INTAKE_ITEM" }),
        {
          displayCode: formatDisplayCode("INTAKE", target.sequence),
          title: target.title,
        },
      );
    }
    for (const target of workItems) {
      summaries.set(linkKey({ targetId: target.id, targetType: "WORK_ITEM" }), {
        displayCode: formatDisplayCode(target.type, target.sequence),
        title: target.title,
        workItemType: target.type,
      });
    }

    return links.map((link) => ({
      ...link,
      ...summaries.get(linkKey(link)),
    }));
  }
}

function targetWhere(
  ids: string[] | undefined,
  tenant: { organizationId: string; spaceId: string },
) {
  return {
    deletedAt: null,
    id: { in: [...new Set(ids ?? [])] },
    organizationId: tenant.organizationId,
    spaceId: tenant.spaceId,
  };
}

async function createRevision(
  tx: Prisma.TransactionClient,
  actor: {
    actorType: CreateDocumentInput["actorType"];
    actorUserId: string;
    mcpClientId?: string;
    requestId?: string;
  },
  input: {
    changeType: Prisma.DocumentRevisionCreateInput["changeType"];
    contentMarkdown: string;
    contentText: string;
    documentId: string;
    organizationId: string;
    revision: number;
    spaceId: string;
    title: string;
  },
) {
  await tx.documentRevision.create({
    data: {
      id: ulid(),
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      documentId: input.documentId,
      revision: input.revision,
      title: input.title,
      contentMarkdown: input.contentMarkdown,
      contentText: input.contentText,
      changeType: input.changeType,
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      mcpClientId: actor.mcpClientId,
      requestId: actor.requestId,
    },
  });
}

async function replaceChunks(
  tx: Prisma.TransactionClient,
  input: {
    chunks: CreateDocumentInput["chunks"];
    document: {
      id: string;
      organizationId: string;
      revision: number;
      spaceId: string;
    };
  },
) {
  await tx.documentChunk.deleteMany({
    where: {
      documentId: input.document.id,
      revision: input.document.revision,
    },
  });

  if (input.chunks.length === 0) {
    return;
  }

  await tx.documentChunk.createMany({
    data: input.chunks.map((chunk) => ({
      id: ulid(),
      organizationId: input.document.organizationId,
      spaceId: input.document.spaceId,
      documentId: input.document.id,
      revision: input.document.revision,
      ordinal: chunk.ordinal,
      headingPath: chunk.headingPath,
      contentText: chunk.contentText,
    })),
  });
}

async function ensureCreatorParticipant(
  tx: Prisma.TransactionClient,
  input: CreateDocumentInput,
) {
  await tx.objectParticipant.create({
    data: {
      id: ulid(),
      createdById: input.actorUserId,
      organizationId: input.organizationId,
      relationType: "CREATOR",
      spaceId: input.spaceId,
      targetId: input.id,
      targetType: "DOCUMENT",
      updatedById: input.actorUserId,
      userId: input.actorUserId,
    },
  });
}

async function replaceLinksInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    documentId: string;
    links: CreateDocumentInput["links"];
    organizationId: string;
    spaceId: string;
  },
) {
  const links = input.links ?? [];
  const keys = new Set(links.map((link) => linkKey(link)));
  const existingLinks = await tx.documentLink.findMany({
    where: {
      documentId: input.documentId,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
    },
  });

  for (const existing of existingLinks) {
    if (keys.has(linkKey(existing))) {
      continue;
    }
    if (existing.deletedAt === null) {
      await tx.documentLink.update({
        data: { deletedAt: new Date() },
        where: { id: existing.id },
      });
    }
  }

  for (const link of links) {
    const existing = existingLinks.find(
      (entry) => linkKey(entry) === linkKey(link),
    );

    if (existing?.deletedAt === null) {
      continue;
    }
    if (existing) {
      await tx.documentLink.update({
        data: {
          createdById: input.actorUserId,
          deletedAt: null,
        },
        where: { id: existing.id },
      });
      continue;
    }

    await tx.documentLink.create({
      data: {
        id: ulid(),
        createdById: input.actorUserId,
        documentId: input.documentId,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: link.targetId,
        targetType: link.targetType,
      },
    });
  }
}

function linkKey(link: { targetId: string; targetType: string }) {
  return `${link.targetType}:${link.targetId}`;
}

function documentTargetWhere(document: PrismaDocumentRecord) {
  return {
    deletedAt: null,
    organizationId: document.organizationId,
    spaceId: document.spaceId,
    targetId: document.id,
    targetType: "DOCUMENT" as const,
  };
}

function formatDisplayCode(
  prefix: "REQ" | "INTAKE" | WorkItemType,
  sequence: number | null,
) {
  return sequence ? `${prefix}-${sequence}` : undefined;
}

function nonEmptyString(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function buildFolderPath(
  folderId: string,
  foldersById: Map<
    string,
    { id: string; name: string; parentId: string | null }
  >,
): DocumentFolderPathItem[] {
  const path: DocumentFolderPathItem[] = [];
  const seen = new Set<string>();
  let current = foldersById.get(folderId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift({
      id: current.id,
      name: current.name,
    });
    current = current.parentId ? foldersById.get(current.parentId) : undefined;
  }

  return path;
}

function collectFolderDescendantIds(
  folderId: string,
  folders: Array<{ id: string; parentId: string | null }>,
) {
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

function toDocumentOrderBy(
  input: Pick<DocumentListInput, "sortBy" | "sortOrder">,
): Prisma.DocumentOrderByWithRelationInput[] {
  const direction = input.sortOrder ?? "desc";

  switch (input.sortBy) {
    case "title":
      return [{ title: direction }, { id: "asc" }];
    case "createdAt":
      return [{ createdAt: direction }, { id: "asc" }];
    case "updatedAt":
      return [{ updatedAt: direction }, { id: "asc" }];
    case "lastEditedAt":
    default:
      return [{ lastEditedAt: direction }, { id: "asc" }];
  }
}

function applyTaggedTargetIds(
  where: Prisma.DocumentWhereInput,
  taggedTargetIds: string[] | undefined,
) {
  if (!taggedTargetIds) {
    return;
  }

  where.id =
    taggedTargetIds.length === 0
      ? { in: ["__no_document_matches_tags__"] }
      : { in: taggedTargetIds };
}

function isKnownEmptyIdFilter(value: Prisma.DocumentWhereInput["id"]) {
  return (
    typeof value === "object" &&
    value !== null &&
    "in" in value &&
    Array.isArray(value.in) &&
    value.in.length === 1 &&
    value.in[0] === "__no_document_matches_tags__"
  );
}
