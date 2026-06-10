// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameMock, routerPushMock, searchParamsMock } = vi.hoisted(() => ({
  pathnameMock: { current: "/documents" },
  routerPushMock: vi.fn(),
  searchParamsMock: { current: new URLSearchParams() },
}));

vi.mock("../../i18n/routing", () => ({
  usePathname: () => pathnameMock.current,
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
}));

vi.mock("next-intl", () => ({
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

const { createDocumentFolderMock, listDocumentFoldersMock } = vi.hoisted(
  () => ({
    createDocumentFolderMock: vi.fn(),
    listDocumentFoldersMock: vi.fn(),
  }),
);

vi.mock("../../lib/document-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/document-service")
  >("../../lib/document-service");
  return {
    ...actual,
    createDocumentFolder: createDocumentFolderMock,
    listDocumentFolders: listDocumentFoldersMock,
  };
});

vi.mock("../../lib/realtime", () => ({
  useRealtimeInvalidation: vi.fn(),
}));

import { DocumentDirectoryProvider } from "./document-directory-context";
import { DocumentDirectoryRail } from "./document-directory-rail";

function renderRail(children?: ReactNode) {
  return render(
    <DocumentDirectoryProvider
      value={{
        activeDocumentFolderId: "FLD_01",
        setActiveDocumentFolderId: vi.fn(),
      }}
    >
      {children ?? (
        <DocumentDirectoryRail organizationId="ORG_01" spaceId="SPC_01" />
      )}
    </DocumentDirectoryProvider>,
  );
}

beforeEach(() => {
  routerPushMock.mockReset();
  createDocumentFolderMock.mockReset();
  listDocumentFoldersMock.mockReset();
  pathnameMock.current = "/documents";
  searchParamsMock.current = new URLSearchParams();
  listDocumentFoldersMock.mockResolvedValue([
    {
      depth: 0,
      descendantDocumentCount: 2,
      documentCount: 1,
      id: "FLD_01",
      name: "Plans",
      parentId: null,
      sortOrder: 0,
      spaceId: "SPC_01",
      version: 1,
    },
  ]);
  createDocumentFolderMock.mockResolvedValue({
    depth: 0,
    descendantDocumentCount: 0,
    documentCount: 0,
    id: "FLD_02",
    name: "Notes",
    parentId: null,
    sortOrder: 1,
    spaceId: "SPC_01",
    version: 1,
  });
});

describe("DocumentDirectoryRail", () => {
  it("keeps the inline directory rail desktop-only while preserving the mobile sheet rail", async () => {
    const { rerender } = renderRail();

    const desktopRail = await screen.findByTestId("document-directory-rail");
    expect(desktopRail).toHaveClass("hidden", "lg:flex", "lg:w-72");

    rerender(
      <DocumentDirectoryProvider
        value={{
          activeDocumentFolderId: "FLD_01",
          setActiveDocumentFolderId: vi.fn(),
        }}
      >
        <DocumentDirectoryRail
          mobile
          organizationId="ORG_01"
          spaceId="SPC_01"
        />
      </DocumentDirectoryProvider>,
    );

    expect(screen.getByTestId("document-directory-rail")).toHaveClass(
      "flex",
      "w-full",
    );
    expect(screen.getByTestId("document-directory-rail")).not.toHaveClass(
      "hidden",
    );
  });

  it("renders virtual views and navigates to a selected folder", async () => {
    renderRail();

    expect(
      await screen.findByText("documents.directory.views.all"),
    ).toBeVisible();
    expect(
      screen.getByText("documents.directory.views.createdByMe"),
    ).toBeVisible();
    expect(
      screen.getByText("documents.directory.views.archived"),
    ).toBeVisible();
    expect(
      screen.queryByText("documents.directory.views.recent"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("documents.directory.views.unfiled"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("documents.directory.views.mcpCreated"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("documents.directory.views.recentMcpEdited"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("documents.directory.views.all").closest("button"),
    ).not.toHaveAttribute("data-document-drop-target");
    expect(
      await screen.findByText("documents.directory.rootFolder"),
    ).toBeVisible();

    expect(
      Array.from(
        document.querySelectorAll(
          'nav[aria-label="documents.directory.viewsLabel"] button',
        ),
      ).map((button) => button.textContent),
    ).toEqual([
      "documents.directory.views.all",
      "documents.directory.views.createdByMe",
      "documents.directory.views.archived",
    ]);

    fireEvent.click(screen.getByText("documents.directory.views.createdByMe"));
    expect(routerPushMock).toHaveBeenCalledWith(
      "/documents?directoryView=createdByMe",
    );

    fireEvent.click(screen.getByText("documents.directory.rootFolder"));
    expect(routerPushMock).toHaveBeenCalledWith(
      "/documents?directoryView=root",
    );

    fireEvent.click(await screen.findByText("Plans"));

    expect(routerPushMock).toHaveBeenCalledWith(
      "/documents?directoryView=folder&folderId=FLD_01",
    );
  });

  it("renders folder drag handles and the root directory node", async () => {
    renderRail();

    expect(await screen.findByText("Plans")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "documents.directory.drag.folderHandle Plans",
      }),
    ).toBeVisible();
    expect(
      screen.getByTestId("document-folder-root-drop-target"),
    ).toBeVisible();
    expect(screen.getByTestId("document-folder-root-node")).toHaveTextContent(
      "documents.directory.rootFolder",
    );
    expect(
      screen.getByTestId("document-folder-root-drop-target"),
    ).toHaveAttribute("data-document-folder-root-drop-target", "true");
  });

  it("marks the root directory node as active from the URL", async () => {
    searchParamsMock.current = new URLSearchParams("directoryView=root");

    renderRail();

    expect(
      await screen.findByTestId("document-folder-root-node"),
    ).toHaveAttribute("aria-current", "page");
  });

  it("keeps nested folder rows aligned when controls and counts are optional", async () => {
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 1,
        documentCount: 0,
        id: "FLD_ROOT",
        name: "Library",
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
        name: "Inbox",
        parentId: "FLD_ROOT",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);

    renderRail();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "documents.directory.toggleFolder Library",
      }),
    );

    expect(await screen.findByText("Inbox")).toBeVisible();

    const rowFrames = screen.getAllByTestId("document-folder-row-frame");
    expect(rowFrames).toHaveLength(2);
    expect(rowFrames[0]).toHaveStyle({ paddingLeft: "0px" });
    expect(rowFrames[1]).toHaveStyle({ paddingLeft: "12px" });

    screen.getAllByTestId("document-folder-row").forEach((row) => {
      expect(row).toHaveClass(
        "grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_1.5rem]",
      );
    });
    expect(screen.getByTestId("document-folder-toggle-spacer")).toBeVisible();
    expect(screen.getByTestId("document-folder-count-spacer")).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "documents.directory.toggleFolder Inbox",
      }),
    ).not.toBeInTheDocument();
  });

  it("collapses folder nodes with children by default", async () => {
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 2,
        documentCount: 1,
        id: "FLD_01",
        name: "Plans",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 1,
        documentCount: 1,
        id: "FLD_02",
        name: "Roadmap",
        parentId: "FLD_01",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);

    renderRail();

    expect(await screen.findByText("Plans")).toBeVisible();
    await waitFor(() => expect(screen.queryByText("Roadmap")).toBeNull());
    expect(
      screen.getByRole("button", {
        name: "documents.directory.toggleFolder Plans",
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("expands the selected folder ancestor chain on initial load", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_02",
    );
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 2,
        documentCount: 1,
        id: "FLD_01",
        name: "Plans",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 1,
        documentCount: 1,
        id: "FLD_02",
        name: "Roadmap",
        parentId: "FLD_01",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);

    renderRail();

    expect(await screen.findByText("Roadmap")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "documents.directory.toggleFolder Plans",
      }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("expands the active document folder ancestor chain on detail routes", async () => {
    pathnameMock.current = "/documents/DOC_01";
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 2,
        documentCount: 1,
        id: "FLD_ROOT",
        name: "Library",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 1,
        documentCount: 1,
        id: "FLD_01",
        name: "Plans",
        parentId: "FLD_ROOT",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);

    renderRail();

    expect(await screen.findByText("Plans")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "documents.directory.toggleFolder Library",
      }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("expands and collapses all folders from the folder header", async () => {
    searchParamsMock.current = new URLSearchParams(
      "directoryView=folder&folderId=FLD_02",
    );
    listDocumentFoldersMock.mockResolvedValue([
      {
        depth: 0,
        descendantDocumentCount: 3,
        documentCount: 0,
        id: "FLD_01",
        name: "Plans",
        parentId: null,
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 1,
        documentCount: 1,
        id: "FLD_02",
        name: "Roadmap",
        parentId: "FLD_01",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 1,
        descendantDocumentCount: 1,
        documentCount: 0,
        id: "FLD_03",
        name: "Archive",
        parentId: "FLD_01",
        sortOrder: 1,
        spaceId: "SPC_01",
        version: 1,
      },
      {
        depth: 2,
        descendantDocumentCount: 1,
        documentCount: 1,
        id: "FLD_04",
        name: "Archive Child",
        parentId: "FLD_03",
        sortOrder: 0,
        spaceId: "SPC_01",
        version: 1,
      },
    ]);

    renderRail();

    expect(await screen.findByText("Roadmap")).toBeVisible();
    expect(screen.getByText("Archive")).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByText("Archive Child")).not.toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "documents.directory.expandAllFolders",
      }),
    );

    expect(await screen.findByText("Archive Child")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: "documents.directory.collapseAllFolders",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Archive Child")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Roadmap")).toBeVisible();
  });

  it("creates a root folder from the compact directory dialog", async () => {
    renderRail();

    fireEvent.click(
      await screen.findByLabelText("documents.directory.createRoot"),
    );
    fireEvent.change(screen.getByTestId("document-folder-name-input"), {
      target: { value: "Notes" },
    });
    fireEvent.click(screen.getByTestId("document-folder-operation-submit"));

    await waitFor(() =>
      expect(createDocumentFolderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Notes",
          parentId: null,
          spaceId: "SPC_01",
        }),
      ),
    );
  });
});
