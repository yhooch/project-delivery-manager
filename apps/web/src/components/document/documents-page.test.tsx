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

const { listDocumentFoldersMock, listDocumentsMock } = vi.hoisted(() => ({
  listDocumentFoldersMock: vi.fn(),
  listDocumentsMock: vi.fn(),
}));
vi.mock("../../lib/document-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/document-service")
  >("../../lib/document-service");
  return {
    ...actual,
    importDocxDocument: vi.fn(),
    importMarkdownDocument: vi.fn(),
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
import { DocumentsPage } from "./documents-page";

type CreateActions = {
  openImport: () => void;
  openPaste: () => void;
};

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

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  routerPushMock.mockReset();
  routerReplaceMock.mockReset();
  searchParamsMock.current = new URLSearchParams();
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
        includeDescendants: true,
        spaceId: "SPC_01",
      }),
    );
  });

  it("renders direct child folders above document rows for the selected folder", async () => {
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

    const childFolders = await screen.findByTestId("documents-child-folders");
    const list = await screen.findByTestId("documents-list");

    expect(within(childFolders).getByText("Planning")).toBeVisible();
    expect(within(childFolders).queryByText("Roadmap")).not.toBeInTheDocument();
    expect(
      (childFolders.compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    ).toBe(true);
    expect(screen.getAllByTestId("documents-list-item")).toHaveLength(1);
  });

  it("navigates to a child folder while preserving includeDescendants", async () => {
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: "documents.directory.openFolder Planning",
      }),
    );

    expect(routerPushMock).toHaveBeenCalledWith(
      "/documents?directoryView=folder&folderId=FLD_CHILD&includeDescendants=true",
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

    expect(await screen.findByTestId("documents-child-folders")).toBeVisible();
    expect(
      screen.queryByTestId("documents-empty-state"),
    ).not.toBeInTheDocument();
  });

  it("hides child folders while searching documents", async () => {
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

    expect(await screen.findByTestId("documents-child-folders")).toBeVisible();

    fireEvent.change(screen.getByTestId("documents-search-input"), {
      target: { value: "plan" },
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("documents-child-folders"),
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

  it("refreshes the list after document realtime invalidation", async () => {
    listDocumentsMock
      .mockResolvedValueOnce({
        items: [
          {
            contentSnippet: "Before realtime",
            createdAt: "2026-05-27T10:00:00.000Z",
            id: "DOC_01",
            lastEditedAt: "2026-05-27T11:00:00.000Z",
            lastEditedVia: "USER",
            organizationId: "ORG_01",
            revision: 1,
            sourceType: "UPLOAD_MARKDOWN",
            spaceId: "SPC_01",
            status: "ACTIVE",
            title: "Before realtime",
            updatedAt: "2026-05-27T11:00:00.000Z",
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            contentSnippet: "After realtime",
            createdAt: "2026-05-27T10:00:00.000Z",
            id: "DOC_02",
            lastEditedAt: "2026-05-27T12:00:00.000Z",
            lastEditedVia: "MCP_CLIENT",
            organizationId: "ORG_01",
            revision: 2,
            sourceType: "MCP_CREATED",
            spaceId: "SPC_01",
            status: "ACTIVE",
            title: "After realtime",
            updatedAt: "2026-05-27T12:00:00.000Z",
          },
        ],
        total: 1,
      });

    renderDocumentsPage();

    expect((await screen.findAllByText("Before realtime"))[0]).toBeVisible();
    const callback = realtimeCallbacks.get("document-list");
    expect(callback).toBeDefined();

    await act(async () => {
      callback?.({ events: [], mode: "realtime", resyncs: [] });
    });

    expect((await screen.findAllByText("After realtime"))[0]).toBeVisible();
    expect(listDocumentsMock).toHaveBeenCalledTimes(2);
  });
});
