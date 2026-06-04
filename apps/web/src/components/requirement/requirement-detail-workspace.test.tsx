import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<string, (key: string) => string>(),
}));
const { searchParamsMock } = vi.hoisted(() => ({
  searchParamsMock: { current: new URLSearchParams() },
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string) => (namespace ? `${namespace}.${k}` : k);
      translatorCache.set(key, fn);
    }
    return fn;
  },
  useLocale: () => "zh-CN",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
}));

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
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
  useRouter: () => ({ push: routerPushMock }),
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      user: {
        id: "USER_01",
        name: "Requirement User",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
        status: "ACTIVE",
        username: "requirement",
      },
      spaces: [
        {
          id: "SPC_01",
          organizationId: "ORG_01",
          name: "Space",
          role: "PM",
        },
      ],
    },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const {
  archiveRequirementMock,
  deleteRequirementDraftMock,
  getRequirementMock,
  listRequirementAssignableMembersMock,
  listRequirementVersionsMock,
  updateRequirementMock,
} = vi.hoisted(() => ({
  archiveRequirementMock: vi.fn(),
  deleteRequirementDraftMock: vi.fn(),
  getRequirementMock: vi.fn(),
  listRequirementAssignableMembersMock: vi.fn(),
  listRequirementVersionsMock: vi.fn(),
  updateRequirementMock: vi.fn(),
}));
const realtimeInvalidationHandlers = vi.hoisted(
  () =>
    [] as {
      callback: (context: {
        events: {
          hints?: Record<string, unknown>;
          target: { id: string; type: string };
        }[];
        keys: string[];
        lastEventId: string | null;
        mode: "realtime";
        resyncs: unknown[];
      }) => void | Promise<void>;
      keys: readonly string[];
    }[],
);
vi.mock("../../lib/requirement-service", () => ({
  archiveRequirement: archiveRequirementMock,
  deleteRequirementDraft: deleteRequirementDraftMock,
  getRequirement: getRequirementMock,
  listRequirementAssignableMembers: listRequirementAssignableMembersMock,
  listRequirementVersions: listRequirementVersionsMock,
  updateRequirement: updateRequirementMock,
}));

const { listReferencingDocumentsMock } = vi.hoisted(() => ({
  listReferencingDocumentsMock: vi.fn(),
}));
vi.mock("../../lib/document-service", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/document-service")
  >("../../lib/document-service");

  return {
    ...actual,
    listReferencingDocuments: listReferencingDocumentsMock,
  };
});
vi.mock("../../lib/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/realtime")>();

  return {
    ...actual,
    useRealtimeInvalidation: (
      keys: readonly string[],
      callback: (context: {
        events: {
          hints?: Record<string, unknown>;
          target: { id: string; type: string };
        }[];
        keys: string[];
        lastEventId: string | null;
        mode: "realtime";
        resyncs: unknown[];
      }) => void | Promise<void>,
    ) => {
      realtimeInvalidationHandlers.push({ callback, keys });
    },
  };
});

const editorSlotMock = vi.hoisted(() => vi.fn());
vi.mock("./requirement-content-editor-slot", () => ({
  createContentEditorValue: () => ({
    contentFormat: "TIPTAP_JSON",
    contentJson: { type: "doc", content: [] },
    contentMarkdownCache: "",
    contentText: "",
  }),
  RequirementContentEditorSlot: (props: {
    canUploadImages?: boolean;
    disabled?: boolean;
  }) => {
    editorSlotMock(props);
    return (
      <div
        data-testid="requirement-editor-slot"
        data-can-upload-images={String(props.canUploadImages)}
        data-disabled={String(props.disabled)}
      />
    );
  },
}));

import { RequirementDetailWorkspace } from "./requirement-detail-workspace";
import { ApiClientError } from "../../lib/api-client";

function makeRequirement(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    kind: "REQUIREMENT",
    title: "Permissioned requirement",
    summary: "Summary",
    contentJson: { type: "doc", content: [] },
    contentFormat: "TIPTAP_JSON",
    status: "DRAFT",
    authorId: "USER_01",
    priority: "MEDIUM",
    relatedWorkItems: { taskCount: 0, bugCount: 0, tasks: [], bugs: [] },
    permissions: {
      canEdit: true,
      canComment: true,
      canUploadAttachment: true,
      availableActions: [],
    },
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...overrides,
    tags: [],
  } as import("@project-delivery/shared").Requirement;
}

function localDraftCacheKey() {
  return [
    "requirement",
    "draft",
    "USER_01",
    "ORG_01",
    "SPC_01",
    "01ARZ3NDEKTSV4RRFFQ69G5FA1",
  ].join(":");
}

