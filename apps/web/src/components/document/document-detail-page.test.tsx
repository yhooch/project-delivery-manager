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

const searchParamsMock = vi.hoisted(() => ({
  current: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    currentOrganization: { id: "ORG_01", name: "Org A" },
    currentSpace: {
      id: "SPC_01",
      name: "Space A",
      role: "PM",
      status: "ACTIVE",
    },
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      user: { id: "USER_01" },
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
  cancelRequirementMock,
  convertDocumentToRequirementMock,
  deleteDocumentMock,
  getCancelRequirementPreflightMock,
  getDocumentMock,
  listDocumentFoldersMock,
  listDocumentsMock,
  listReferencingDocumentsMock,
  moveDocumentToFolderMock,
  reimportDocumentMock,
  restoreDocumentMock,
  updateDocumentMock,
} = vi.hoisted(() => ({
  archiveDocumentMock: vi.fn(),
  cancelRequirementMock: vi.fn(),
  convertDocumentToRequirementMock: vi.fn(),
  deleteDocumentMock: vi.fn(),
  getCancelRequirementPreflightMock: vi.fn(),
  getDocumentMock: vi.fn(),
  listDocumentFoldersMock: vi.fn(),
  listDocumentsMock: vi.fn(),
  listReferencingDocumentsMock: vi.fn(),
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
    cancelRequirement: cancelRequirementMock,
    convertDocumentToRequirement: convertDocumentToRequirementMock,
    deleteDocument: deleteDocumentMock,
    getCancelRequirementPreflight: getCancelRequirementPreflightMock,
    getDocument: getDocumentMock,
    listDocumentFolders: listDocumentFoldersMock,
    listDocuments: listDocumentsMock,
    listReferencingDocuments: listReferencingDocumentsMock,
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
    contentFormat: "MARKDOWN",
    contentMarkdown: "# Launch plan\n\nReview TASK-42.",
    createdAt: "2026-05-27T10:00:00.000Z",
    createdByName: "Ada",
    createdMcpClientName: "Codex",
    createdVia: "MCP_CLIENT",
    folderId: "FLD_01",
    id: "DOC_01",
    kind: "GENERAL",
    lastEditedAt: "2026-05-27T11:00:00.000Z",
    lastEditedByName: "Ada",
    lastEditedMcpClientName: "Claude Code",
    lastEditedVia: "MCP_CLIENT",
    links: [
      {
        displayCode: "REQ-12",
        id: "LNK_01",
        targetId: "REQ_01",
        targetType: "DOCUMENT",
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
        eventType: "UPDATED",
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
  searchParamsMock.current = new URLSearchParams();
  routerPushMock.mockReset();
  archiveDocumentMock.mockReset();
  cancelRequirementMock.mockReset();
  convertDocumentToRequirementMock.mockReset();
  deleteDocumentMock.mockReset();
  getCancelRequirementPreflightMock.mockReset();
  getDocumentMock.mockReset();
  listDocumentFoldersMock.mockReset();
  listDocumentsMock.mockReset();
  listReferencingDocumentsMock.mockReset();
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
  listDocumentsMock.mockResolvedValue({ items: [], total: 0 });
  listReferencingDocumentsMock.mockResolvedValue({ items: [], total: 0 });
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
  convertDocumentToRequirementMock.mockResolvedValue({
    ...createDocument(),
    displayCode: "REQ-13",
    id: "DOC_01",
    kind: "REQUIREMENT",
    sequence: 13,
  });
  getCancelRequirementPreflightMock.mockResolvedValue({
    canCancel: true,
    referenceCount: 0,
  });
  cancelRequirementMock.mockResolvedValue({
    ...createDocument(),
    kind: "GENERAL",
    revision: 4,
  });
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
    expect(markdownViewer).toHaveClass("w-full", "min-w-0");
    const markdownHeading = within(markdownViewer).getByRole("heading", {
      level: 1,
      name: "Launch plan",
    });
    expect(markdownHeading).toHaveClass("max-w-full", "break-words");
    expect(markdownHeading).toHaveAttribute("id", "launch-plan");
    expect(markdownHeading).toHaveClass("scroll-mt-28");
    expect(screen.getByTestId("document-linked-resources")).toBeVisible();
    expect(
      within(screen.getByTestId("document-linked-resources")).getByRole(
        "link",
        { name: /REQ-12Requirement/u },
      ),
    ).toHaveAttribute("href", "/requirements/REQ_01");
    expect(screen.getByTestId("document-toc-rail")).toBeVisible();
    expect(screen.getByTestId("document-toc-rail").parentElement).toHaveClass(
      "hidden",
      "lg:block",
    );
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
    await waitFor(() =>
      expect(listReferencingDocumentsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 5,
          spaceId: "SPC_01",
          targetDocumentId: "DOC_01",
        }),
      ),
    );
  });

  it("renders all markdown headings in the table of contents", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      contentMarkdown: Array.from(
        { length: 13 },
        (_, index) => `## Section ${index + 1}`,
      ).join("\n\n"),
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    const tocRail = await screen.findByTestId("document-toc-rail");

    expect(
      await within(tocRail).findByRole("link", { name: "Section 13" }),
    ).toHaveAttribute("href", "#section-13");
  });

  it("stacks document detail actions on narrow screens", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    const actions = await screen.findByTestId("document-detail-actions");

    expect(actions).toHaveClass(
      "w-full",
      "sm:w-auto",
      "[&>*]:w-full",
      "sm:[&>*]:w-auto",
    );
  });

  it("shows documents that reference the current document", async () => {
    listReferencingDocumentsMock.mockResolvedValueOnce({
      items: [
        {
          contentFormat: "MARKDOWN",
          createdAt: "2026-05-27T10:00:00.000Z",
          id: "DOC_REF",
          kind: "GENERAL",
          lastEditedAt: "2026-05-28T10:00:00.000Z",
          lastEditedVia: "USER",
          organizationId: "ORG_01",
          revision: 1,
          sourceType: "PASTE_MARKDOWN",
          spaceId: "SPC_01",
          status: "ACTIVE",
          title: "Referencing note",
          updatedAt: "2026-05-28T10:00:00.000Z",
        },
      ],
      total: 1,
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    const references = await screen.findByTestId(
      "referencing-documents-section",
    );
    await within(references).findByText("Referencing note");
    expect(
      within(references).getByTestId("referencing-document-link"),
    ).toHaveAttribute("href", "/documents/DOC_REF");
  });

  it("renders rich-text requirement exports in the document reader", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      contentFormat: "TIPTAP_JSON",
      contentJson: { content: [], type: "doc" },
      contentMarkdown: "",
      contentMarkdownCache: "# Requirement body",
      displayCode: "REQ-12",
      id: "REQ_01",
      kind: "REQUIREMENT",
      sequence: 12,
      summary: "Requirement summary",
      title: "Requirement document",
    });

    render(<DocumentDetailPage documentId="REQ_01" />);

    expect(await screen.findByText("Requirement document")).toBeVisible();
    expect(
      screen.getByTestId("document-requirement-identity"),
    ).toHaveTextContent("REQ-12");
    expect(
      screen.getByTestId("document-open-requirement-button"),
    ).toHaveAttribute("href", "/requirements/REQ_01");
    const markdownViewer = screen.getByTestId("document-markdown-viewer");
    expect(markdownViewer).toHaveTextContent("Requirement body");
    expect(
      within(markdownViewer).getByRole("heading", {
        level: 1,
        name: "Requirement body",
      }),
    ).toBeVisible();
    expect(
      screen.queryByTestId("document-managed-content-panel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("document-edit-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("document-archive-button"),
    ).not.toBeInTheDocument();
  });

  it("renders Markdown requirement documents in the document reader", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      contentMarkdown: "# Requirement markdown",
      displayCode: "REQ-12",
      id: "REQ_01",
      kind: "REQUIREMENT",
      sequence: 12,
      title: "Markdown requirement document",
    });

    render(<DocumentDetailPage documentId="REQ_01" />);

    expect(
      await screen.findByText("Markdown requirement document"),
    ).toBeVisible();
    expect(screen.getByTestId("document-markdown-viewer")).toHaveTextContent(
      "Requirement markdown",
    );
    expect(
      screen.queryByTestId("document-managed-content-panel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("document-edit-button"),
    ).not.toBeInTheDocument();
  });

  it("wraps long inline code without splitting short identifiers", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      contentMarkdown:
        "# Inline code\n\n`SD-001` uses `speaker_tts_play_start / speaker_audio_play_start`.",
      title: "Inline code",
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    const markdownViewer = await screen.findByTestId(
      "document-markdown-viewer",
    );
    expect(
      within(markdownViewer).getByRole("heading", {
        level: 1,
        name: "Inline code",
      }),
    ).toBeVisible();
    expect(within(markdownViewer).getByText("SD-001")).toHaveClass(
      "whitespace-nowrap",
    );
    expect(
      within(markdownViewer).getByText(
        "speaker_tts_play_start / speaker_audio_play_start",
      ),
    ).toHaveClass("break-words");
  });

  it("converts general documents to requirements from the document detail", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(
      await screen.findByTestId("document-convert-requirement-button"),
    );

    await waitFor(() =>
      expect(convertDocumentToRequirementMock).toHaveBeenCalledWith({
        activate: true,
        baseRevision: 3,
        documentId: "DOC_01",
        title: "Launch plan",
      }),
    );
    expect(routerPushMock).toHaveBeenCalledWith("/requirements/DOC_01");
  });

  it("cancels requirement semantics through the controlled dialog", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      displayCode: "REQ-12",
      id: "REQ_01",
      kind: "REQUIREMENT",
      sequence: 12,
      title: "Requirement document",
    });
    getCancelRequirementPreflightMock.mockResolvedValueOnce({
      canCancel: false,
      modeRequired: "UNLINK_REFERENCES",
      referenceCount: 2,
    });

    render(<DocumentDetailPage documentId="REQ_01" />);

    fireEvent.click(
      await screen.findByTestId("document-cancel-requirement-button"),
    );
    await waitFor(() =>
      expect(getCancelRequirementPreflightMock).toHaveBeenCalledWith({
        documentId: "REQ_01",
      }),
    );
    const confirmButton = await screen.findByTestId(
      "document-cancel-requirement-confirm",
    );
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(cancelRequirementMock).toHaveBeenCalledWith({
        baseRevision: 3,
        documentId: "REQ_01",
        reason: undefined,
        referenceMode: "UNLINK_REFERENCES",
      }),
    );
  });

  it("renders rich-text document exports in the reader while keeping edit mode closed", async () => {
    getDocumentMock.mockResolvedValueOnce({
      ...createDocument(),
      contentFormat: "TIPTAP_JSON",
      contentJson: { content: [], type: "doc" },
      contentMarkdown: "",
      contentMarkdownCache: "# Rich text export",
      title: "Rich text doc",
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    expect(await screen.findByText("Rich text doc")).toBeVisible();
    expect(screen.getByTestId("document-markdown-viewer")).toHaveTextContent(
      "Rich text export",
    );
    expect(
      screen.queryByTestId("document-managed-content-panel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("document-content-input"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("document-edit-button")).toBeInTheDocument();
  });

  it("uses subresource totals in the context rail", async () => {
    listCommentsMock.mockResolvedValueOnce({
      items: [
        {
          author: { name: "Ada", username: "ada" },
          body: "First visible comment",
          createdAt: "2026-05-27T12:00:00.000Z",
          id: "CMT_01",
        },
      ],
      total: 9,
    });
    listAttachmentsMock.mockResolvedValueOnce({
      items: [{ fileName: "source.docx", id: "ATT_01", size: 1024 }],
      total: 7,
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    const rail = await screen.findByTestId("document-context-rail");
    expect(
      within(rail).getByRole("link", { name: /documents\.rail\.viewAll 9/u }),
    ).toHaveAttribute("href", "#document-comments");
    expect(
      within(rail).getByRole("link", { name: /documents\.rail\.viewAll 7/u }),
    ).toHaveAttribute("href", "#document-attachments");
  });

  it("collapses imported document attachments after the first five", async () => {
    const importedAttachments = Array.from({ length: 25 }, (_, index) => ({
      fileName: `inline-image-${index + 1}.png`,
      id: `ATT_${index + 1}`,
      size: 1024,
    }));
    listAttachmentsMock.mockResolvedValueOnce({
      items: importedAttachments,
      total: importedAttachments.length,
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    expect(await screen.findByText("inline-image-5.png")).toBeVisible();
    expect(screen.queryByText("inline-image-6.png")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(listAttachmentsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 200,
          targetId: "DOC_01",
          targetType: "DOCUMENT",
        }),
      ),
    );
    expect(
      screen.getAllByTestId("document-attachment-download-link"),
    ).toHaveLength(5);

    const toggle = screen.getByTestId("document-attachments-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(await screen.findByText("inline-image-25.png")).toBeVisible();
    expect(
      screen.getAllByTestId("document-attachment-download-link"),
    ).toHaveLength(25);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("expands collapsed attachments when a focused attachment is present", async () => {
    const importedAttachments = Array.from({ length: 8 }, (_, index) => ({
      fileName: `inline-image-${index + 1}.png`,
      id: `ATT_${index + 1}`,
      size: 1024,
    }));
    searchParamsMock.current = new URLSearchParams("attachmentId=ATT_8");
    listAttachmentsMock.mockResolvedValueOnce({
      items: importedAttachments,
      total: importedAttachments.length,
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    expect(await screen.findByText("inline-image-8.png")).toBeVisible();
    expect(screen.getByTestId("document-attachments-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("opens document attachments in a new tab for preview and keeps download separate", async () => {
    listAttachmentsMock.mockResolvedValueOnce({
      items: [{ fileName: "notes.md", id: "ATT_01", size: 1024 }],
      total: 1,
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    const previewLink = await screen.findByTestId(
      "document-attachment-preview-link",
    );
    const downloadLink = screen.getByTestId("document-attachment-download-link");

    expect(previewLink).toHaveAttribute(
      "href",
      "/api/v1/attachments/ATT_01/download",
    );
    expect(previewLink).toHaveAttribute("target", "_blank");
    expect(previewLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(downloadLink).toHaveAttribute(
      "href",
      "/api/v1/attachments/ATT_01/download",
    );
    expect(downloadLink).toHaveAttribute("download", "notes.md");
    expect(downloadLink).not.toHaveAttribute("target");
  });

  it("hides preview for Word document attachments", async () => {
    listAttachmentsMock.mockResolvedValueOnce({
      items: [{ fileName: "source.docx", id: "ATT_01", size: 1024 }],
      total: 1,
    });

    render(<DocumentDetailPage documentId="DOC_01" />);

    expect(await screen.findByText("source.docx")).toBeVisible();
    expect(
      screen.queryByTestId("document-attachment-preview-link"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("document-attachment-download-link"),
    ).toHaveAttribute("download", "source.docx");
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
    expect(backLinkBar.closest("form")).toBeNull();
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

  it("writes requirement resource codes as document link targets", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-edit-button"));
    fireEvent.click(screen.getByTestId("document-save-button"));

    await waitFor(() =>
      expect(updateDocumentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          linkTargets: [{ targetId: "REQ_01", targetType: "DOCUMENT" }],
        }),
      ),
    );
  });

  it("removes requirement document links when resource codes are cleared", async () => {
    render(<DocumentDetailPage documentId="DOC_01" />);

    fireEvent.click(await screen.findByTestId("document-edit-button"));
    expect(screen.getByTestId("document-links-input")).toHaveValue("REQ-12");
    fireEvent.change(screen.getByTestId("document-links-input"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("document-save-button"));

    await waitFor(() => expect(updateDocumentMock).toHaveBeenCalled());
    expect(updateDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        linkTargets: [],
      }),
    );
    expect(lookupObjectCodeMock).not.toHaveBeenCalled();
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
