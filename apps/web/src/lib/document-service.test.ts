import { describe, expect, it, vi } from "vitest";

import {
  archiveDocument,
  deleteDocument,
  getDocument,
  importDocxDocument,
  importMarkdownDocument,
  listDocuments,
  reimportDocument,
  restoreDocument,
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
    contentMarkdown: "# Plan",
    createdAt: "2026-05-27T10:00:00.000Z",
    id: documentId,
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
        tagIds: ["TAG_01"],
        tagMatch: "ANY",
      },
    });
  });

  it("imports markdown and docx files with FormData and no JSON body", async () => {
    const api = createApi();
    const md = new File(["# Plan"], "plan.md", { type: "text/markdown" });
    const docx = new File(["docx"], "plan.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await importMarkdownDocument({ spaceId }, { file: md, title: "Plan" }, api);
    await importDocxDocument({ spaceId }, { file: docx }, api);

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
        linkTargets: [{ targetId: "REQ_01", targetType: "REQUIREMENT" }],
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
        links: [{ targetId: "REQ_01", targetType: "REQUIREMENT" }],
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
});
