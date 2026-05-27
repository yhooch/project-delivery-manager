import { describe, expect, it } from "vitest";

import {
  AppendDocumentContentRequestSchema,
  DocumentDetailSchema,
  DocumentLinkTargetSchema,
  DocumentSchema,
  PasteDocumentRequestSchema,
  ReplaceDocumentLinksRequestSchema,
  UpdateDocumentContentRequestSchema,
} from "./document.ts";
import {
  AttachmentTargetTypeSchema,
  CommentTargetTypeSchema,
  DocumentActorTypeSchema,
  DocumentChangeTypeSchema,
  DocumentLinkTargetTypeSchema,
  DocumentSourceTypeSchema,
  DocumentStatusSchema,
  ObjectParticipantTargetTypeSchema,
  TagTargetTypeSchema,
  TargetTypeSchema,
} from "./enums.ts";

const ID = "01H00000000000000000000001";
const SECOND_ID = "01H00000000000000000000002";
const THIRD_ID = "01H00000000000000000000003";

describe("document contracts", () => {
  it("freezes document enum values and target integration", () => {
    expect(DocumentSourceTypeSchema.options).toEqual([
      "UPLOAD_DOCX",
      "UPLOAD_MARKDOWN",
      "PASTE_MARKDOWN",
      "PASTE_TEXT",
      "MCP_CREATED",
    ]);
    expect(DocumentActorTypeSchema.options).toEqual(["USER", "MCP_CLIENT"]);
    expect(DocumentStatusSchema.options).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(DocumentChangeTypeSchema.options).toEqual(
      expect.arrayContaining([
        "CREATED",
        "REIMPORTED",
        "CONTENT_APPENDED",
        "DELETED",
      ]),
    );
    expect(DocumentLinkTargetTypeSchema.options).toEqual([
      "DOCUMENT",
      "VERSION",
      "REQUIREMENT",
      "INTAKE_ITEM",
      "WORK_ITEM",
    ]);

    expect(TargetTypeSchema.options).toContain("DOCUMENT");
    expect(CommentTargetTypeSchema.options).toContain("DOCUMENT");
    expect(AttachmentTargetTypeSchema.options).toContain("DOCUMENT");
    expect(TagTargetTypeSchema.options).toContain("DOCUMENT");
    expect(ObjectParticipantTargetTypeSchema.options).toContain("DOCUMENT");
  });

  it("accepts paste creation and base revision content updates", () => {
    expect(
      PasteDocumentRequestSchema.parse({
        contentMarkdown: "# Imported\n\nBody",
      }),
    ).toMatchObject({
      contentMarkdown: "# Imported\n\nBody",
      sourceType: "PASTE_MARKDOWN",
    });

    expect(
      UpdateDocumentContentRequestSchema.parse({
        baseRevision: 1,
        contentMarkdown: "# Replacement",
      }),
    ).toEqual({
      baseRevision: 1,
      contentMarkdown: "# Replacement",
    });

    expect(
      AppendDocumentContentRequestSchema.safeParse({
        baseRevision: 0,
        appendMarkdown: "append",
      }).success,
    ).toBe(false);
  });

  it("rejects base64 image data in markdown inputs", () => {
    expect(
      PasteDocumentRequestSchema.safeParse({
        contentMarkdown: "![x](data:image/png;base64,AAAA)",
      }).success,
    ).toBe(false);
  });

  it("validates document DTO links and timestamps", () => {
    const document = DocumentSchema.parse({
      id: ID,
      organizationId: SECOND_ID,
      spaceId: THIRD_ID,
      title: "Plan",
      contentMarkdown: "# Plan",
      contentText: "Plan",
      sourceType: "PASTE_MARKDOWN",
      status: "ACTIVE",
      revision: 1,
      createdById: ID,
      createdByName: "Ada Lovelace",
      createdVia: "MCP_CLIENT",
      createdMcpClientId: "codex-client",
      createdMcpClientName: "Codex",
      lastEditedById: ID,
      lastEditedByName: "Ada Lovelace",
      lastEditedVia: "MCP_CLIENT",
      lastEditedMcpClientId: "claude-code-client",
      lastEditedMcpClientName: "Claude Code",
      lastEditedAt: "2026-05-27T00:00:00.000Z",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:00.000Z",
      links: [
        {
          id: ID,
          organizationId: SECOND_ID,
          spaceId: THIRD_ID,
          documentId: ID,
          targetType: "WORK_ITEM",
          targetId: SECOND_ID,
          createdById: ID,
          createdAt: "2026-05-27T00:00:00.000Z",
        },
      ],
    });

    expect(document.links?.[0]?.targetType).toBe("WORK_ITEM");
  });

  it("validates detail-only document context without changing base document DTO", () => {
    const baseDocument = {
      id: ID,
      organizationId: SECOND_ID,
      spaceId: THIRD_ID,
      title: "Plan",
      contentMarkdown: "# Plan",
      contentText: "Plan",
      sourceType: "PASTE_MARKDOWN",
      status: "ACTIVE",
      revision: 1,
      createdById: ID,
      createdVia: "USER",
      lastEditedById: ID,
      lastEditedVia: "USER",
      lastEditedAt: "2026-05-27T00:00:00.000Z",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:00.000Z",
      tags: [],
      links: [],
      chunks: [],
    };

    expect(
      DocumentDetailSchema.parse({
        ...baseDocument,
        attachments: [
          {
            id: ID,
            fileName: "handoff.md",
            size: 1024,
          },
        ],
        comments: [
          {
            id: SECOND_ID,
            authorName: "Alice",
            body: "Looks current",
            createdAt: "2026-05-27T01:00:00.000Z",
          },
        ],
        timeline: [
          {
            id: THIRD_ID,
            actorName: "Alice",
            changeType: "Document created",
            createdAt: "2026-05-27T00:30:00.000Z",
          },
        ],
      }),
    ).toMatchObject({
      attachments: [{ fileName: "handoff.md" }],
      comments: [{ authorName: "Alice" }],
      timeline: [{ changeType: "Document created" }],
    });

    expect(
      DocumentSchema.safeParse({
        ...baseDocument,
        comments: [],
        attachments: [],
        timeline: [],
      }).success,
    ).toBe(false);
  });

  it("validates document link replacement targets", () => {
    expect(
      DocumentLinkTargetSchema.parse({
        targetType: "DOCUMENT",
        targetId: ID,
      }),
    ).toEqual({
      targetType: "DOCUMENT",
      targetId: ID,
    });
    expect(
      ReplaceDocumentLinksRequestSchema.safeParse({
        baseRevision: 1,
        links: [{ targetType: "SPACE", targetId: ID }],
      }).success,
    ).toBe(false);
    expect(
      ReplaceDocumentLinksRequestSchema.safeParse({
        links: [{ targetType: "DOCUMENT", targetId: ID }],
      }).success,
    ).toBe(false);
    expect(
      ReplaceDocumentLinksRequestSchema.parse({
        baseRevision: 1,
        links: [{ targetType: "DOCUMENT", targetId: ID }],
      }),
    ).toEqual({
      baseRevision: 1,
      links: [{ targetType: "DOCUMENT", targetId: ID }],
    });
  });
});
