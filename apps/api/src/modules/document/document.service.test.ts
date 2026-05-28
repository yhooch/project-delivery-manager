import type { Document, DocumentDetail } from "@project-delivery/shared";
import { ulid } from "ulid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const convertToMarkdownMock = vi.hoisted(() => vi.fn());
const imgElementMock = vi.hoisted(() =>
  vi.fn((converter: unknown) => converter),
);

vi.mock("mammoth", () => ({
  default: {
    convertToMarkdown: convertToMarkdownMock,
    images: {
      imgElement: imgElementMock,
    },
  },
}));

import type { AuditService } from "../audit/audit.service";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { SpaceRepository } from "../space/space.repository";
import type { TargetResolverService } from "../target/target-resolver.service";
import type { AttachmentObjectStorage } from "../attachment/storage/attachment-object-storage";
import type { DocumentFolderService } from "./document-folder.service";
import type { DocumentRepository } from "./document.repository";
import {
  DocumentDocxConversionTimeoutMs,
  DocumentService,
} from "./document.service";

const ACTOR_ID = "01H00000000000000000000001";
const OWNER_ID = "01H00000000000000000000002";
const ORGANIZATION_ID = "01H00000000000000000000003";
const SPACE_ID = "01H00000000000000000000004";
const DOCUMENT_ID = "01H00000000000000000000005";
const TARGET_ID = "01H00000000000000000000006";
const SECOND_DOCUMENT_ID = "01H00000000000000000000007";

