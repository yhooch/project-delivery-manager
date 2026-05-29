import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { DocumentKindTransitionService } from "./document-kind-transition.service";
import { PrismaDocumentRepository } from "./prisma-document.repository";

describe("PrismaDocumentRepository", () => {
  it("converts a document to a requirement in place with code history and revision records", async () => {
    const existing = makeDocumentRecord({ revision: 2 });
    const updated = makeDocumentRecord({
      kind: "REQUIREMENT",
      ownerId: "01H00000000000000000000014",
      priority: "HIGH",
      revision: 3,
      sequence: 17,
      versionId: "01H00000000000000000000015",
    });
    const tx = makeMutationTransaction(existing, updated);
    const prisma = {
      client: {
        $transaction: vi.fn(async (callback) => callback(tx)),
      },
    } as unknown as PrismaService;
    const allocator = {
      allocateOne: vi.fn(async () => 17),
    };
    const documents = {
      findById: vi.fn(async () => toPublicDocument(updated)),
    };
    const transitions = new DocumentKindTransitionService(
      prisma,
      allocator as never,
      documents as never,
    );

    await expect(
      transitions.convertToRequirement({
        actorType: "USER",
        actorUserId: updated.lastEditedById,
        baseRevision: 2,
        documentId: updated.id,
        ownerId: updated.ownerId ?? undefined,
        priority: "HIGH",
        versionId: updated.versionId,
      }),
    ).resolves.toMatchObject({
      document: {
        id: updated.id,
        kind: "REQUIREMENT",
        sequence: 17,
      },
      status: "updated",
    });
    expect(allocator.allocateOne).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        objectType: "REQUIREMENT",
        spaceId: existing.spaceId,
      }),
    );
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "REQUIREMENT",
          revision: 3,
          sequence: 17,
          versionId: updated.versionId,
        }),
        where: { id: existing.id },
      }),
    );
    const updateCalls = tx.document.update.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(updateCalls[0]?.[0].data).not.toHaveProperty("contentMarkdown");
    expect(tx.documentCodeHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        codeStatus: "ASSIGNED",
        displayCode: "REQ-17",
        documentId: existing.id,
        kind: "REQUIREMENT",
        sequence: 17,
      }),
    });
    expect(tx.documentRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeType: "CONVERTED_TO_REQUIREMENT",
        contentMarkdown: existing.contentMarkdown,
        documentId: existing.id,
        kind: "REQUIREMENT",
        revision: 3,
      }),
    });
    expect(tx.timelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetId: existing.id,
        targetType: "DOCUMENT",
        title: "Document converted to requirement",
      }),
    });
  });

  it("rejects requirement cancellation when active references exist in reject mode", async () => {
    const existing = makeDocumentRecord({
      kind: "REQUIREMENT",
      revision: 4,
      sequence: 18,
    });
    const tx = makeMutationTransaction(existing, existing, {
      documentLinkCount: 1,
      intakeItemCount: 1,
      workItemCount: 0,
    });
    const prisma = {
      client: {
        $transaction: vi.fn(async (callback) => callback(tx)),
      },
    } as unknown as PrismaService;
    const documents = {
      findById: vi.fn(),
    };
    const transitions = new DocumentKindTransitionService(
      prisma,
      { allocateOne: vi.fn() } as never,
      documents as never,
    );

    await expect(
      transitions.cancelRequirement({
        actorType: "USER",
        actorUserId: existing.lastEditedById,
        baseRevision: 4,
        documentId: existing.id,
        referenceMode: "REJECT_IF_REFERENCED",
      }),
    ).resolves.toEqual({
      referenceCount: 1,
      status: "referenced",
    });
    expect(tx.document.update).not.toHaveBeenCalled();
    expect(tx.documentCodeHistory.updateMany).not.toHaveBeenCalled();
    expect(tx.documentRevision.create).not.toHaveBeenCalled();
  });

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

function makeMutationTransaction(
  existing: ReturnType<typeof makeDocumentRecord>,
  updated: ReturnType<typeof makeDocumentRecord>,
  counts: {
    documentLinkCount?: number;
    intakeItemCount?: number;
    workItemCount?: number;
  } = {},
) {
  return {
    document: {
      findFirst: vi.fn(async () => existing),
      update: vi.fn(async () => updated),
    },
    documentCodeHistory: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    documentLink: {
      count: vi.fn(async () => counts.documentLinkCount ?? 0),
      updateMany: vi.fn(),
    },
    documentRevision: {
      create: vi.fn(),
    },
    intakeItem: {
      count: vi.fn(async () => counts.intakeItemCount ?? 0),
      updateMany: vi.fn(),
    },
    objectParticipant: {
      create: vi.fn(),
      findFirst: vi.fn(async () => undefined),
    },
    timelineEvent: {
      create: vi.fn(),
    },
    workItem: {
      count: vi.fn(async () => counts.workItemCount ?? 0),
      updateMany: vi.fn(),
    },
  };
}

function toPublicDocument(record: ReturnType<typeof makeDocumentRecord>) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    kind: record.kind,
    sequence: record.sequence ?? undefined,
    title: record.title,
    contentFormat: record.contentFormat,
    contentMarkdown: record.contentMarkdown ?? undefined,
    contentText: record.contentText,
    sourceType: record.sourceType,
    status: record.status,
    revision: record.revision,
    createdById: record.createdById,
    createdVia: record.createdVia,
    lastEditedById: record.lastEditedById,
    lastEditedVia: record.lastEditedVia,
    lastEditedAt: record.lastEditedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function makeDocumentRecord(
  input: Partial<{
    contentMarkdown: string | null;
    kind: "GENERAL" | "REQUIREMENT";
    ownerId: string | null;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | null;
    revision: number;
    sequence: number | null;
    versionId: string | null;
  }> = {},
) {
  return {
    archivedAt: null,
    authorId: null,
    contentFormat: "MARKDOWN",
    contentJson: null,
    contentMarkdown: "# Agent handoff",
    contentMarkdownCache: null,
    contentText: "Agent handoff",
    createdAt: new Date("2026-05-27T00:00:00.000Z"),
    createdById: "01H00000000000000000000004",
    createdMcpClientId: "codex-client",
    createdVia: "MCP_CLIENT",
    deletedAt: null,
    folderId: null,
    id: "01H00000000000000000000001",
    kind: "GENERAL",
    lastEditedAt: new Date("2026-05-27T00:00:00.000Z"),
    lastEditedById: "01H00000000000000000000004",
    lastEditedMcpClientId: "claude-code-client",
    lastEditedVia: "MCP_CLIENT",
    ownerId: null,
    organizationId: "01H00000000000000000000002",
    priority: null,
    revision: 1,
    sequence: null,
    sourceAttachmentId: null,
    sourceType: "PASTE_MARKDOWN",
    spaceId: "01H00000000000000000000003",
    status: "ACTIVE",
    summary: null,
    title: "Agent handoff",
    updatedAt: new Date("2026-05-27T00:00:00.000Z"),
    versionId: null,
    ...input,
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
