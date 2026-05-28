// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) => {
      const renderedValues = values
        ? Object.values(values)
            .filter((value) => value !== undefined && value !== null)
            .join(" ")
        : "";

      return `${namespace ? `${namespace}.` : ""}${key}${
        renderedValues ? ` ${renderedValues}` : ""
      }`;
    };
  },
}));

const routerPushMock = vi.hoisted(() => vi.fn());
vi.mock("../../i18n/routing", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: routerPushMock }),
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    currentOrganization: { id: "ORG_01", name: "Org A" },
    currentSpace: { id: "SPC_01", name: "Space A" },
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    status: "authenticated",
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

vi.mock("../shell/recent-opens", () => ({
  recordRecentOpen: vi.fn(),
}));

vi.mock("../tag", () => ({
  TagBadgeList: () => <span data-testid="mock-tag-badges" />,
  TagSelectionField: () => <div data-testid="document-tags-field" />,
}));

const {
  archiveDocumentMock,
  deleteDocumentMock,
  getDocumentMock,
  listDocumentFoldersMock,
  listDocumentsMock,
  moveDocumentToFolderMock,
  reimportDocumentMock,
  restoreDocumentMock,
  updateDocumentMock,
} = vi.hoisted(() => ({
  archiveDocumentMock: vi.fn(),
  deleteDocumentMock: vi.fn(),
  getDocumentMock: vi.fn(),
  listDocumentFoldersMock: vi.fn(),
  listDocumentsMock: vi.fn(),
  moveDocumentToFolderMock: vi.fn(),
  reimportDocumentMock: vi.fn(),
  restoreDocumentMock: vi.fn(),
  updateDocumentMock: vi.fn(),
}));
vi.mock("../../lib/document-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/document-service")
  >("../../lib/document-service");
  return {
    ...actual,
    archiveDocument: archiveDocumentMock,
    deleteDocument: deleteDocumentMock,
    getDocument: getDocumentMock,
    listDocumentFolders: listDocumentFoldersMock,
    listDocuments: listDocumentsMock,
    moveDocumentToFolder: moveDocumentToFolderMock,
    reimportDocument: reimportDocumentMock,
    restoreDocument: restoreDocumentMock,
    updateDocument: updateDocumentMock,
  };
});

const {
  createCommentMock,
  listCommentsMock,
  listAttachmentsMock,
  listTimelineMock,
  uploadAttachmentMock,
} = vi.hoisted(() => ({
  createCommentMock: vi.fn(),
  listCommentsMock: vi.fn(),
  listAttachmentsMock: vi.fn(),
  listTimelineMock: vi.fn(),
  uploadAttachmentMock: vi.fn(),
}));
vi.mock("../../lib/comment-service", () => ({
  createComment: createCommentMock,
  listComments: listCommentsMock,
}));
vi.mock("../../lib/attachment-service", () => {
  class AttachmentUploadError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.name = "AttachmentUploadError";
      this.code = code;
    }
  }

  return {
    AttachmentUploadError,
    createAttachmentDownloadUrl: (attachmentId: string) =>
      `/api/v1/attachments/${attachmentId}/download`,
    listAttachments: listAttachmentsMock,
    uploadAttachment: uploadAttachmentMock,
  };
});
vi.mock("../../lib/timeline-service", () => ({
  listTimeline: listTimelineMock,
}));

const { realtimeCallbacks } = vi.hoisted(() => ({
  realtimeCallbacks: new Map<string, (context: unknown) => void>(),
}));
vi.mock("../../lib/realtime", () => ({
  realtimeContextIncludesTarget: (
    context: {
      events?: Array<{
        hints?: { targetId?: string; targetType?: string };
        target?: { id?: string; type?: string };
      }>;
      resyncs?: unknown[];
    },
    target: { id: string; type: string },
  ) =>
    (context.resyncs?.length ?? 0) > 0 ||
    (context.events ?? []).some(
      (event) =>
        (event.target?.id === target.id &&
          event.target?.type === target.type) ||
        (event.hints?.targetId === target.id &&
          event.hints?.targetType === target.type),
    ),
  useRealtimeInvalidation: (
    keys: readonly string[],
    callback: (context: unknown) => void,
  ) => {
    keys.forEach((key) => realtimeCallbacks.set(key, callback));
  },
}));

