import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaDocumentRepository } from "./prisma-document.repository";

describe("PrismaDocumentRepository", () => {
  it("filters unfiled documents with a null folder condition", async () => {
    const documentFindMany = vi.fn(async () => []);
    const documentCount = vi.fn(async () => 0);
    const prisma = {
      client: {
        $transaction: vi.fn(async (queries) => Promise.all(queries)),
        document: {
          count: documentCount,
          findMany: documentFindMany,
        },
        documentLink: {
          findMany: vi.fn(async () => []),
        },
        documentFolder: {
          findMany: vi.fn(async () => []),
        },
        mcpOAuthClient: {
          findMany: vi.fn(async () => []),
        },
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
        user: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaDocumentRepository(prisma);

    await expect(
      repository.list({
        organizationId: "01H00000000000000000000002",
        page: 1,
        pageSize: 20,
        spaceId: "01H00000000000000000000003",
        unfiled: true,
      }),
    ).resolves.toMatchObject({
      items: [],
      total: 0,
    });
    expect(documentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          contentMarkdown: true,
          contentText: true,
        }),
        where: expect.objectContaining({
          folderId: null,
        }),
      }),
    );
    expect(documentCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        folderId: null,
      }),
    });
  });

  it("loads document detail overviews through tenant-scoped DOCUMENT target queries", async () => {
    const document = makeDocumentRecord();
    const attachmentFindMany = vi.fn(async () => [
      {
        id: "01H00000000000000000000006",
        fileName: "handoff.md",
        size: 1024,
      },
    ]);
    const attachmentCount = vi.fn(async () => 12);
    const commentFindMany = vi.fn(async () => [
      {
        id: "01H00000000000000000000007",
        author: {
          name: "Alice",
          username: "alice",
        },
        body: "Looks current",
        createdAt: new Date("2026-05-27T01:00:00.000Z"),
      },
    ]);
    const commentCount = vi.fn(async () => 21);
    const timelineEventFindMany = vi.fn(async () => [
      {
        id: "01H00000000000000000000008",
        actor: {
          name: "Taylor",
          username: "taylor",
        },
        createdAt: new Date("2026-05-27T02:00:00.000Z"),
        eventType: "UPDATED",
        title: "Document content updated",
      },
    ]);
    const timelineEventCount = vi.fn(async () => 34);
    const prisma = {
      client: {
        attachment: {
          count: attachmentCount,
          findMany: attachmentFindMany,
        },
        comment: {
          count: commentCount,
          findMany: commentFindMany,
        },
        document: {
          findFirst: vi.fn(async () => document),
        },
        documentFolder: {
          findMany: vi.fn(async () => []),
        },
        documentChunk: {
          findMany: vi.fn(async () => []),
        },
        documentLink: {
          findMany: vi.fn(async () => []),
        },
        mcpOAuthClient: {
          findMany: vi.fn(async () => [
            {
              clientId: "codex-client",
              clientName: "Codex",
            },
            {
              clientId: "claude-code-client",
              clientName: "Claude Code",
            },
          ]),
        },
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
        timelineEvent: {
          count: timelineEventCount,
          findMany: timelineEventFindMany,
        },
        user: {
          findMany: vi.fn(async () => [
            {
              id: document.createdById,
              name: "Ada Lovelace",
              username: "ada",
            },
          ]),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaDocumentRepository(prisma);

    await expect(repository.findDetailById(document.id)).resolves.toMatchObject(
      {
        id: document.id,
        attachments: [{ fileName: "handoff.md", size: 1024 }],
        attachmentTotal: 12,
        comments: [{ authorName: "Alice", body: "Looks current" }],
        commentTotal: 21,
        createdByName: "Ada Lovelace",
        createdMcpClientName: "Codex",
        lastEditedByName: "Ada Lovelace",
        lastEditedMcpClientName: "Claude Code",
        timeline: [
          { actorName: "Taylor", changeType: "Document content updated" },
        ],
        timelineTotal: 34,
      },
    );

    const scopedDocumentTargetWhere = {
      deletedAt: null,
      organizationId: document.organizationId,
      spaceId: document.spaceId,
      targetId: document.id,
      targetType: "DOCUMENT",
    };
    expect(attachmentFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 5,
      where: scopedDocumentTargetWhere,
    });
    expect(attachmentCount).toHaveBeenCalledWith({
      where: scopedDocumentTargetWhere,
    });
    expect(commentFindMany).toHaveBeenCalledWith({
      include: { author: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      where: scopedDocumentTargetWhere,
    });
    expect(commentCount).toHaveBeenCalledWith({
      where: scopedDocumentTargetWhere,
    });
    expect(timelineEventFindMany).toHaveBeenCalledWith({
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      where: scopedDocumentTargetWhere,
    });
    expect(timelineEventCount).toHaveBeenCalledWith({
      where: scopedDocumentTargetWhere,
    });
  });

  it("searches current revision chunks with normalized whitespace and per-document limits", async () => {
    const first = makeDocumentRecord();
    const second = {
      ...makeDocumentRecord(),
      id: "01H00000000000000000000009",
      revision: 2,
    };
    const documentChunkFindMany = vi.fn(async () => [
      makeChunkRecord({
        contentText: "Alpha\nBeta matching chunk",
        documentId: first.id,
        ordinal: 0,
        revision: first.revision,
      }),
      makeChunkRecord({
        contentText: "Alpha Beta second match",
        documentId: first.id,
        id: "01H00000000000000000000010",
        ordinal: 1,
        revision: first.revision,
      }),
      makeChunkRecord({
        contentText: "Alpha Beta current revision",
        documentId: second.id,
        id: "01H00000000000000000000011",
        ordinal: 0,
        revision: second.revision,
      }),
      makeChunkRecord({
        contentText: "Old Alpha Beta revision",
        documentId: second.id,
        id: "01H00000000000000000000012",
        ordinal: 0,
        revision: 1,
      }),
    ]);
    const prisma = {
      client: {
        documentChunk: {
          findMany: documentChunkFindMany,
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaDocumentRepository(prisma);

    await expect(
      repository.searchCurrentRevisionChunks({
        documents: [
          { documentId: first.id, revision: first.revision },
          { documentId: second.id, revision: second.revision },
        ],
        maxHitsPerDocument: 1,
        organizationId: first.organizationId,
        query: "alpha beta",
        spaceId: first.spaceId,
      }),
    ).resolves.toMatchObject([
      {
        documentId: first.id,
        ordinal: 0,
      },
      {
        documentId: second.id,
        ordinal: 0,
        revision: second.revision,
      },
    ]);
    expect(documentChunkFindMany).toHaveBeenCalledWith({
      orderBy: [{ documentId: "asc" }, { ordinal: "asc" }],
      where: {
        OR: [
          { documentId: first.id, revision: first.revision },
          { documentId: second.id, revision: second.revision },
        ],
        organizationId: first.organizationId,
        spaceId: first.spaceId,
      },
    });
  });
});

function makeDocumentRecord() {
  return {
    archivedAt: null,
    contentMarkdown: "# Agent handoff",
    contentText: "Agent handoff",
    createdAt: new Date("2026-05-27T00:00:00.000Z"),
    createdById: "01H00000000000000000000004",
    createdMcpClientId: "codex-client",
    createdVia: "MCP_CLIENT",
    deletedAt: null,
    folderId: null,
    id: "01H00000000000000000000001",
    lastEditedAt: new Date("2026-05-27T00:00:00.000Z"),
    lastEditedById: "01H00000000000000000000004",
    lastEditedMcpClientId: "claude-code-client",
    lastEditedVia: "MCP_CLIENT",
    organizationId: "01H00000000000000000000002",
    revision: 1,
    sourceAttachmentId: null,
    sourceType: "PASTE_MARKDOWN",
    spaceId: "01H00000000000000000000003",
    status: "ACTIVE",
    title: "Agent handoff",
    updatedAt: new Date("2026-05-27T00:00:00.000Z"),
  } as const;
}

function makeChunkRecord(input: {
  contentText: string;
  documentId: string;
  id?: string;
  ordinal: number;
  revision: number;
}) {
  return {
    id: input.id ?? "01H00000000000000000000013",
    organizationId: "01H00000000000000000000002",
    spaceId: "01H00000000000000000000003",
    documentId: input.documentId,
    revision: input.revision,
    ordinal: input.ordinal,
    headingPath: null,
    contentText: input.contentText,
    createdAt: new Date("2026-05-27T00:00:00.000Z"),
  };
}
