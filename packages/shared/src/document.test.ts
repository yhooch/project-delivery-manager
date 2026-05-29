import { describe, expect, it } from "vitest";

import {
  AppendDocumentContentRequestSchema,
  CancelRequirementPreflightResponseSchema,
  CancelRequirementRequestSchema,
  ConvertDocumentToRequirementRequestSchema,
  DocumentDetailSchema,
  DocumentFolderTreeNodeSchema,
  DocumentLinkTargetSchema,
  DocumentListQuerySchema,
  DocumentSchema,
  MoveDocumentsToFolderRequestSchema,
  MoveDocumentToFolderRequestSchema,
  PasteDocumentRequestSchema,
  ReplaceDocumentLinksRequestSchema,
  ReorderDocumentFoldersRequestSchema,
  UpdateDocumentContentRequestSchema,
} from "./document.ts";
import {
  AttachmentTargetTypeSchema,
  CanonicalTargetTypeSchema,
  CommentTargetTypeSchema,
  DocumentActorTypeSchema,
  DocumentChangeTypeSchema,
  DocumentContentFormatSchema,
  DocumentKindSchema,
  DocumentLinkTargetTypeSchema,
  DocumentSourceTypeSchema,
  DocumentStatusSchema,
  LegacyAttachmentTargetTypeInputSchema,
  LegacyCommentTargetTypeInputSchema,
  LegacyDocumentLinkTargetTypeInputSchema,
  LegacyObjectParticipantTargetTypeInputSchema,
  LegacyTagTargetTypeInputSchema,
  LegacyTargetTypeInputSchema,
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
      "USER_CREATED",
      "UPLOAD_DOCX",
      "UPLOAD_MARKDOWN",
      "PASTE_MARKDOWN",
      "PASTE_TEXT",
      "MCP_CREATED",
      "MIGRATED_DOCUMENT",
      "MIGRATED_REQUIREMENT",
    ]);
    expect(DocumentActorTypeSchema.options).toEqual(["USER", "MCP_CLIENT"]);
    expect(DocumentKindSchema.options).toEqual(["GENERAL", "REQUIREMENT"]);
    expect(DocumentContentFormatSchema.options).toEqual([
      "TIPTAP_JSON",
      "MARKDOWN",
    ]);
    expect(DocumentStatusSchema.options).toEqual([
      "DRAFT",
      "ACTIVE",
      "ARCHIVED",
    ]);
    expect(DocumentChangeTypeSchema.options).toEqual(
      expect.arrayContaining([
        "CREATED",
        "REIMPORTED",
        "CONTENT_APPENDED",
        "DELETED",
        "CONVERTED_TO_REQUIREMENT",
        "CANCELLED_REQUIREMENT",
      ]),
    );
    expect(DocumentLinkTargetTypeSchema.options).toEqual([
      "DOCUMENT",
      "VERSION",
      "INTAKE_ITEM",
      "WORK_ITEM",
    ]);

    expect(TargetTypeSchema.options).toEqual([
      "SPACE",
      "VERSION",
      "DOCUMENT",
      "INTAKE_ITEM",
      "WORK_ITEM",
    ]);
    expect(TargetTypeSchema.safeParse("REQUIREMENT").success).toBe(false);
    expect(CanonicalTargetTypeSchema.options).toEqual([
      "SPACE",
      "VERSION",
      "DOCUMENT",
      "INTAKE_ITEM",
      "WORK_ITEM",
    ]);
    expect(CanonicalTargetTypeSchema.safeParse("REQUIREMENT").success).toBe(
      false,
    );
    expect(LegacyTargetTypeInputSchema.parse("REQUIREMENT")).toBe(
      "REQUIREMENT",
    );
    expect(CommentTargetTypeSchema.options).toEqual([
      "INTAKE_ITEM",
      "WORK_ITEM",
      "DOCUMENT",
    ]);
    expect(AttachmentTargetTypeSchema.options).toEqual([
      "WORK_ITEM",
      "DOCUMENT",
    ]);
    expect(TagTargetTypeSchema.options).toEqual([
      "INTAKE_ITEM",
      "WORK_ITEM",
      "DOCUMENT",
    ]);
    expect(ObjectParticipantTargetTypeSchema.options).toEqual([
      "INTAKE_ITEM",
      "WORK_ITEM",
      "DOCUMENT",
    ]);
    expect(LegacyAttachmentTargetTypeInputSchema.parse("REQUIREMENT")).toBe(
      "REQUIREMENT",
    );
    expect(LegacyCommentTargetTypeInputSchema.parse("REQUIREMENT")).toBe(
      "REQUIREMENT",
    );
    expect(LegacyTagTargetTypeInputSchema.parse("REQUIREMENT")).toBe(
      "REQUIREMENT",
    );
    expect(
      LegacyObjectParticipantTargetTypeInputSchema.parse("REQUIREMENT"),
    ).toBe("REQUIREMENT");
    expect(LegacyDocumentLinkTargetTypeInputSchema.parse("REQUIREMENT")).toBe(
      "REQUIREMENT",
    );
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
      folderId: SECOND_ID,
      folderPath: [
        {
          id: SECOND_ID,
          name: "Research",
        },
      ],
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

    expect(document.kind).toBe("GENERAL");
    expect(document.contentFormat).toBe("MARKDOWN");
    expect(document.links?.[0]?.targetType).toBe("WORK_ITEM");
    expect(document.folderPath?.[0]?.name).toBe("Research");
  });

  it("validates requirement-shaped and Tiptap document DTOs", () => {
    expect(
      DocumentSchema.parse({
        id: ID,
        organizationId: SECOND_ID,
        spaceId: THIRD_ID,
        kind: "REQUIREMENT",
        sequence: 8,
        displayCode: "REQ-8",
        versionId: SECOND_ID,
        title: "Requirement doc",
        summary: "Release scope",
        contentFormat: "MARKDOWN",
        contentMarkdown: "# Scope",
        contentText: "Scope",
        sourceType: "MIGRATED_REQUIREMENT",
        status: "ACTIVE",
        revision: 3,
        priority: "HIGH",
        ownerId: ID,
        authorId: SECOND_ID,
        createdById: ID,
        createdVia: "USER",
        lastEditedById: ID,
        lastEditedVia: "USER",
        lastEditedAt: "2026-05-27T00:00:00.000Z",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      }),
    ).toMatchObject({
      kind: "REQUIREMENT",
      status: "ACTIVE",
      displayCode: "REQ-8",
    });

    expect(
      DocumentSchema.parse({
        id: ID,
        organizationId: SECOND_ID,
        spaceId: THIRD_ID,
        kind: "GENERAL",
        title: "Rich plan",
        contentFormat: "TIPTAP_JSON",
        contentJson: {
          type: "doc",
          content: [{ type: "paragraph" }],
        },
        contentMarkdownCache: "# Rich plan",
        contentText: "Rich plan",
        sourceType: "USER_CREATED",
        status: "DRAFT",
        revision: 1,
        createdById: ID,
        createdVia: "USER",
        lastEditedById: ID,
        lastEditedVia: "USER",
        lastEditedAt: "2026-05-27T00:00:00.000Z",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      }),
    ).toMatchObject({
      contentFormat: "TIPTAP_JSON",
      contentMarkdownCache: "# Rich plan",
    });

    expect(
      DocumentSchema.safeParse({
        id: ID,
        organizationId: SECOND_ID,
        spaceId: THIRD_ID,
        title: "Mixed",
        contentFormat: "MARKDOWN",
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "# Mixed",
        contentText: "Mixed",
        sourceType: "USER_CREATED",
        status: "ACTIVE",
        revision: 1,
        createdById: ID,
        createdVia: "USER",
        lastEditedById: ID,
        lastEditedVia: "USER",
        lastEditedAt: "2026-05-27T00:00:00.000Z",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("validates document folders and folder-aware document inputs", () => {
    expect(
      DocumentFolderTreeNodeSchema.parse({
        id: ID,
        organizationId: SECOND_ID,
        spaceId: THIRD_ID,
        parentId: SECOND_ID,
        name: "Architecture",
        sortOrder: 10,
        depth: 1,
        version: 2,
        createdById: ID,
        updatedById: SECOND_ID,
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
        documentCount: 3,
        descendantDocumentCount: 8,
        children: [],
      }),
    ).toMatchObject({
      name: "Architecture",
      descendantDocumentCount: 8,
    });

    expect(
      PasteDocumentRequestSchema.parse({
        contentMarkdown: "# In folder",
        folderId: ID,
      }),
    ).toMatchObject({
      folderId: ID,
    });
    expect(
      DocumentListQuerySchema.parse({
        page: 1,
        pageSize: 20,
        folderId: ID,
        includeDescendants: "true",
      }),
    ).toMatchObject({
      folderId: ID,
      includeDescendants: true,
    });
    expect(
      DocumentListQuerySchema.parse({
        page: 1,
        pageSize: 20,
        unfiled: "true",
      }),
    ).toMatchObject({
      unfiled: true,
    });
    expect(() =>
      DocumentListQuerySchema.parse({
        page: 1,
        pageSize: 20,
        folderId: ID,
        unfiled: true,
      }),
    ).toThrow();
    expect(
      MoveDocumentToFolderRequestSchema.parse({
        folderId: null,
        baseRevision: 1,
      }),
    ).toEqual({
      folderId: null,
      baseRevision: 1,
    });
    expect(
      MoveDocumentsToFolderRequestSchema.parse({
        documentIds: [ID, SECOND_ID],
        folderId: null,
      }),
    ).toEqual({
      documentIds: [ID, SECOND_ID],
      folderId: null,
    });
    expect(
      MoveDocumentsToFolderRequestSchema.safeParse({
        documentIds: [ID, ID],
      }).success,
    ).toBe(false);
    expect(
      ReorderDocumentFoldersRequestSchema.parse({
        parentId: null,
        orderedFolderIds: [ID, SECOND_ID, THIRD_ID],
      }),
    ).toEqual({
      parentId: null,
      orderedFolderIds: [ID, SECOND_ID, THIRD_ID],
    });
    expect(
      ReorderDocumentFoldersRequestSchema.safeParse({
        orderedFolderIds: [ID, ID],
      }).success,
    ).toBe(false);
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
        attachmentTotal: 12,
        comments: [
          {
            id: SECOND_ID,
            authorName: "Alice",
            body: "Looks current",
            createdAt: "2026-05-27T01:00:00.000Z",
          },
        ],
        commentTotal: 21,
        timeline: [
          {
            id: THIRD_ID,
            actorName: "Alice",
            changeType: "Document created",
            eventType: "CREATED",
            createdAt: "2026-05-27T00:30:00.000Z",
          },
        ],
        timelineTotal: 34,
      }),
    ).toMatchObject({
      attachments: [{ fileName: "handoff.md" }],
      attachmentTotal: 12,
      comments: [{ authorName: "Alice" }],
      commentTotal: 21,
      timeline: [{ changeType: "Document created" }],
      timelineTotal: 34,
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

  it("validates requirement conversion and cancellation requests", () => {
    expect(
      ConvertDocumentToRequirementRequestSchema.parse({
        baseRevision: 2,
        versionId: null,
        priority: "MEDIUM",
        ownerId: ID,
      }),
    ).toEqual({
      baseRevision: 2,
      versionId: null,
      priority: "MEDIUM",
      ownerId: ID,
    });
    expect(
      ConvertDocumentToRequirementRequestSchema.safeParse({}).success,
    ).toBe(false);

    expect(
      CancelRequirementRequestSchema.parse({
        baseRevision: 4,
        referenceMode: "UNLINK_REFERENCES",
      }),
    ).toEqual({
      baseRevision: 4,
      referenceMode: "UNLINK_REFERENCES",
    });
    expect(
      CancelRequirementRequestSchema.safeParse({
        baseRevision: 4,
        referenceMode: "DELETE_REFERENCES",
      }).success,
    ).toBe(false);

    expect(
      CancelRequirementPreflightResponseSchema.parse({
        canCancel: false,
        referenceCount: 2,
        modeRequired: "UNLINK_REFERENCES",
      }),
    ).toMatchObject({
      canCancel: false,
      referenceCount: 2,
    });
  });
});