const { lookupObjectCodeMock } = vi.hoisted(() => ({
  lookupObjectCodeMock: vi.fn(),
}));
vi.mock("../../lib/object-code-service", () => ({
  lookupObjectCode: lookupObjectCodeMock,
}));

import { DocumentDetailPage } from "./document-detail-page";

function createDocument() {
  return {
    attachments: [{ fileName: "source.docx", id: "ATT_01" }],
    comments: [
      {
        authorName: "Ada",
        body: "Looks good",
        createdAt: "2026-05-27T12:00:00.000Z",
        id: "CMT_01",
      },
    ],
    contentMarkdown: "# Launch plan\n\nReview TASK-42.",
    createdAt: "2026-05-27T10:00:00.000Z",
    createdByName: "Ada",
    createdMcpClientName: "Codex",
    createdVia: "MCP_CLIENT",
    folderId: "FLD_01",
    id: "DOC_01",
    lastEditedAt: "2026-05-27T11:00:00.000Z",
    lastEditedByName: "Ada",
    lastEditedMcpClientName: "Claude Code",
    lastEditedVia: "MCP_CLIENT",
    links: [
      {
        displayCode: "REQ-12",
        id: "LNK_01",
        targetId: "REQ_01",
        targetType: "REQUIREMENT",
        title: "Requirement",
      },
    ],
    organizationId: "ORG_01",
    revision: 3,
    sourceType: "MCP_CREATED",
    spaceId: "SPC_01",
    status: "ACTIVE",
    tags: [],
    timeline: [
      {
        changeType: "CONTENT_REPLACED",
        createdAt: "2026-05-27T12:00:00.000Z",
        id: "EVT_01",
      },
    ],
    title: "Launch plan",
    updatedAt: "2026-05-27T11:00:00.000Z",
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  routerPushMock.mockReset();
  archiveDocumentMock.mockReset();
  deleteDocumentMock.mockReset();
  getDocumentMock.mockReset();
  listDocumentFoldersMock.mockReset();
  listDocumentsMock.mockReset();
  moveDocumentToFolderMock.mockReset();
  reimportDocumentMock.mockReset();
  restoreDocumentMock.mockReset();
  updateDocumentMock.mockReset();
  createCommentMock.mockReset();
  listCommentsMock.mockReset();
  listAttachmentsMock.mockReset();
  listTimelineMock.mockReset();
  uploadAttachmentMock.mockReset();
  lookupObjectCodeMock.mockReset();
  realtimeCallbacks.clear();
  getDocumentMock.mockResolvedValue(createDocument());
  listCommentsMock.mockResolvedValue({ items: [], total: 0 });
  listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
  listTimelineMock.mockResolvedValue({ items: [], total: 0 });
  lookupObjectCodeMock.mockResolvedValue({
    displayCode: "REQ-12",
    id: "REQ_01",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Requirement",
    type: "REQUIREMENT",
  });
  updateDocumentMock.mockResolvedValue({
    ...createDocument(),
    revision: 4,
    title: "Updated plan",
  });
  archiveDocumentMock.mockResolvedValue({
    ...createDocument(),
    status: "ARCHIVED",
  });
  listDocumentFoldersMock.mockResolvedValue([
    {
      depth: 0,
      descendantDocumentCount: 1,
      documentCount: 1,
      id: "FLD_01",
      name: "Plans",
      parentId: null,
      sortOrder: 0,
      spaceId: "SPC_01",
      version: 1,
    },
    {
      depth: 0,
      descendantDocumentCount: 0,
      documentCount: 0,
      id: "FLD_02",
      name: "Archive",
      parentId: null,
      sortOrder: 1,
      spaceId: "SPC_01",
      version: 1,
    },
  ]);
  moveDocumentToFolderMock.mockResolvedValue({
    ...createDocument(),
    folderId: "FLD_02",
    revision: 4,
  });
  restoreDocumentMock.mockResolvedValue(createDocument());
  deleteDocumentMock.mockResolvedValue(undefined);
  uploadAttachmentMock.mockResolvedValue(undefined);
  createCommentMock.mockResolvedValue({
    author: { id: "USER_01", name: "Ada", username: "ada" },
    body: "Looks good",
    createdAt: "2026-05-27T12:00:00.000Z",
    id: "CMT_02",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    targetId: "DOC_01",
    targetType: "DOCUMENT",
  });
});

