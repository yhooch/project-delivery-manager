// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, unknown>) =>
      `${namespace ? `${namespace}.` : ""}${key}${
        values?.revision ? ` ${values.revision}` : ""
      }`;
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

const { listDocumentsMock } = vi.hoisted(() => ({
  listDocumentsMock: vi.fn(),
}));
vi.mock("../../lib/document-service", async () => {
  const actual = await vi.importActual<typeof import("../../lib/document-service")>(
    "../../lib/document-service",
  );
  return {
    ...actual,
    importDocxDocument: vi.fn(),
    importMarkdownDocument: vi.fn(),
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

import { DocumentsPage } from "./documents-page";

beforeEach(() => {
  routerPushMock.mockReset();
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
  it("renders the empty state when the space has no documents", async () => {
    listDocumentsMock.mockResolvedValue({ items: [], total: 0 });

    render(<DocumentsPage />);

    expect(await screen.findByTestId("documents-empty-state")).toBeVisible();
    expect(listDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "all",
        page: 1,
        pageSize: 50,
        spaceId: "SPC_01",
      }),
    );
  });

  it("renders document rows with source and linked resource summaries", async () => {
    listDocumentsMock.mockResolvedValue({
      items: [
        {
          contentSnippet: "Launch scope",
          createdAt: "2026-05-27T10:00:00.000Z",
          id: "DOC_01",
          lastEditedAt: "2026-05-27T11:00:00.000Z",
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

    render(<DocumentsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("documents-list")).toBeVisible(),
    );
    expect(screen.getByText("Launch plan")).toBeVisible();
    expect(screen.getByText("REQ-12")).toBeVisible();
    expect(screen.getByText("documents.source.MCP_CREATED")).toBeVisible();
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

    render(<DocumentsPage />);

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