describe("DocumentService", () => {
  beforeEach(() => {
    convertToMarkdownMock.mockReset();
    convertToMarkdownMock.mockResolvedValue({
      messages: [],
      value: "# Converted",
    });
    imgElementMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns detail context after document read access is confirmed", async () => {
    const detail = fakeDocumentDetail({
      comments: [
        {
          id: "01H00000000000000000000007",
          authorName: "Alice",
          body: "Useful context",
          createdAt: "2026-05-27T01:00:00.000Z",
        },
      ],
    });
    const { documents, service, spaces } = createSubject({
      document: fakeDocument(),
      documentDetail: detail,
      role: "DEVELOPER",
    });

    await expect(service.get(ACTOR_ID, DOCUMENT_ID)).resolves.toMatchObject({
      id: DOCUMENT_ID,
      attachments: [],
      comments: [{ body: "Useful context" }],
      timeline: [],
    });
    expect(documents.findById).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(spaces.findAccessibleById).toHaveBeenCalledWith(ACTOR_ID, SPACE_ID);
    expect(documents.findDetailById).toHaveBeenCalledWith(DOCUMENT_ID);
  });

  it("rejects stale content updates with DOCUMENT_EDIT_CONFLICT before audit", async () => {
    const existing = fakeDocument({ createdById: ACTOR_ID, revision: 2 });
    const { audit, documents, service } = createSubject({
      document: existing,
      updateContentResult: { status: "conflict" },
    });

    await expect(
      service.updateContent(ACTOR_ID, DOCUMENT_ID, {
        baseRevision: 1,
        contentMarkdown: "# stale",
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_EDIT_CONFLICT",
    });
    expect(documents.updateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: 1,
        documentId: DOCUMENT_ID,
      }),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("prevents VIEWER from creating documents", async () => {
    const { documents, service } = createSubject({ role: "VIEWER" });

    await expect(
      service.paste(ACTOR_ID, SPACE_ID, {
        contentMarkdown: "# viewer",
        sourceType: "PASTE_MARKDOWN",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
    });
    expect(documents.create).not.toHaveBeenCalled();
  });

  it("allows the creator to update content even without manager role", async () => {
    const existing = fakeDocument({ createdById: ACTOR_ID, revision: 1 });
    const updated = fakeDocument({ createdById: ACTOR_ID, revision: 2 });
    const { audit, documents, realtime, service } = createSubject({
      document: existing,
      role: "DEVELOPER",
      updateContentResult: { status: "updated", document: updated },
    });

    await expect(
      service.updateContent(ACTOR_ID, DOCUMENT_ID, {
        baseRevision: 1,
        contentMarkdown: "# updated",
      }),
    ).resolves.toMatchObject({
      revision: 2,
    });
    expect(documents.updateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: "CONTENT_EDITED",
        documentId: DOCUMENT_ID,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        targetId: DOCUMENT_ID,
        targetType: "DOCUMENT",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: "DOCUMENT", id: DOCUMENT_ID },
      }),
    );
  });

  it("records MCP full content updates as content replacements", async () => {
    const existing = fakeDocument({ createdById: ACTOR_ID, revision: 1 });
    const updated = fakeDocument({
      createdById: ACTOR_ID,
      lastEditedVia: "MCP_CLIENT",
      revision: 2,
    });
    const { documents, service } = createSubject({
      document: existing,
      role: "PM",
      updateContentResult: { status: "updated", document: updated },
    });

    await expect(
      service.updateContent(
        ACTOR_ID,
        DOCUMENT_ID,
        {
          baseRevision: 1,
          contentMarkdown: "# replaced",
        },
        { requestId: "req-document-replace" },
        {
          actorType: "MCP_CLIENT",
          mcpClientId: "codex",
        },
      ),
    ).resolves.toMatchObject({
      revision: 2,
    });
    expect(documents.updateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "MCP_CLIENT",
        changeType: "CONTENT_REPLACED",
        documentId: DOCUMENT_ID,
        mcpClientId: "codex",
      }),
    );
  });

  it("rejects stale link replacements with DOCUMENT_EDIT_CONFLICT", async () => {
    const existing = fakeDocument({ createdById: ACTOR_ID, revision: 2 });
    const { audit, documents, service } = createSubject({
      document: existing,
      replaceLinksResult: { status: "conflict" },
    });

    await expect(
      service.replaceLinks(ACTOR_ID, DOCUMENT_ID, {
        baseRevision: 1,
        links: [],
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_EDIT_CONFLICT",
    });
    expect(documents.replaceLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: 1,
        documentId: DOCUMENT_ID,
      }),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("updates document revision metadata when replacing links", async () => {
    const existing = fakeDocument({ createdById: ACTOR_ID, revision: 1 });
    const updated = fakeDocument({ createdById: ACTOR_ID, revision: 2 });
    const { audit, documents, realtime, service } = createSubject({
      document: existing,
      replaceLinksResult: { status: "updated", document: updated },
    });

    await expect(
      service.replaceLinks(ACTOR_ID, DOCUMENT_ID, {
        baseRevision: 1,
        links: [],
      }),
    ).resolves.toEqual({ items: [] });
    expect(documents.replaceLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "USER",
        actorUserId: ACTOR_ID,
        baseRevision: 1,
        documentId: DOCUMENT_ID,
      }),
    );
    expect(documents.listLinks).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        targetId: DOCUMENT_ID,
        targetType: "DOCUMENT",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidates: expect.arrayContaining(["document-list", "document-links"]),
        target: { type: "DOCUMENT", id: DOCUMENT_ID },
      }),
    );
  });

  it("moves a document into a folder with audit and directory invalidation", async () => {
    const folderId = "01H00000000000000000000008";
    const existing = fakeDocument({ createdById: ACTOR_ID, revision: 1 });
    const updated = fakeDocument({
      createdById: ACTOR_ID,
      folderId,
      revision: 2,
    });
    const { audit, documents, folders, realtime, service } = createSubject({
      document: existing,
      moveToFolderResult: { status: "updated", document: updated },
    });

    await expect(
      service.moveToFolder(ACTOR_ID, DOCUMENT_ID, {
        baseRevision: 1,
        folderId,
      }),
    ).resolves.toMatchObject({
      folderId,
      revision: 2,
    });
    expect(folders.requireFolderInSpace).toHaveBeenCalledWith(folderId, {
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });
    expect(documents.moveToFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: 1,
        documentId: DOCUMENT_ID,
        folderId,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        targetId: DOCUMENT_ID,
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidates: expect.arrayContaining(["document-directory"]),
      }),
    );
  });

  it("moves multiple documents into a folder with one directory invalidation", async () => {
    const folderId = "01H00000000000000000000008";
    const first = fakeDocument({ createdById: ACTOR_ID, id: DOCUMENT_ID });
    const second = fakeDocument({
      createdById: ACTOR_ID,
      id: SECOND_DOCUMENT_ID,
    });
    const updatedFirst = fakeDocument({
      createdById: ACTOR_ID,
      folderId,
      id: DOCUMENT_ID,
      revision: 2,
    });
    const updatedSecond = fakeDocument({
      createdById: ACTOR_ID,
      folderId,
      id: SECOND_DOCUMENT_ID,
      revision: 2,
    });
    const { audit, documents, folders, realtime, service } = createSubject({
      documentsById: new Map([
        [DOCUMENT_ID, first],
        [SECOND_DOCUMENT_ID, second],
      ]),
      moveManyToFolderResult: {
        status: "updated",
        documents: [updatedFirst, updatedSecond],
      },
    });

    await expect(
      service.moveManyToFolder(ACTOR_ID, SPACE_ID, {
        documentIds: [DOCUMENT_ID, SECOND_DOCUMENT_ID],
        folderId,
      }),
    ).resolves.toEqual({
      items: [updatedFirst, updatedSecond],
    });
    expect(folders.requireFolderInSpace).toHaveBeenCalledWith(folderId, {
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });
    expect(documents.moveManyToFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        documentIds: [DOCUMENT_ID, SECOND_DOCUMENT_ID],
        folderId,
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
      }),
    );
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(realtime.publish).toHaveBeenCalledTimes(1);
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidates: expect.arrayContaining([
          "document-directory",
          "document-list",
        ]),
        target: { type: "SPACE", id: SPACE_ID },
      }),
    );
  });

  it("rejects document links outside the document space", async () => {
    const { documents, service, targets } = createSubject({
      role: "PM",
      targetSpaceId: ulid(),
    });

    await expect(
      service.paste(ACTOR_ID, SPACE_ID, {
        contentMarkdown: "# linked",
        sourceType: "PASTE_MARKDOWN",
        links: [{ targetType: "WORK_ITEM", targetId: TARGET_ID }],
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_LINK_TARGET_INVALID",
    });
    expect(targets.resolve).toHaveBeenCalledWith(
      ACTOR_ID,
      "WORK_ITEM",
      TARGET_ID,
      expect.objectContaining({
        notFoundCode: "DOCUMENT_LINK_TARGET_INVALID",
      }),
    );
    expect(documents.create).not.toHaveBeenCalled();
  });

  it("does not create a document or store an object when DOCX conversion fails", async () => {
    const { documents, objectStorage, service } = createSubject({ role: "PM" });

    await expect(
      service.importDocx(
        ACTOR_ID,
        SPACE_ID,
        {},
        {
          buffer: Buffer.from("not a zip"),
          fileName: "broken.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 9,
        },
      ),
    ).rejects.toMatchObject({
      code: "DOCUMENT_IMPORT_FAILED",
    });
    expect(documents.create).not.toHaveBeenCalled();
    expect(objectStorage.putObject).not.toHaveBeenCalled();
  });

  it("does not create a document or store an object when DOCX conversion times out", async () => {
    vi.useFakeTimers();
    convertToMarkdownMock.mockReturnValue(new Promise(() => undefined));
    const { documents, objectStorage, service } = createSubject({ role: "PM" });
    const importPromise = service.importDocx(
      ACTOR_ID,
      SPACE_ID,
      {},
      docxUploadFile(),
    );
    const assertion = expect(importPromise).rejects.toMatchObject({
      code: "DOCUMENT_IMPORT_FAILED",
      details: { reason: "DOCX conversion timed out" },
    });

    await vi.advanceTimersByTimeAsync(DocumentDocxConversionTimeoutMs + 1);
    await assertion;
    expect(documents.create).not.toHaveBeenCalled();
    expect(objectStorage.putObject).not.toHaveBeenCalled();
  });
});

