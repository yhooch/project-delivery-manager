// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentSummary } from "../../lib/document-service";

const { routerPushMock, routerReplaceMock, searchParamsMock } = vi.hoisted(
  () => ({
    routerPushMock: vi.fn(),
    routerReplaceMock: vi.fn(),
    searchParamsMock: { current: new URLSearchParams() },
  }),
);
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
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
}));

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

const {
  importDocxDocumentMock,
  importHtmlDocumentMock,
  importMarkdownDocumentMock,
  listDocumentFoldersMock,
  listDocumentsMock,
} = vi.hoisted(() => ({
  importDocxDocumentMock: vi.fn(),
  importHtmlDocumentMock: vi.fn(),
  importMarkdownDocumentMock: vi.fn(),
  listDocumentFoldersMock: vi.fn(),
  listDocumentsMock: vi.fn(),
}));
vi.mock("../../lib/document-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/document-service")
  >("../../lib/document-service");
  return {
    ...actual,
    importDocxDocument: importDocxDocumentMock,
    importHtmlDocument: importHtmlDocumentMock,
    importMarkdownDocument: importMarkdownDocumentMock,
    listDocumentFolders: listDocumentFoldersMock,
    listDocuments: listDocumentsMock,
    pasteDocument: vi.fn(),
  };
});

const { realtimeCallbacks } = vi.hoisted(() => ({
  realtimeCallbacks: new Map<string, (context: unknown) => void>(),
}));
vi.mock("../../lib/realtime", () => ({
  useRealtimeInvalidation: (
    keys: readonly string[],
    callback: (context: unknown) => void,
  ) => {
    keys.forEach((key) => realtimeCallbacks.set(key, callback));
  },
}));

import { DocumentCreateProvider } from "./document-create-context";
import {
  DocumentImportDialog,
  DocumentsPage,
  SourceBadge,
} from "./documents-page";

type CreateActions = {
  openImport: () => void;
  openPaste: () => void;
};

