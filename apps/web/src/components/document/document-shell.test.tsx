// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameMock, routerPushMock, searchParamsMock } = vi.hoisted(() => ({
  pathnameMock: { current: "/documents" },
  routerPushMock: vi.fn(),
  searchParamsMock: { current: new URLSearchParams() },
}));
const { dndHandlersMock } = vi.hoisted(() => ({
  dndHandlersMock: {
    current: null as null | {
      onDragEnd?: (event: unknown) => void;
      onDragStart?: (event: unknown) => void;
    },
  },
}));
const {
  moveDocumentFolderMock,
  moveDocumentsToFolderMock,
  reorderDocumentFoldersMock,
} = vi.hoisted(() => ({
  moveDocumentFolderMock: vi.fn(),
  moveDocumentsToFolderMock: vi.fn(),
  reorderDocumentFoldersMock: vi.fn(),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
    onDragStart,
  }: {
    children: ReactNode;
    onDragEnd?: (event: unknown) => void;
    onDragStart?: (event: unknown) => void;
  }) => {
    dndHandlersMock.current = { onDragEnd, onDragStart };
    return <div data-testid="dnd-context">{children}</div>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => (
    <div data-testid="drag-overlay">{children}</div>
  ),
  PointerSensor: vi.fn(),
  pointerWithin: vi.fn(),
  useSensor: vi.fn((sensor, options) => ({ options, sensor })),
  useSensors: vi.fn((...sensors) => sensors),
}));

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

const sessionMock = vi.hoisted(() => ({
  current: {
    currentOrganization: { id: "ORG_01", name: "Org A" },
    currentSpace: { id: "SPC_01", name: "Space A" },
    initializeSession: vi.fn(),
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    sessionErrorKey: null,
    status: "authenticated",
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

vi.mock("../../lib/realtime", () => ({
  RealtimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../../lib/document-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/document-service")
  >("../../lib/document-service");
  return {
    ...actual,
    moveDocumentFolder: moveDocumentFolderMock,
    moveDocumentsToFolder: moveDocumentsToFolderMock,
    reorderDocumentFolders: reorderDocumentFoldersMock,
  };
});

vi.mock("../shell/command-palette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
  useCommandPaletteShortcut: vi.fn(),
}));

vi.mock("../ui/sheet", () => ({
  Sheet: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="document-directory-sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("./document-directory-rail", () => ({
  DocumentDirectoryRail: ({ mobile }: { mobile?: boolean }) => (
    <div
      data-testid={
        mobile ? "document-directory-rail-mobile" : "document-directory-rail"
      }
    />
  ),
}));

vi.mock("./documents-page", () => ({
  DocumentImportDialog: ({ open }: { open: boolean }) => (
    <div data-open={String(open)} data-testid="document-import-dialog" />
  ),
  DocumentPasteDialog: ({ open }: { open: boolean }) => (
    <div data-open={String(open)} data-testid="document-paste-dialog" />
  ),
}));

import { useDocumentCreate } from "./document-create-context";
import { DocumentShell } from "./document-shell";

function CreateActionProbe() {
  const { openImport, openPaste } = useDocumentCreate();

  return (
    <div>
      <button type="button" data-testid="probe-open-import" onClick={openImport}>
        Open import
      </button>
      <button type="button" data-testid="probe-open-paste" onClick={openPaste}>
        Open paste
      </button>
    </div>
  );
}

function renderShell(
  children: ReactNode = <div data-testid="document-shell-content" />,
) {
  return render(
    <DocumentShell>{children}</DocumentShell>,
  );
}

beforeEach(() => {
  pathnameMock.current = "/documents";
  searchParamsMock.current = new URLSearchParams();
  routerPushMock.mockReset();
  dndHandlersMock.current = null;
  moveDocumentFolderMock.mockReset();
  moveDocumentsToFolderMock.mockReset();
  reorderDocumentFoldersMock.mockReset();
  moveDocumentFolderMock.mockResolvedValue(undefined);
  moveDocumentsToFolderMock.mockResolvedValue([]);
  reorderDocumentFoldersMock.mockResolvedValue(undefined);
  window.localStorage.clear();
});

describe("DocumentShell", () => {
  it("shows the document directory on the document list route", () => {
    renderShell();

    expect(screen.getByTestId("document-directory-rail")).toBeVisible();
    expect(screen.getByLabelText("shell.documents.directory")).toBeVisible();
    expect(screen.getByTestId("document-shell-content")).toBeVisible();
  });

  it("hides the document directory on document detail routes", () => {
    pathnameMock.current = "/documents/DOC_01";

    renderShell();

    expect(
      screen.queryByTestId("document-directory-rail"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("shell.documents.directory"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("document-shell-content")).toBeVisible();
  });

  it("keeps creation dialogs available through context without header buttons", () => {
    renderShell(<CreateActionProbe />);

    const header = screen.getByRole("banner");
    expect(
      within(header).queryByTestId("documents-paste-button"),
    ).not.toBeInTheDocument();
    expect(
      within(header).queryByTestId("documents-import-button"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("document-import-dialog")).toHaveAttribute(
      "data-open",
      "false",
    );
    expect(screen.getByTestId("document-paste-dialog")).toHaveAttribute(
      "data-open",
      "false",
    );

    fireEvent.click(screen.getByTestId("probe-open-import"));
    expect(screen.getByTestId("document-import-dialog")).toHaveAttribute(
      "data-open",
      "true",
    );

    fireEvent.click(screen.getByTestId("probe-open-paste"));
    expect(screen.getByTestId("document-paste-dialog")).toHaveAttribute(
      "data-open",
      "true",
    );
  });

  it("moves dragged documents to the root directory", async () => {
    renderShell();

    dndHandlersMock.current?.onDragEnd?.({
      active: {
        data: {
          current: {
            documents: [
              {
                folderId: "FLD_01",
                id: "DOC_01",
                revision: 1,
                title: "Launch plan",
              },
            ],
            type: "document",
          },
        },
      },
      over: {
        data: {
          current: {
            siblingIds: [],
            type: "document-folder-root",
          },
        },
      },
    });

    await waitFor(() =>
      expect(moveDocumentsToFolderMock).toHaveBeenCalledWith(
        expect.objectContaining({
          documentIds: ["DOC_01"],
          folderId: null,
          spaceId: "SPC_01",
        }),
      ),
    );
  });
});