function createSubject(input: {
  document?: Document;
  documentDetail?: DocumentDetail;
  documentsById?: Map<string, Document>;
  moveManyToFolderResult?: Awaited<
    ReturnType<DocumentRepository["moveManyToFolder"]>
  >;
  replaceLinksResult?: Awaited<ReturnType<DocumentRepository["replaceLinks"]>>;
  moveToFolderResult?: Awaited<ReturnType<DocumentRepository["moveToFolder"]>>;
  role?: "DEVELOPER" | "PM" | "VIEWER";
  targetSpaceId?: string;
  updateContentResult?: Awaited<ReturnType<DocumentRepository["updateContent"]>>;
} = {}) {
  const document = input.document ?? fakeDocument({ createdById: OWNER_ID });
  const documents = {
    create: vi.fn(async (createInput) =>
      fakeDocument({
        createdById: createInput.actorUserId,
        contentMarkdown: createInput.contentMarkdown,
        contentText: createInput.contentText,
        title: createInput.title,
      }),
    ),
    findById: vi.fn(async (documentId) =>
      input.documentsById?.get(documentId) ?? document,
    ),
    findDetailById: vi.fn(async () => input.documentDetail ?? fakeDocumentDetail(document)),
    list: vi.fn(),
    listChunks: vi.fn(),
    listLinks: vi.fn(async () => []),
    listLinksByTarget: vi.fn(),
    listRevisions: vi.fn(),
    moveToFolder: vi.fn(async () =>
      input.moveToFolderResult ?? {
        status: "updated",
        document: fakeDocument({ revision: document.revision + 1 }),
      },
    ),
    moveManyToFolder: vi.fn(async () =>
      input.moveManyToFolderResult ?? {
        status: "updated",
        documents: [fakeDocument({ revision: document.revision + 1 })],
      },
    ),
    replaceLinks: vi.fn(async () =>
      input.replaceLinksResult ?? {
        status: "updated",
        document: fakeDocument({ revision: document.revision + 1 }),
      },
    ),
    updateContent: vi.fn(async () =>
      input.updateContentResult ?? {
        status: "updated",
        document: fakeDocument({ revision: document.revision + 1 }),
      },
    ),
    updateMetadata: vi.fn(),
    updateState: vi.fn(),
  } as unknown as DocumentRepository & Record<string, ReturnType<typeof vi.fn>>;
  const spaces = {
    findAccessibleById: vi.fn(async () => ({
      role: input.role ?? "PM",
      space: {
        id: SPACE_ID,
        organizationId: ORGANIZATION_ID,
        name: "Space",
        code: "SPACE",
        status: "ACTIVE",
        staleThresholdDays: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })),
  } as unknown as SpaceRepository & {
    findAccessibleById: ReturnType<typeof vi.fn>;
  };
  const targets = {
    resolve: vi.fn(async () => ({
      canWrite: true,
      organizationId: ORGANIZATION_ID,
      role: "PM",
      spaceId: input.targetSpaceId ?? SPACE_ID,
      targetId: TARGET_ID,
      targetType: "WORK_ITEM",
    })),
  } as unknown as TargetResolverService & {
    resolve: ReturnType<typeof vi.fn>;
  };
  const audit = {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
  };
  const realtime = {
    publish: vi.fn(),
  } as unknown as RealtimePublisherService & {
    publish: ReturnType<typeof vi.fn>;
  };
  const objectStorage = {
    deleteObjectIfExists: vi.fn(),
    getObject: vi.fn(),
    putObject: vi.fn(),
  } as unknown as AttachmentObjectStorage & {
    putObject: ReturnType<typeof vi.fn>;
  };
  const folders = {
    requireFolderInSpace: vi.fn(),
  } as unknown as DocumentFolderService & {
    requireFolderInSpace: ReturnType<typeof vi.fn>;
  };

  return {
    audit,
    documents,
    objectStorage,
    realtime,
    service: new DocumentService(
      documents,
      spaces,
      targets,
      audit,
      realtime,
      objectStorage,
      folders,
    ),
    spaces,
    targets,
    folders,
  };
}

function fakeDocument(input: Partial<Document> = {}): Document {
  return {
    id: input.id ?? DOCUMENT_ID,
    organizationId: input.organizationId ?? ORGANIZATION_ID,
    spaceId: input.spaceId ?? SPACE_ID,
    folderId: input.folderId,
    title: input.title ?? "Document",
    contentMarkdown: input.contentMarkdown ?? "# Document",
    contentText: input.contentText ?? "Document",
    sourceType: input.sourceType ?? "PASTE_MARKDOWN",
    status: input.status ?? "ACTIVE",
    revision: input.revision ?? 1,
    createdById: input.createdById ?? OWNER_ID,
    createdVia: input.createdVia ?? "USER",
    lastEditedById: input.lastEditedById ?? OWNER_ID,
    lastEditedVia: input.lastEditedVia ?? "USER",
    lastEditedAt: input.lastEditedAt ?? "2026-05-27T00:00:00.000Z",
    createdAt: input.createdAt ?? "2026-05-27T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-27T00:00:00.000Z",
  };
}

function fakeDocumentDetail(input: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    ...fakeDocument(input),
    attachments: input.attachments ?? [],
    comments: input.comments ?? [],
    timeline: input.timeline ?? [],
  };
}

function docxUploadFile() {
  const buffer = createMinimalDocxZipBuffer();

  return {
    buffer,
    fileName: "document.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: buffer.length,
  };
}

function createMinimalDocxZipBuffer(): Buffer {
  return createZipBuffer([
    { fileName: "[Content_Types].xml", content: Buffer.from("types") },
    { fileName: "word/document.xml", content: Buffer.from("document") },
  ]);
}

function createZipBuffer(
  entries: Array<{ content: Buffer; fileName: string }>,
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.fileName, "utf8");
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(entry.content.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.content);

    const centralHeader = Buffer.alloc(46);

    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(entry.content.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + entry.content.length;
  }

  const localData = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);

  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localData.length, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDirectory, endOfCentralDirectory]);
}
