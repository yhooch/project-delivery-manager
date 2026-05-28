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
    const prisma = {
      client: {
        attachment: {
          findMany: attachmentFindMany,
        },
        comment: {
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

    await expect(repository.findDetailById(document.id)).resolves.toMatchObject({
      id: document.id,
      attachments: [{ fileName: "handoff.md", size: 1024 }],
      comments: [{ authorName: "Alice", body: "Looks current" }],
      createdByName: "Ada Lovelace",
      createdMcpClientName: "Codex",
      lastEditedByName: "Ada Lovelace",
      lastEditedMcpClientName: "Claude Code",
      timeline: [{ actorName: "Taylor", changeType: "Document content updated" }],
    });

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
    expect(commentFindMany).toHaveBeenCalledWith({
      include: { author: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      where: scopedDocumentTargetWhere,
    });
    expect(timelineEventFindMany).toHaveBeenCalledWith({
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      where: scopedDocumentTargetWhere,
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
