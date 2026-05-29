import { describe, expect, it, vi } from "vitest";

import {
  archiveDocument,
  createDocumentFolder,
  deleteDocument,
  deleteDocumentFolder,
  getCancelRequirementPreflight,
  getDocument,
  importDocxDocument,
  importMarkdownDocument,
  listDocumentFolders,
  listDocuments,
  listReferencingDocuments,
  moveDocumentFolder,
  moveDocumentsToFolder,
  moveDocumentToFolder,
  reimportDocument,
  reorderDocumentFolders,
  restoreDocument,
  updateDocumentFolder,
  updateDocument,
  type DocumentApiTransport,
  type DocumentDetail,
} from "./document-service";

const spaceId = "SPC_01";
const documentId = "DOC_01";

function createDocumentFixture(
  patch: Partial<DocumentDetail> = {},
): DocumentDetail {
  return {
    contentFormat: "MARKDOWN",
    contentMarkdown: "# Plan",
    createdAt: "2026-05-27T10:00:00.000Z",
    id: documentId,
    kind: "GENERAL",
    lastEditedAt: "2026-05-27T11:00:00.000Z",
    lastEditedVia: "USER",
    organizationId: "ORG_01",
    revision: 3,
    sourceType: "UPLOAD_MARKDOWN",
    spaceId,
    status: "ACTIVE",
    title: "Plan",
    updatedAt: "2026-05-27T11:00:00.000Z",
    ...patch,
  };
}

function createApi(): DocumentApiTransport {
  return {
    delete: vi.fn(async () => ({
      data: {},
    })) as DocumentApiTransport["delete"],
    get: vi.fn(async () => ({
      data: {
        items: [createDocumentFixture()],
        page: 1,
        pageSize: 50,
        total: 1,
      },
    })) as DocumentApiTransport["get"],
    patch: vi.fn(async () => ({
      data: createDocumentFixture({ revision: 4 }),
    })) as DocumentApiTransport["patch"],
    post: vi.fn(async () => ({
      data: createDocumentFixture({ revision: 4 }),
    })) as DocumentApiTransport["post"],
  };
}

