import { Inject, Injectable } from "@nestjs/common";
import type { DocumentLink, WorkItemType } from "@project-delivery/shared";
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
  toDocumentLink,
  toDocumentRevision,
} from "./document.mappers";
import type { DocumentRepository } from "./document.repository";
import type {
  CreateDocumentInput,
  DocumentListInput,
  DocumentMutationResult,
  ReplaceDocumentLinksInput,
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

const DOCUMENT_DETAIL_OVERVIEW_LIMIT = 5;

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

    const [context, attachments, comments, timeline] = await Promise.all([
      this.loadDocumentContext(document),
      this.prisma.client.attachment.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: DOCUMENT_DETAIL_OVERVIEW_LIMIT,
        where: documentTargetWhere(document),
      }),
      this.prisma.client.comment.findMany({
        include: {
          author: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: DOCUMENT_DETAIL_OVERVIEW_LIMIT,
        where: documentTargetWhere(document),
      }),
      this.prisma.client.timelineEvent.findMany({
        include: {
          actor: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: DOCUMENT_DETAIL_OVERVIEW_LIMIT,
        where: documentTargetWhere(document),
      }),
    ]);

    return toDocumentDetail(document, {
      ...context,
      attachments,
      comments,
      timeline,
    });
  }

  private async loadDocumentContext(document: PrismaDocumentRecord) {
    const [links, chunks, tagsByDocumentId] = await Promise.all([
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
    };
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
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.document.count({ where }),
    ]);
    const targetIds = documents.map((document) => document.id);
    const [tagsByDocumentId, linksByDocumentId] = await Promise.all([
      listTagsByTargets(this.prisma.client, {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetIds,
        targetType: "DOCUMENT",
      }),
      this.listLinksByDocumentIds({
        documentIds: targetIds,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      }),
    ]);

    return {
      items: documents.map((document) =>
        toDocument(document, {
          links: linksByDocumentId.get(document.id) ?? [],
          tags: tagsByDocumentId.get(document.id) ?? [],
        }),
      ),
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
            (await this.findById(result.document.id)) ?? toDocument(result.document),
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
          ...(sourceAttachment ? { sourceAttachmentId: sourceAttachment.id } : {}),
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
            (await this.findById(result.document.id)) ?? toDocument(result.document),
        }
      : result;
  }

  async updateState(input: UpdateDocumentStateInput): Promise<DocumentMutationResult> {
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
        eventType: input.changeType === "DELETED" ? "UPDATED" : "STATUS_CHANGED",
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
            (await this.findById(result.document.id)) ?? toDocument(result.document),
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
            (await this.findById(result.document.id)) ?? toDocument(result.document),
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
      summaries.set(linkKey({ targetId: target.id, targetType: "REQUIREMENT" }), {
        displayCode: formatDisplayCode("REQ", target.sequence),
        title: target.title,
      });
    }
    for (const target of intakeItems) {
      summaries.set(linkKey({ targetId: target.id, targetType: "INTAKE_ITEM" }), {
        displayCode: formatDisplayCode("INTAKE", target.sequence),
        title: target.title,
      });
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
    const existing = existingLinks.find((entry) => linkKey(entry) === linkKey(link));

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

function formatDisplayCode(prefix: "REQ" | "INTAKE" | WorkItemType, sequence: number | null) {
  return sequence ? `${prefix}-${sequence}` : undefined;
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