type DocumentListResult = {
  items: DocumentSummary[];
  total: number;
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function renderDocumentsPage(
  actions: CreateActions = {
    openImport: vi.fn(),
    openPaste: vi.fn(),
  },
) {
  return render(
    <DocumentCreateProvider value={actions}>
      <DocumentsPage />
    </DocumentCreateProvider>,
  );
}

function createDocumentSummary(
  overrides: Pick<DocumentSummary, "id" | "title"> & Partial<DocumentSummary>,
): DocumentSummary {
  const { id, title, ...rest } = overrides;
  return {
    contentSnippet: "",
    contentFormat: "MARKDOWN",
    createdAt: "2026-05-27T10:00:00.000Z",
    id,
    kind: "GENERAL",
    lastEditedAt: "2026-05-27T11:00:00.000Z",
    lastEditedVia: "USER",
    organizationId: "ORG_01",
    revision: 1,
    sourceType: "USER_CREATED",
    spaceId: "SPC_01",
    status: "ACTIVE",
    title,
    updatedAt: "2026-05-27T11:00:00.000Z",
    ...rest,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  routerPushMock.mockReset();
  routerReplaceMock.mockReset();
  searchParamsMock.current = new URLSearchParams();
  importDocxDocumentMock.mockReset();
  importHtmlDocumentMock.mockReset();
  importMarkdownDocumentMock.mockReset();
  listDocumentFoldersMock.mockReset();
  listDocumentFoldersMock.mockResolvedValue([]);
  listDocumentsMock.mockReset();
  realtimeCallbacks.clear();
  sessionMock.current = {
    currentOrganization: { id: "ORG_01", name: "Org A" },
    currentSpace: { id: "SPC_01", name: "Space A" },
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    status: "authenticated",
  };
});

describe("DocumentsPage", () => {
  it("stores the current document list href for detail page return navigation", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_01&includeDescendants=true&query=launch",
    );
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    await waitFor(() =>
      expect(window.sessionStorage.getItem("documents.lastListHref")).toBe(
        "/documents?directoryView=folder&folderId=FLD_01&includeDescendants=true&query=launch",
      ),
    );
  });

  it("renders the empty state when the space has no documents", async () => {
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    const emptyState = await screen.findByTestId("documents-empty-state");
    expect(emptyState).toBeVisible();
    expect(within(emptyState).queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("documents-empty-import-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("documents-empty-paste-button"),
    ).not.toBeInTheDocument();
    expect(listDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "all",
        page: 1,
        pageSize: 50,
        sortBy: "lastEditedAt",
        sortOrder: "desc",
        spaceId: "SPC_01",
      }),
    );
  });

  it("renders page-level creation actions and calls the provider", async () => {
    const openImport = vi.fn();
    const openPaste = vi.fn();
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage({ openImport, openPaste });

    await screen.findByTestId("documents-empty-state");
    const actions = screen.getByTestId("documents-create-actions");
    const pasteButton = within(actions).getByTestId("documents-paste-button");
    const importButton = within(actions).getByTestId("documents-import-button");

    expect(pasteButton).toBeVisible();
    expect(importButton).toBeVisible();
    expect(
      (pasteButton.compareDocumentPosition(importButton) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    ).toBe(true);

    fireEvent.click(pasteButton);
    expect(openPaste).toHaveBeenCalledTimes(1);

    fireEvent.click(importButton);
    expect(openImport).toHaveBeenCalledTimes(1);
  });

  it("shows html import source labels", () => {
    render(<SourceBadge sourceType="UPLOAD_HTML" />);

    expect(screen.getByText("documents.source.UPLOAD_HTML")).toBeVisible();
  });

  it("imports html zip packages from the import dialog", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const file = new File(["zip"], "guide.zip", { type: "application/zip" });
    importHtmlDocumentMock.mockResolvedValue({
      ...createDocumentSummary({
        id: "DOC_HTML",
        sourceType: "UPLOAD_HTML",
        title: "HTML Plan",
      }),
      contentMarkdown: "# HTML Plan",
    });

    render(
      <DocumentImportDialog
        folderId="FLD_01"
        onCreated={onCreated}
        onOpenChange={onOpenChange}
        open
        organizationId="ORG_01"
        spaceId="SPC_01"
      />,
    );

    const fileInput = screen.getByTestId("document-import-file-input");
    expect(fileInput).toHaveAttribute(
      "accept",
      ".md,.markdown,.docx,.html,.htm,.zip",
    );
    fireEvent.change(screen.getByTestId("document-import-title-input"), {
      target: { value: "HTML Plan" },
    });
    fireEvent.change(fileInput, {
      target: { files: [file] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "documents.importDialog.submit" }),
    );

    await waitFor(() =>
      expect(importHtmlDocumentMock).toHaveBeenCalledWith(
        { organizationId: "ORG_01", spaceId: "SPC_01" },
        { file, folderId: "FLD_01", title: "HTML Plan" },
      ),
    );
    expect(importMarkdownDocumentMock).not.toHaveBeenCalled();
    expect(importDocxDocumentMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalledWith("DOC_HTML");
  });

  it("does not expose model-generated document filters", async () => {
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    await screen.findByTestId("documents-empty-state");

    expect(
      screen.queryByTestId("documents-filter-mcp-created"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("documents-filter-recent-mcp-edited"),
    ).not.toBeInTheDocument();
  });

  it("reloads with the selected sort option", async () => {
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    await screen.findByTestId("documents-empty-state");
    listDocumentsMock.mockClear();

    await act(async () => {
      fireEvent.change(screen.getByTestId("documents-sort-select"), {
        target: { value: "recentCreated" },
      });
    });

    await waitFor(() =>
      expect(listDocumentsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          sortBy: "createdAt",
          sortOrder: "desc",
        }),
      ),
    );
  });

  it("reads the selected folder from the document directory URL", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_01&includeDescendants=true",
    );
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    await screen.findByTestId("documents-empty-state");

    expect(listDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "all",
        folderId: "FLD_01",
        includeDescendants: false,
        spaceId: "SPC_01",
      }),
    );
  });

  it("reads the root directory view from the document directory URL", async () => {
    searchParamsMock.current = new URLSearchParams("directoryView=root");
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 1,
        documentCount: 0,
        id: "FLD_CHILD",
        name: "Planning",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);
    listDocumentsMock.mockResolvedValue({
      items: [
        createDocumentSummary({
          id: "DOC_ROOT",
          title: "Root note",
        }),
      ],
      total: 1,
    });

    renderDocumentsPage();

    const tree = await screen.findByTestId("documents-resource-tree");

    expect(within(tree).getByText("Planning")).toBeVisible();
    expect(within(tree).getByText("Root note")).toBeVisible();
    expect(listDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: undefined,
        includeDescendants: false,
        unfiled: true,
      }),
    );
  });

  it("renders child folders and direct documents in one resource tree", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_PARENT",
    );
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 2,
        documentCount: 0,
        id: "FLD_PARENT",
        name: "Parent",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 1,
        documentCount: 1,
        id: "FLD_CHILD",
        name: "Planning",
        parentId: "FLD_PARENT",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 2,
        descendantDocumentCount: 0,
        documentCount: 0,
        id: "FLD_GRANDCHILD",
        name: "Roadmap",
        parentId: "FLD_CHILD",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);
    listDocumentsMock.mockResolvedValue({
      items: [
        {
          contentSnippet: "Parent folder note",
          createdAt: "2026-05-27T10:00:00.000Z",
          id: "DOC_01",
          lastEditedAt: "2026-05-27T11:00:00.000Z",
          lastEditedVia: "USER",
          organizationId: "ORG_01",
          revision: 1,
          sourceType: "USER_CREATED",
          spaceId: "SPC_01",
          status: "ACTIVE",
          title: "Parent note",
          updatedAt: "2026-05-27T11:00:00.000Z",
        },
      ],
      total: 1,
    });

    renderDocumentsPage();

    const tree = await screen.findByTestId("documents-resource-tree");
    const folder = within(tree).getByTestId("documents-resource-folder");
    const document = within(tree).getByTestId("documents-list-item");

    expect(within(folder).getByText("Planning")).toBeVisible();
    expect(within(tree).queryByText("Roadmap")).not.toBeInTheDocument();
    expect(
      (folder.compareDocumentPosition(document) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    ).toBe(true);
    expect(screen.getAllByTestId("documents-list-item")).toHaveLength(1);
  });

  it("applies compact density to resource folder rows", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_PARENT",
    );
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 1,
        documentCount: 0,
        id: "FLD_PARENT",
        name: "Parent",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 0,
        documentCount: 0,
        id: "FLD_CHILD",
        name: "Planning",
        parentId: "FLD_PARENT",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    const folderRow = await screen.findByTestId(
      "documents-resource-folder-row",
    );
    expect(folderRow).toHaveClass("min-h-11");

    fireEvent.click(screen.getByTestId("documents-density-compact"));

    expect(folderRow).toHaveClass("min-h-8");
    expect(folderRow).not.toHaveClass("min-h-11");
  });

  it("links to a child folder from the resource tree", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_PARENT&includeDescendants=true",
    );
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 1,
        documentCount: 0,
        id: "FLD_PARENT",
        name: "Parent",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 0,
        documentCount: 0,
        id: "FLD_CHILD",
        name: "Planning",
        parentId: "FLD_PARENT",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    const link = await screen.findByTestId("documents-resource-folder-link");

    expect(link).toHaveAttribute(
      "href",
      "/documents?directoryView=folder&folderId=FLD_CHILD",
    );
  });

  it("does not render the global empty state when a selected folder only has child folders", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_PARENT",
    );
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 0,
        documentCount: 0,
        id: "FLD_PARENT",
        name: "Parent",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 0,
        documentCount: 0,
        id: "FLD_CHILD",
        name: "Planning",
        parentId: "FLD_PARENT",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    expect(await screen.findByTestId("documents-resource-tree")).toBeVisible();
    expect(
      screen.queryByTestId("documents-empty-state"),
    ).not.toBeInTheDocument();
  });

  it("switches from resource tree to flat results while searching documents", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_PARENT",
    );
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 0,
        documentCount: 0,
        id: "FLD_PARENT",
        name: "Parent",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 0,
        documentCount: 0,
        id: "FLD_CHILD",
        name: "Planning",
        parentId: "FLD_PARENT",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    expect(await screen.findByTestId("documents-resource-tree")).toBeVisible();

    fireEvent.change(screen.getByTestId("documents-search-input"), {
      target: { value: "plan" },
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("documents-resource-tree"),
      ).not.toBeInTheDocument(),
    );
  });

  it("reads the unfiled document directory view from the URL", async () => {
    searchParamsMock.current = new URLSearchParams("directoryView=unfiled");
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    renderDocumentsPage();

    await screen.findByTestId("documents-empty-state");

    expect(listDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: null,
        includeDescendants: false,
        unfiled: true,
      }),
    );
  });

  it("renders document rows with source and linked resource summaries", async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        {
          contentSnippet: "Launch scope",
          createdAt: "2026-05-27T10:00:00.000Z",
          createdByName: "Ada",
          createdMcpClientName: "Codex",
          createdVia: "MCP_CLIENT",
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
              targetType: "DOCUMENT",
              title: "Requirement",
            },
          ],
          organizationId: "ORG_01",
          revision: 2,
          sourceType: "MCP_CREATED",
          spaceId: "SPC_01",
          status: "ACTIVE",
          title: "Launch plan",
          updatedAt: "2026-05-27T11:00:00.000Z",
        },
      ],
      total: 1,
    });

    renderDocumentsPage();

    await waitFor(() =>
      expect(screen.getByTestId("documents-list")).toBeVisible(),
    );
    expect(
      screen.queryByTestId("documents-resource-tree"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Launch plan")).toBeVisible();
    expect(screen.getByText("REQ-12")).toBeVisible();
    expect(
      screen.getByText(/documents\.meta\.createdViaClient Ada Codex/u),
    ).toBeVisible();
    expect(
      screen.queryByText(/documents\.meta\.editedViaClient/u),
    ).not.toBeInTheDocument();
  });

  it("marks requirement documents with their REQ code and status", async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        {
          contentFormat: "TIPTAP_JSON",
          contentJson: { content: [], type: "doc" },
          contentMarkdownCache: "Requirement preview",
          createdAt: "2026-05-27T10:00:00.000Z",
          displayCode: "REQ-12",
          id: "REQ_01",
          kind: "REQUIREMENT",
          lastEditedAt: "2026-05-27T11:00:00.000Z",
          lastEditedVia: "USER",
          organizationId: "ORG_01",
          revision: 2,
          sequence: 12,
          sourceType: "MIGRATED_REQUIREMENT",
          spaceId: "SPC_01",
          status: "ACTIVE",
          title: "Requirement document",
          updatedAt: "2026-05-27T11:00:00.000Z",
        },
      ],
      total: 1,
    });

    renderDocumentsPage();

    await waitFor(() =>
      expect(screen.getByTestId("documents-list")).toBeVisible(),
    );

    expect(screen.getByTestId("document-requirement-badge")).toHaveTextContent(
      "REQ-12",
    );
    expect(screen.getByTestId("document-requirement-badge")).toHaveTextContent(
      "documents.status.ACTIVE",
    );
    expect(screen.getByTestId("document-display-code")).toHaveTextContent(
      "REQ-12",
    );
  });

  it("supports selecting multiple documents while keeping detail links", async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        {
          contentSnippet: "Launch scope",
          createdAt: "2026-05-27T10:00:00.000Z",
          id: "DOC_01",
          lastEditedAt: "2026-05-27T11:00:00.000Z",
          lastEditedVia: "USER",
          organizationId: "ORG_01",
          revision: 2,
          sourceType: "UPLOAD_MARKDOWN",
          spaceId: "SPC_01",
          status: "ACTIVE",
          title: "Launch plan",
          updatedAt: "2026-05-27T11:00:00.000Z",
        },
        {
          contentSnippet: "Retro notes",
          createdAt: "2026-05-26T10:00:00.000Z",
          id: "DOC_02",
          lastEditedAt: "2026-05-26T11:00:00.000Z",
          lastEditedVia: "USER",
          organizationId: "ORG_01",
          revision: 1,
          sourceType: "PASTE_MARKDOWN",
          spaceId: "SPC_01",
          status: "ACTIVE",
          title: "Retro",
          updatedAt: "2026-05-26T11:00:00.000Z",
        },
      ],
      total: 2,
    });

    renderDocumentsPage();

    await waitFor(() =>
      expect(screen.getByTestId("documents-list")).toBeVisible(),
    );

    const links = screen.getAllByTestId("documents-list-item-link");
    expect(links[0]).toHaveAttribute("href", "/documents/DOC_01");
    expect(links[1]).toHaveAttribute("href", "/documents/DOC_02");
    expect(screen.getAllByTestId("documents-list-drag-handle")).toHaveLength(2);
    expect(
      screen.queryByTestId("documents-list-select"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "documents.list.dragDocument Launch plan",
      }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "documents.selection.select" }),
    );

    const checkboxes = screen.getAllByTestId("documents-list-select");
    fireEvent.click(checkboxes[0] as HTMLElement);
    fireEvent.click(checkboxes[1] as HTMLElement);

    expect(screen.getByTestId("documents-selection-toolbar")).toHaveTextContent(
      "documents.selection.count 2",
    );
    expect(
      screen.getAllByRole("button", {
        name: "documents.list.dragSelected 2",
      }),
    ).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "documents.selection.done" }),
    );

    expect(
      screen.queryByTestId("documents-list-select"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("documents-selection-toolbar"),
    ).not.toBeInTheDocument();
  });

  it("includes expanded folder documents in selection operations", async () => {
    searchParamsMock.current = new URLSearchParams("directoryView=root");
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 1,
        documentCount: 1,
        id: "FLD_CHILD",
        name: "Planning",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);
    const rootDocument = createDocumentSummary({
      id: "DOC_ROOT",
      title: "Root note",
    });
    const folderDocument = createDocumentSummary({
      folderId: "FLD_CHILD",
      id: "DOC_CHILD",
      title: "Planning note",
    });
    listDocumentsMock.mockImplementation((params: { folderId?: string }) =>
      Promise.resolve(
        params.folderId === "FLD_CHILD"
          ? { items: [folderDocument], total: 1 }
          : { items: [rootDocument], total: 1 },
      ),
    );

    renderDocumentsPage();

    expect(await screen.findByText("Root note")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: "documents.directory.toggleFolder Planning",
      }),
    );

    expect(await screen.findByText("Planning note")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "documents.selection.select" }),
    );

    const checkboxes = screen.getAllByTestId("documents-list-select");
    expect(checkboxes).toHaveLength(2);
    checkboxes.forEach((checkbox) => fireEvent.click(checkbox));

    expect(screen.getByTestId("documents-selection-toolbar")).toHaveTextContent(
      "documents.selection.count 2",
    );
    expect(
      screen.getAllByRole("button", {
        name: "documents.list.dragSelected 2",
      }),
    ).toHaveLength(2);
  });

  it("refreshes expanded folder documents after document realtime invalidation", async () => {
    searchParamsMock.current = new URLSearchParams("directoryView=root");
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 1,
        documentCount: 1,
        id: "FLD_CHILD",
        name: "Planning",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);
    const beforeDocument = createDocumentSummary({
      folderId: "FLD_CHILD",
      id: "DOC_BEFORE",
      title: "Before folder realtime",
    });
    const afterDocument = createDocumentSummary({
      folderId: "FLD_CHILD",
      id: "DOC_AFTER",
      title: "After folder realtime",
    });
    let folderRequestCount = 0;
    let realtimeFolderRequest: ReturnType<
      typeof createDeferred<DocumentListResult>
    > | null = null;
    listDocumentsMock.mockImplementation((params: { folderId?: string }) => {
      if (params.folderId !== "FLD_CHILD") {
        return Promise.resolve({ items: [], total: 0 });
      }
      folderRequestCount += 1;
      if (folderRequestCount === 1) {
        return Promise.resolve({ items: [beforeDocument], total: 1 });
      }
      realtimeFolderRequest = createDeferred<DocumentListResult>();
      return realtimeFolderRequest.promise;
    });

    renderDocumentsPage();

    await screen.findByTestId("documents-resource-tree");
    fireEvent.click(
      screen.getByRole("button", {
        name: "documents.directory.toggleFolder Planning",
      }),
    );
    expect(await screen.findByText("Before folder realtime")).toBeVisible();

    const callback = realtimeCallbacks.get("document-list");
    expect(callback).toBeDefined();

    await act(async () => {
      callback?.({ events: [], mode: "realtime", resyncs: [] });
    });

    expect(realtimeFolderRequest).not.toBeNull();
    expect(screen.getByText("Before folder realtime")).toBeVisible();
    expect(
      screen.queryByText("documents.directory.loadingFolderDocuments"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("After folder realtime")).not.toBeInTheDocument();

    await act(async () => {
      realtimeFolderRequest?.resolve({ items: [afterDocument], total: 1 });
      await realtimeFolderRequest?.promise;
    });

    expect(await screen.findByText("After folder realtime")).toBeVisible();
    await waitFor(() =>
      expect(
        listDocumentsMock.mock.calls.filter(([params]) => {
          return (params as { folderId?: string }).folderId === "FLD_CHILD";
        }),
      ).toHaveLength(2),
    );
  });

  it("refreshes the list after document realtime invalidation", async () => {
    const beforeDocument = createDocumentSummary({
      contentSnippet: "Before realtime",
      id: "DOC_01",
      sourceType: "UPLOAD_MARKDOWN",
      title: "Before realtime",
    });
    const afterDocument = createDocumentSummary({
      contentSnippet: "After realtime",
      id: "DOC_02",
      lastEditedAt: "2026-05-27T12:00:00.000Z",
      lastEditedVia: "MCP_CLIENT",
      revision: 2,
      sourceType: "MCP_CREATED",
      title: "After realtime",
      updatedAt: "2026-05-27T12:00:00.000Z",
    });
    let shouldReturnRealtimeResult = false;
    listDocumentsMock.mockImplementation(() =>
      Promise.resolve({
        items: shouldReturnRealtimeResult ? [afterDocument] : [beforeDocument],
        total: 1,
      }),
    );

    renderDocumentsPage();

    expect((await screen.findAllByText("Before realtime"))[0]).toBeVisible();
    const callsBeforeRealtime = listDocumentsMock.mock.calls.length;
    const callback = realtimeCallbacks.get("document-list");
    expect(callback).toBeDefined();
    shouldReturnRealtimeResult = true;

    await act(async () => {
      callback?.({ events: [], mode: "realtime", resyncs: [] });
    });

    expect((await screen.findAllByText("After realtime"))[0]).toBeVisible();
    expect(listDocumentsMock.mock.calls.length).toBeGreaterThan(
      callsBeforeRealtime,
    );
  });
});