describe("DocumentDetailPage", () => {
  it("renders the reading view with markdown, linked resources, and context rail", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    expect((await screen.findAllByText("Launch plan"))[0]).toBeVisible();
    const markdownViewer = screen.getByTestId("document-markdown-viewer");
    expect(markdownViewer).toBeVisible();
    const markdownHeading = within(markdownViewer).getByRole("heading", {
      level: 1,
      name: "Launch plan",
    });
    expect(markdownHeading).toHaveAttribute("id", "launch-plan");
    expect(markdownHeading).toHaveClass("scroll-mt-28");
    expect(screen.getByTestId("document-linked-resources")).toBeVisible();
    expect(screen.getByTestId("document-toc-rail")).toBeVisible();
    expect(screen.getByTestId("document-context-rail")).toBeVisible();
    expect(
      within(screen.getByTestId("document-toc-rail")).getByRole("link", {
        name: "Launch plan",
      }),
    ).toHaveAttribute("href", "#launch-plan");
    expect(
      within(screen.getByTestId("document-context-rail")).queryByText(
        "documents.rail.toc",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("REQ-12")[0]).toBeVisible();
    expect(
      screen.getAllByText(/documents\.meta\.createdViaClient Ada Codex/u)[0],
    ).toBeVisible();
    expect(
      screen.getAllByText(
        /documents\.meta\.editedViaClient Ada Claude Code/u,
      )[0],
    ).toBeVisible();
  });

  it("uses the stored document list href for the back-to-list action", async () => {
    window.sessionStorage.setItem(
      "documents.lastListHref",
      "/documents?directoryView=folder&folderId=FLD_99&includeDescendants=true&query=launch",
    );

    render(<DocumentDetailPage documentId="DOC_01" />);

    const backLink = await screen.findByTestId("document-back-to-list");
    const backLinkBar = screen.getByTestId("document-back-to-list-bar");

    expect(backLinkBar).toContainElement(backLink);
    expect(backLinkBar).toHaveClass("sticky", "top-12", "z-20");
    await waitFor(() =>
      expect(backLink).toHaveAttribute(
        "href",
        "/documents?directoryView=folder&folderId=FLD_99&includeDescendants=true&query=launch",
      ),
    );
  });

  it("falls back to the document folder when no stored list href exists", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    expect(await screen.findByTestId("document-back-to-list")).toHaveAttribute(
      "href",
      "/documents?directoryView=folder&folderId=FLD_01",
    );
  });

  it("falls back to the archived list for archived documents without a folder", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      folderId: null,
      status: "ARCHIVED",
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    expect(await screen.findByTestId("document-back-to-list")).toHaveAttribute(
      "href",
      "/documents?directoryView=archived",
    );
  });

  it("falls back to all documents for active documents without a folder", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      folderId: null,
      status: "ACTIVE",
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    expect(await screen.findByTestId("document-back-to-list")).toHaveAttribute(
      "href",
      "/documents",
    );
  });

  it("opens the lightweight edit panel and saves with base revision", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-edit-button"));
    fireEvent.change(screen.getByTestId("document-title-input"), {
      target: { value: "Updated plan" },
    });
    fireEvent.click(screen.getByTestId("document-save-button"));

    await waitFor(() =>
      expect(updateDocumentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          baseRevision: 3,
          documentId: "DOC_01",
          title: "Updated plan",
        }),
      ),
    );
    expect(updateDocumentMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "contentMarkdown",
    );
  });

  it("enters edit mode without submitting the update form", async () => {
    const user = userEvent.setup();
    render(<DocumentDetailPage documentId="DOC_01" />);

    await user.click(await screen.findByTestId("document-edit-button"));

    expect(await screen.findByTestId("document-edit-panel")).toBeVisible();
    expect(screen.getByTestId("document-save-button")).toBeVisible();
    expect(updateDocumentMock).not.toHaveBeenCalled();
  });

  it("sends edited markdown content when the body changes", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-edit-button"));
    fireEvent.change(screen.getByTestId("document-content-input"), {
      target: { value: "# Updated body" },
    });
    fireEvent.click(screen.getByTestId("document-save-button"));

    await waitFor(() =>
      expect(updateDocumentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          baseRevision: 3,
          contentMarkdown: "# Updated body",
          documentId: "DOC_01",
        }),
      ),
    );
  });

  it("keeps dirty edit input and shows a new-version notice after realtime refresh", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-edit-button"));
    fireEvent.change(screen.getByTestId("document-content-input"), {
      target: { value: "# Local draft" },
    });
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      contentMarkdown: "# Remote update",
      revision: 4,
      title: "Remote update",
    });

    const callback = realtimeCallbacks.get("document-detail");
    expect(callback).toBeDefined();
    await act(async () => {
      callback?.({
        events: [{ target: { id: "DOC_01", type: "DOCUMENT" } }],
        mode: "realtime",
        resyncs: [],
      });
    });

    expect(
      await screen.findByTestId("document-new-version-alert"),
    ).toBeVisible();
    expect(screen.getByTestId("document-content-input")).toHaveValue(
      "# Local draft",
    );
  });

  it("adds another document through search without requiring a DOC code", async () => {
    listDocumentsMock.mockResolvedValueOnce({
      items: [
        {
          contentSnippet: "Related context",
          createdAt: "2026-05-27T09:00:00.000Z",
          id: "DOC_02",
          lastEditedAt: "2026-05-27T10:00:00.000Z",
          lastEditedVia: "USER",
          organizationId: "ORG_01",
          revision: 1,
          sourceType: "UPLOAD_MARKDOWN",
          spaceId: "SPC_01",
          status: "ACTIVE",
          title: "Related document",
          updatedAt: "2026-05-27T10:00:00.000Z",
        },
      ],
      total: 1,
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-edit-button"));
    fireEvent.change(
      screen.getByTestId("document-linked-document-search-input"),
      {
        target: { value: "related" },
      },
    );
    fireEvent.click(
      await screen.findByTestId("document-linked-document-result"),
    );
    fireEvent.click(screen.getByTestId("document-save-button"));

    await waitFor(() =>
      expect(updateDocumentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          linkTargets: expect.arrayContaining([
            { targetId: "DOC_02", targetType: "DOCUMENT" },
          ]),
        }),
      ),
    );
  });

  it("moves a document to another folder", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-move-folder-button"));
    await screen.findByTestId("document-move-folder-dialog");
    fireEvent.change(screen.getByTestId("document-move-folder-select"), {
      target: { value: "FLD_02" },
    });
    fireEvent.click(screen.getByText("documents.moveDialog.submit"));

    await waitFor(() =>
      expect(moveDocumentToFolderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          baseRevision: 3,
          documentId: "DOC_01",
          folderId: "FLD_02",
        }),
      ),
    );
  });

  it("creates comments and uploads attachments for the document target", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.change(await screen.findByTestId("document-comment-input"), {
      target: { value: "New document comment" },
    });
    fireEvent.click(screen.getByTestId("document-comment-submit"));

    await waitFor(() =>
      expect(createCommentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "New document comment",
          targetId: "DOC_01",
          targetType: "DOCUMENT",
        }),
      ),
    );

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("document-attachment-input"), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(uploadAttachmentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          file,
          targetId: "DOC_01",
          targetType: "DOCUMENT",
        }),
      ),
    );
  });

  it("restores archived documents and deletes after confirmation", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      status: "ARCHIVED",
    });

    const { unmount } = render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-restore-button"));
    await waitFor(() =>
      expect(restoreDocumentMock).toHaveBeenCalledWith("DOC_01"),
    );
    unmount();

    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      status: "ARCHIVED",
    });
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-delete-button"));
    fireEvent.click(await screen.findByTestId("document-delete-confirm"));

    await waitFor(() =>
      expect(deleteDocumentMock).toHaveBeenCalledWith("DOC_01"),
    );
    expect(routerPushMock).toHaveBeenCalledWith("/documents");
  });
});