describe("document service", () => {
  it("lists documents under the selected space with query filters", async () => {
    const api = createApi();

    await expect(
      listDocuments(
        {
          filter: "recentMcpEdited",
          page: 2,
          pageSize: 25,
          query: "launch",
          spaceId,
          currentUserId: "USER_01",
          tagIds: ["TAG_01"],
          tagMatch: "ANY",
          folderId: "FLD_01",
          includeDescendants: true,
          linkedTargetId: "REQ_01",
          linkedTargetType: "DOCUMENT",
          unfiled: false,
        },
        api,
      ),
    ).resolves.toMatchObject({
      items: [{ id: documentId }],
      total: 1,
    });

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/documents`, {
      query: {
        lastEditedVia: "MCP_CLIENT",
        page: 2,
        pageSize: 25,
        query: "launch",
        linkedTargetId: "REQ_01",
        linkedTargetType: "DOCUMENT",
        folderId: "FLD_01",
        includeDescendants: true,
        unfiled: undefined,
        tagIds: ["TAG_01"],
        tagMatch: "ANY",
      },
    });
  });

  it("lists documents that reference a document target", async () => {
    const api = createApi();

    await listReferencingDocuments(
      {
        page: 1,
        pageSize: 5,
        spaceId,
        targetDocumentId: documentId,
      },
      api,
    );

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/documents`, {
      query: {
        page: 1,
        pageSize: 5,
        linkedTargetId: documentId,
        linkedTargetType: "DOCUMENT",
        sortBy: "lastEditedAt",
        sortOrder: "desc",
      },
    });
  });

  it("lists unfiled documents through an explicit query flag", async () => {
    const api = createApi();

    await listDocuments(
      {
        page: 1,
        pageSize: 25,
        spaceId,
        unfiled: true,
      },
      api,
    );

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/documents`, {
      query: {
        page: 1,
        pageSize: 25,
        unfiled: true,
      },
    });
  });

  it("parses unified document and requirement model fields", async () => {
    const api = {
      ...createApi(),
      get: vi.fn(async () => ({
        data: {
          items: [
            createDocumentFixture({
              authorId: "USER_AUTHOR",
              contentFormat: "TIPTAP_JSON",
              contentJson: { content: [], type: "doc" },
              contentMarkdownCache: "# Cached requirement",
              displayCode: "REQ-12",
              kind: "REQUIREMENT",
              ownerId: "USER_OWNER",
              priority: "HIGH",
              sequence: 12,
              summary: "Requirement summary",
              versionId: "VER_01",
            }),
          ],
          total: 1,
        },
      })),
    } as DocumentApiTransport;

    await expect(listDocuments({ spaceId }, api)).resolves.toMatchObject({
      items: [
        {
          authorId: "USER_AUTHOR",
          contentFormat: "TIPTAP_JSON",
          contentJson: { content: [], type: "doc" },
          contentMarkdownCache: "# Cached requirement",
          displayCode: "REQ-12",
          kind: "REQUIREMENT",
          ownerId: "USER_OWNER",
          priority: "HIGH",
          sequence: 12,
          summary: "Requirement summary",
          versionId: "VER_01",
        },
      ],
      total: 1,
    });
  });

  it("imports markdown and docx files with FormData and no JSON body", async () => {
    const api = createApi();
    const md = new File(["# Plan"], "plan.md", { type: "text/markdown" });
    const docx = new File(["docx"], "plan.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await importMarkdownDocument({ spaceId }, { file: md, title: "Plan" }, api);
    await importDocxDocument(
      { spaceId },
      { file: docx, folderId: "FLD_01" },
      api,
    );

    const markdownBody = vi.mocked(api.post).mock.calls[0]?.[1];
    const docxBody = vi.mocked(api.post).mock.calls[1]?.[1];

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      `/spaces/${spaceId}/documents/import-markdown`,
      expect.any(FormData),
    );
    expect(markdownBody).toBeInstanceOf(FormData);
    expect((markdownBody as FormData).get("file")).toMatchObject({
      name: "plan.md",
    });
    expect((markdownBody as FormData).get("title")).toBe("Plan");
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      `/spaces/${spaceId}/documents/import-docx`,
      expect.any(FormData),
    );
    expect(docxBody).toBeInstanceOf(FormData);
    expect((docxBody as FormData).get("folderId")).toBe("FLD_01");
  });

  it("sends baseRevision in reimport FormData", async () => {
    const api = createApi();
    const file = new File(["# Next"], "next.md", { type: "text/markdown" });

    await reimportDocument({ baseRevision: 3, documentId, file }, api);

    const body = vi.mocked(api.post).mock.calls[0]?.[1];
    expect(api.post).toHaveBeenCalledWith(
      `/documents/${documentId}/reimport`,
      expect.any(FormData),
    );
    expect((body as FormData).get("baseRevision")).toBe("3");
    expect((body as FormData).get("file")).toMatchObject({ name: "next.md" });
  });

  it("updates metadata before content and carries the latest revision", async () => {
    const api = createApi();

    await updateDocument(
      {
        baseRevision: 3,
        contentMarkdown: "# Updated",
        documentId,
        linkTargets: [{ targetId: "REQ_01", targetType: "DOCUMENT" }],
        tagIds: ["TAG_01"],
        title: "Updated",
      },
      api,
    );

    expect(api.patch).toHaveBeenNthCalledWith(
      1,
      `/documents/${documentId}/metadata`,
      {
        baseRevision: 3,
        links: [{ targetId: "REQ_01", targetType: "DOCUMENT" }],
        tagIds: ["TAG_01"],
        title: "Updated",
      },
    );
    expect(api.patch).toHaveBeenNthCalledWith(
      2,
      `/documents/${documentId}/content`,
      {
        baseRevision: 4,
        contentMarkdown: "# Updated",
      },
    );
  });

  it("gets a document by id", async () => {
    const api = {
      ...createApi(),
      get: vi.fn(async () => ({ data: createDocumentFixture() })),
    } as DocumentApiTransport;

    await expect(getDocument({ documentId }, api)).resolves.toMatchObject({
      id: documentId,
      title: "Plan",
    });

    expect(api.get).toHaveBeenCalledWith(`/documents/${documentId}`);
  });

  it("gets requirement cancellation preflight", async () => {
    const api = {
      ...createApi(),
      get: vi.fn(async () => ({
        data: {
          canCancel: false,
          modeRequired: "UNLINK_REFERENCES",
          referenceCount: 2,
        },
      })),
    } as DocumentApiTransport;

    await expect(
      getCancelRequirementPreflight({ documentId }, api),
    ).resolves.toEqual({
      canCancel: false,
      modeRequired: "UNLINK_REFERENCES",
      referenceCount: 2,
    });
    expect(api.get).toHaveBeenCalledWith(
      `/documents/${documentId}/cancel-requirement`,
    );
  });

  it("archives, restores, and deletes a document", async () => {
    const api = createApi();

    await archiveDocument(documentId, api);
    await restoreDocument(documentId, api);
    await deleteDocument(documentId, api);

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      `/documents/${documentId}/archive`,
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      `/documents/${documentId}/restore`,
    );
    expect(api.delete).toHaveBeenCalledWith(`/documents/${documentId}`);
  });

  it("manages document folders and moves documents between folders", async () => {
    const api = {
      ...createApi(),
      get: vi.fn(async (path: string) => ({
        data:
          path === `/documents/${documentId}`
            ? createDocumentFixture({ folderId: "FLD_02", revision: 4 })
            : [
                {
                  depth: 0,
                  descendantDocumentCount: 2,
                  documentCount: 1,
                  id: "FLD_01",
                  name: "Plans",
                  parentId: null,
                  sortOrder: 0,
                  spaceId,
                  version: 1,
                },
              ],
      })),
      post: vi.fn(async () => ({
        data: {
          depth: 0,
          descendantDocumentCount: 0,
          documentCount: 0,
          id: "FLD_02",
          name: "Archive",
          parentId: null,
          sortOrder: 1,
          spaceId,
          version: 1,
        },
      })),
      patch: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            depth: 0,
            descendantDocumentCount: 0,
            documentCount: 0,
            id: "FLD_01",
            name: "Renamed",
            parentId: null,
            sortOrder: 0,
            spaceId,
            version: 2,
          },
        })
        .mockResolvedValueOnce({
          data: createDocumentFixture({ folderId: "FLD_02", revision: 4 }),
        }),
    } as DocumentApiTransport;

    await expect(listDocumentFolders({ spaceId }, api)).resolves.toMatchObject([
      { id: "FLD_01", name: "Plans" },
    ]);
    await createDocumentFolder(
      { name: "Archive", parentId: null, spaceId },
      api,
    );
    await updateDocumentFolder(
      { folderId: "FLD_01", name: "Renamed", version: 1 },
      api,
    );
    await moveDocumentFolder(
      { folderId: "FLD_01", parentId: "FLD_02", version: 1 },
      api,
    );
    await moveDocumentToFolder(
      {
        baseRevision: 3,
        documentId,
        folderId: "FLD_02",
        spaceId,
      },
      api,
    );
    await deleteDocumentFolder({ folderId: "FLD_01", spaceId }, api);

    expect(api.get).toHaveBeenCalledWith(`/spaces/${spaceId}/document-folders`);
    expect(api.get).toHaveBeenCalledWith(`/documents/${documentId}`);
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      `/spaces/${spaceId}/document-folders`,
      { name: "Archive" },
    );
    expect(api.patch).toHaveBeenNthCalledWith(1, "/document-folders/FLD_01", {
      name: "Renamed",
      version: 1,
    });
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/document-folders/FLD_01/move",
      { parentId: "FLD_02", version: 1 },
    );
    expect(api.patch).toHaveBeenNthCalledWith(
      2,
      `/documents/${documentId}/folder`,
      {
        baseRevision: 3,
        folderId: "FLD_02",
      },
    );
    expect(api.delete).toHaveBeenCalledWith("/document-folders/FLD_01");
  });

  it("reorders document folders and forwards move sort order", async () => {
    const api = {
      ...createApi(),
      post: vi.fn(async (path: string) => ({
        data: path.endsWith("/reorder")
          ? {
              items: [
                {
                  depth: 0,
                  descendantDocumentCount: 0,
                  documentCount: 0,
                  id: "FLD_02",
                  name: "Archive",
                  parentId: null,
                  sortOrder: 0,
                  spaceId,
                  version: 2,
                },
              ],
            }
          : {
              depth: 1,
              descendantDocumentCount: 0,
              documentCount: 0,
              id: "FLD_01",
              name: "Plans",
              parentId: "FLD_02",
              sortOrder: 2048,
              spaceId,
              version: 2,
            },
      })),
    } as DocumentApiTransport;

    await reorderDocumentFolders(
      {
        orderedFolderIds: ["FLD_02", "FLD_01"],
        parentId: null,
        spaceId,
      },
      api,
    );
    await moveDocumentFolder(
      {
        folderId: "FLD_01",
        parentId: "FLD_02",
        sortOrder: 2048,
        version: 1,
      },
      api,
    );

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      `/spaces/${spaceId}/document-folders/reorder`,
      {
        orderedFolderIds: ["FLD_02", "FLD_01"],
        parentId: null,
      },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/document-folders/FLD_01/move",
      {
        parentId: "FLD_02",
        sortOrder: 2048,
        version: 1,
      },
    );
  });

  it("moves multiple documents to a folder through the batch endpoint", async () => {
    const api = {
      ...createApi(),
      patch: vi.fn(async () => ({
        data: {
          items: [
            createDocumentFixture({ folderId: "FLD_02", id: "DOC_01" }),
            createDocumentFixture({ folderId: "FLD_02", id: "DOC_02" }),
          ],
        },
      })),
    } as DocumentApiTransport;

    await expect(
      moveDocumentsToFolder(
        {
          documentIds: ["DOC_01", "DOC_02"],
          folderId: "FLD_02",
          spaceId,
        },
        api,
      ),
    ).resolves.toMatchObject([
      { folderId: "FLD_02", id: "DOC_01" },
      { folderId: "FLD_02", id: "DOC_02" },
    ]);

    expect(api.patch).toHaveBeenCalledWith(
      `/spaces/${spaceId}/documents/folder`,
      {
        documentIds: ["DOC_01", "DOC_02"],
        folderId: "FLD_02",
      },
    );
  });
});