beforeEach(() => {
  archiveRequirementMock.mockReset();
  deleteRequirementDraftMock.mockReset();
  editorSlotMock.mockClear();
  getRequirementMock.mockReset();
  listRequirementAssignableMembersMock.mockReset();
  listRequirementVersionsMock.mockReset();
  listReferencingDocumentsMock.mockReset();
  updateRequirementMock.mockReset();
  routerPushMock.mockReset();
  realtimeInvalidationHandlers.length = 0;

  deleteRequirementDraftMock.mockResolvedValue({});
  listRequirementVersionsMock.mockResolvedValue({ items: [], total: 0 });
  listRequirementAssignableMembersMock.mockResolvedValue({
    items: [],
    total: 0,
  });
  listReferencingDocumentsMock.mockResolvedValue({ items: [], total: 0 });
  updateRequirementMock.mockResolvedValue(makeRequirement());
  searchParamsMock.current = new URLSearchParams();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

async function dispatchRealtimeInvalidation(
  key: string,
  event: {
    target: { id: string; type: string };
    hints?: Record<string, unknown>;
  },
) {
  const matchingHandlers = realtimeInvalidationHandlers.filter((handler) =>
    handler.keys.includes(key),
  );
  const latestHandler = matchingHandlers.at(-1);

  if (!latestHandler) {
    return;
  }

  await act(async () => {
    await latestHandler.callback({
      events: [event],
      keys: [key],
      lastEventId: "1",
      mode: "realtime",
      resyncs: [],
    });
  });
}

describe("RequirementDetailWorkspace", () => {
  it("shows documents that reference the requirement document", async () => {
    getRequirementMock.mockResolvedValueOnce(makeRequirement());
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
          title: "Requirement reference note",
          updatedAt: "2026-05-28T10:00:00.000Z",
        },
      ],
      total: 1,
    });

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    const references = await screen.findByTestId(
      "referencing-documents-section",
    );
    await within(references).findByText("Requirement reference note");
    expect(listReferencingDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 5,
        spaceId: "SPC_01",
        targetDocumentId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      }),
    );
  });

  it("renders an ACTIVE requirement in view mode by default", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        contentFormat: "MARKDOWN",
        contentJson: undefined,
        contentMarkdown: "# Scope\n\nRead-only requirement body.",
        contentMarkdownCache: undefined,
        contentText: "Scope\n\nRead-only requirement body.",
        status: "ACTIVE",
      }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Permissioned requirement",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("document-markdown-viewer")).toHaveTextContent(
      "Read-only requirement body.",
    );
    expect(
      screen.getByRole("button", { name: "requirements.detail.edit" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("requirements.form.title"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "requirements.form.priority" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "requirements.detail.save" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("requirement-editor-slot")).toBeNull();
  });

  it("enters edit mode when the edit action is clicked", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        status: "ACTIVE",
      }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "requirements.detail.edit",
      }),
    );

    expect(
      await screen.findByDisplayValue("Permissioned requirement"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "requirements.form.priority" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("requirement-editor-slot")).toHaveAttribute(
      "data-disabled",
      "false",
    );
  });

  it("enters edit mode from the URL and cancels back to server values", async () => {
    searchParamsMock.current = new URLSearchParams("mode=edit");
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        status: "ACTIVE",
      }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    const titleInput = await screen.findByDisplayValue(
      "Permissioned requirement",
    );
    fireEvent.change(titleInput, {
      target: { value: "Unsaved title" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.detail.cancelEdit",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Permissioned requirement" }),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Unsaved title")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "requirements.detail.edit" }),
    ).toBeInTheDocument();
  });

  it("does not let a writer role override explicit canEdit=false", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        permissions: {
          canEdit: false,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Permissioned requirement",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "requirements.detail.edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "requirements.detail.save" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("requirement-editor-slot")).toBeNull();

    expect(updateRequirementMock).not.toHaveBeenCalled();
  });

  it("disables editing when the backend omits requirement permissions", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({ permissions: undefined }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Permissioned requirement",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "requirements.detail.edit" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("requirement-editor-slot")).toBeNull();

    expect(updateRequirementMock).not.toHaveBeenCalled();
  });

  it("keeps dirty form input when realtime refreshes the requirement", async () => {
    getRequirementMock.mockResolvedValue(
      makeRequirement({ title: "Remote title" }),
    );
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({ title: "Initial title" }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    const titleInput = await screen.findByDisplayValue("Initial title");
    fireEvent.change(titleInput, { target: { value: "Local draft title" } });

    await dispatchRealtimeInvalidation("requirement-detail", {
      target: { id: "01ARZ3NDEKTSV4RRFFQ69G5FA1", type: "DOCUMENT" },
    });

    await waitFor(() =>
      expect(getRequirementMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByDisplayValue("Local draft title")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Remote title")).not.toBeInTheDocument();
  });

  it("updates priority through the themed property dropdown", async () => {
    getRequirementMock.mockResolvedValueOnce(makeRequirement());
    updateRequirementMock.mockResolvedValueOnce(
      makeRequirement({ priority: "URGENT" }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByDisplayValue("Permissioned requirement"),
    ).toBeInTheDocument();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "requirements.form.priority" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /requirements\.priority\.URGENT/u,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    );

    await waitFor(() =>
      expect(updateRequirementMock).toHaveBeenCalledWith(
        {
          organizationId: "ORG_01",
          requirementId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          spaceId: "SPC_01",
        },
        expect.objectContaining({ priority: "URGENT" }),
      ),
    );
  });

  it("sends null when the requirement version is cleared", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    getRequirementMock.mockResolvedValueOnce(makeRequirement({ versionId }));
    listRequirementVersionsMock.mockResolvedValueOnce({
      items: [{ id: versionId, name: "Release 1" }],
      total: 1,
    });

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(await screen.findByText("Release 1")).toBeInTheDocument();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "requirements.form.version" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /requirements\.form\.noVersion/u,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    );

    await waitFor(() =>
      expect(updateRequirementMock).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ versionId: null }),
      ),
    );
  });

  it("saves Markdown requirements without sending Tiptap JSON fields", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        contentFormat: "MARKDOWN",
        contentJson: undefined,
        contentMarkdown: "# Scope\n\nShip Markdown.",
        contentMarkdownCache: undefined,
        contentText: "Scope\n\nShip Markdown.",
      }),
    );
    updateRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        contentFormat: "MARKDOWN",
        contentJson: undefined,
        contentMarkdown: "# Scope\n\nShip Markdown.",
        contentMarkdownCache: undefined,
        contentText: "Scope\n\nShip Markdown.",
      }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByDisplayValue("Permissioned requirement"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    );

    await waitFor(() =>
      expect(updateRequirementMock).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          contentFormat: "MARKDOWN",
          contentMarkdown: "# Scope\n\nShip Markdown.",
          contentText: "Scope\n\nShip Markdown.",
        }),
      ),
    );
    const body = updateRequirementMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty("contentJson");
    expect(body).not.toHaveProperty("contentMarkdownCache");
  });

  it("reflects selected version and owner before saving", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const ownerId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
    getRequirementMock.mockResolvedValueOnce(makeRequirement());
    listRequirementVersionsMock.mockResolvedValueOnce({
      items: [{ id: versionId, name: "Release 1" }],
      total: 1,
    });
    listRequirementAssignableMembersMock.mockResolvedValueOnce({
      items: [
        {
          id: "SPACE_MEMBER_01",
          organizationId: "ORG_01",
          role: "PM",
          spaceId: "SPC_01",
          userId: ownerId,
          user: {
            id: ownerId,
            name: "Owner One",
            username: "owner1",
          },
        },
      ],
      total: 1,
    });

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByDisplayValue("Permissioned requirement"),
    ).toBeInTheDocument();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "requirements.form.version" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Release 1/u }),
    );
    expect(
      screen.getByRole("button", { name: "requirements.form.version" }),
    ).toHaveTextContent("Release 1");

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "requirements.form.owner" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Owner One \(owner1\)/u }),
    );
    expect(
      screen.getByRole("button", { name: "requirements.form.owner" }),
    ).toHaveTextContent("Owner One (owner1)");
  });

  it("confirms and retries requirement save when version cascade is required", async () => {
    const cascadeError = new ApiClientError(
      {
        code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
        details: {
          impact: {
            intakeItemCount: 1,
            intakeItemIds: ["REQ_CHILD"],
          },
          targetId: "REQ_PARENT",
          targetType: "REQUIREMENT",
        },
        message: "版本变更需要同步下游对象",
        requestId: "REQ_TRACE",
      },
      new Response(null, { status: 409, statusText: "Conflict" }),
    );
    getRequirementMock.mockResolvedValueOnce(makeRequirement());
    updateRequirementMock
      .mockRejectedValueOnce(cascadeError)
      .mockResolvedValueOnce(
        makeRequirement({ title: "Permissioned requirement" }),
      );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByDisplayValue("Permissioned requirement"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    );

    expect(
      await screen.findByTestId("trace-version-cascade-confirm-dialog"),
    ).toHaveTextContent("errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE");
    expect(
      screen.getByTestId("trace-version-cascade-confirm-dialog"),
    ).not.toHaveTextContent("版本变更需要同步下游对象");
    expect(
      screen.getByTestId("trace-version-cascade-confirm-dialog"),
    ).toHaveTextContent("traceVersionCascadeConfirm.scopeTitle");
    expect(
      screen.getByTestId("trace-version-cascade-confirm-dialog"),
    ).toHaveTextContent("REQ_CHILD");
    await waitFor(() => expect(updateRequirementMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("trace-version-cascade-confirm"));

    await waitFor(() => expect(updateRequirementMock).toHaveBeenCalledTimes(2));
    expect(updateRequirementMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ cascadeVersionChange: true }),
    );
  });

  it("restores unsaved draft fields from the browser cache after returning to the draft", async () => {
    const emptyDraft = makeRequirement({
      contentJson: {},
      contentMarkdownCache: "",
      contentText: "",
      summary: undefined,
      title: "",
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    getRequirementMock.mockResolvedValue(emptyDraft);

    const { unmount } = render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    const title = await screen.findByLabelText("requirements.form.title");
    fireEvent.change(title, {
      target: { value: "本机未保存标题" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("requirements.detail.summaryPlaceholder"),
      {
        target: { value: "本机未保存摘要" },
      },
    );
    fireEvent(window, new Event("pagehide"));

    await waitFor(() =>
      expect(window.localStorage.getItem(localDraftCacheKey())).toContain(
        "本机未保存标题",
      ),
    );

    unmount();
    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByDisplayValue("本机未保存标题"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("本机未保存摘要")).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-local-draft-cache-restored"),
    ).toHaveTextContent("requirements.detail.localDraftCache.restored");
  });

  it("clears the browser draft cache after saving the requirement", async () => {
    const emptyDraft = makeRequirement({
      contentJson: {},
      contentMarkdownCache: "",
      contentText: "",
      summary: undefined,
      title: "",
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    window.localStorage.setItem(
      localDraftCacheKey(),
      JSON.stringify({
        cachedAt: "2026-05-12T00:01:00.000Z",
        form: {
          content: {
            contentJson: { type: "doc", content: [] },
            contentMarkdownCache: "",
            contentText: "",
          },
          ownerId: "",
          priority: "",
          summary: "",
          title: "待保存本机缓存",
          versionId: "",
        },
        requirementUpdatedAt: "2026-05-12T00:00:00.000Z",
        version: 1,
      }),
    );
    getRequirementMock.mockResolvedValueOnce(emptyDraft);

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByDisplayValue("待保存本机缓存"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    );

    await waitFor(() => expect(updateRequirementMock).toHaveBeenCalled());
    expect(window.localStorage.getItem(localDraftCacheKey())).toBeNull();
  });

  it("lets the owner discard a non-empty draft through the safe delete action", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        attachments: [
          {
            fileKey: "attachments/document/ATT_01.png",
            fileName: "draft-image.png",
            id: "ATT_01",
            mimeType: "image/png",
            size: 1024,
          },
        ],
        title: "已有内容草稿",
        summary: "已有摘要",
        contentJson: {
          content: [{ text: "已有正文", type: "text" }],
          type: "doc",
        },
        contentText: "已有正文",
        status: "DRAFT",
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm");

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "requirements.detail.discardDraft",
      }),
    );
    expect(
      await screen.findByTestId("requirement-discard-draft-dialog"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-discard-draft-dialog"),
    ).toHaveTextContent("requirements.detail.discardDraftConfirm");
    fireEvent.click(screen.getByTestId("requirement-discard-draft-confirm"));

    await waitFor(() =>
      expect(deleteRequirementDraftMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        requirementId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        spaceId: "SPC_01",
      }),
    );
    expect(routerPushMock).toHaveBeenCalledWith("/requirements");
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("keeps an empty draft and normalizes localized list navigation", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        title: "",
        summary: undefined,
        contentJson: {},
        contentText: "",
        contentMarkdownCache: "",
        status: "DRAFT",
      }),
    );

    render(
      <>
        <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />
        <a data-testid="leave-requirement-detail" href="/zh-CN/requirements">
          leave
        </a>
      </>,
    );

    await screen.findByRole("button", {
      name: "requirements.detail.discardDraft",
    });
    fireEvent.click(screen.getByTestId("leave-requirement-detail"));

    expect(
      await screen.findByTestId("requirement-empty-draft-leave-dialog"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("requirement-empty-draft-keep"));

    expect(deleteRequirementDraftMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith("/requirements");
  });

  it("deletes an empty draft when leaving and choosing delete", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        title: "",
        summary: undefined,
        contentJson: {},
        contentText: "",
        contentMarkdownCache: "",
        status: "DRAFT",
      }),
    );

    render(
      <>
        <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />
        <a data-testid="leave-requirement-detail" href="/zh-CN/requirements">
          leave
        </a>
      </>,
    );

    await screen.findByRole("button", {
      name: "requirements.detail.discardDraft",
    });
    fireEvent.click(screen.getByTestId("leave-requirement-detail"));
    fireEvent.click(
      await screen.findByTestId("requirement-empty-draft-delete"),
    );

    await waitFor(() =>
      expect(deleteRequirementDraftMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        requirementId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        spaceId: "SPC_01",
      }),
    );
    expect(routerPushMock).toHaveBeenCalledWith("/requirements");
  });
});
