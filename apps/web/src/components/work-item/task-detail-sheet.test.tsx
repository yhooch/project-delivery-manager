import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Helper: switch Radix tab. fireEvent.click works in jsdom for Radix tabs
// only if pointer-event listeners line up; userEvent.click is more reliable.
async function activateTab(name: RegExp) {
  const tab = screen.getByRole("tab", { name });
  await userEvent.click(tab);
}

// Stable translator: same memoized fn per namespace across renders.
const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<string, (key: string) => string>(),
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

vi.mock("../../i18n/routing", () => ({
  routing: { defaultLocale: "zh-CN", locales: ["zh-CN", "en-US"] },
  Link: ({ children }: { children: React.ReactNode }) => children,
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Session provider — provide enough context for spaceId / organizationId
// fallback paths.
const sessionMock = vi.hoisted(() => ({
  current: {
    session: { user: { id: "USR_01", name: "Tester" } },
    currentOrganization: { id: "ORG_01", name: "Org" },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space" },
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

// Lookups
const memberMap = new Map<
  string,
  { user: { name: string; avatar?: string } }
>();
const versionMap = new Map<string, { name: string }>();
vi.mock("../../lib/v2/lookups", () => ({
  useSpaceMembers: () => ({
    members: [],
    loading: false,
    error: null,
    getMember: (id: string) => memberMap.get(id),
  }),
  useVersions: () => ({
    versions: [],
    loading: false,
    error: null,
    getVersion: (id: string) => versionMap.get(id),
  }),
}));

// Service mocks (hoisted so factories can wire them).
const {
  getBugMock,
  getWorkItemMock,
  executeActionMock,
  listCommentsMock,
  createCommentMock,
  getAttachmentDownloadUrlMock,
  listAttachmentsMock,
  uploadAttachmentMock,
  listTimelineMock,
} = vi.hoisted(() => ({
  getBugMock: vi.fn(),
  getWorkItemMock: vi.fn(),
  executeActionMock: vi.fn(),
  listCommentsMock: vi.fn(),
  createCommentMock: vi.fn(),
  getAttachmentDownloadUrlMock: vi.fn(),
  listAttachmentsMock: vi.fn(),
  uploadAttachmentMock: vi.fn(),
  listTimelineMock: vi.fn(),
}));

vi.mock("../../lib/work-item-service", () => ({
  getWorkItem: getWorkItemMock,
  listWorkItems: vi.fn(),
}));
vi.mock("../../lib/bug-service", () => ({
  getBug: getBugMock,
}));
vi.mock("../../lib/action-service", () => ({
  executeAction: executeActionMock,
}));
vi.mock("../../lib/comment-service", () => ({
  listComments: listCommentsMock,
  createComment: createCommentMock,
}));
vi.mock("../../lib/attachment-service", () => {
  // Keep the AttachmentUploadError stub minimal but functional.
  class AttachmentUploadError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.code = code;
    }
  }
  return {
    AttachmentUploadError,
    getAttachmentDownloadUrl: getAttachmentDownloadUrlMock,
    listAttachments: listAttachmentsMock,
    uploadAttachment: uploadAttachmentMock,
  };
});
vi.mock("../../lib/timeline-service", () => ({
  listTimeline: listTimelineMock,
}));

import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { TaskDetailSheet } from "./task-detail-sheet";

// -----------------------------------------------------------------------------

function makeViewModel(
  overrides: Partial<WorkItemViewModel> = {},
): WorkItemViewModel {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    code: "TASK-AAA001",
    type: "TASK",
    title: "Detail test task",
    statusCategory: "IN_PROGRESS",
    statusLabel: "进行中",
    priority: "MEDIUM",
    assignee: { name: "01ARZ3NDEKTSV4RRFFQ69G5FAS", initial: "0" },
    versionName: "v1",
    isOverdue: false,
    isBlocked: false,
    ...overrides,
  };
}

function makeAction(
  overrides: Record<string, unknown> = {},
): import("@project-delivery/shared").WorkflowActionSummary {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAC1",
    code: "submit",
    name: "Submit for review",
    fromStateId: "01ARZ3NDEKTSV4RRFFQ69G5FS1",
    toStateId: "01ARZ3NDEKTSV4RRFFQ69G5FS2",
    allowedSpaceRoles: [],
    actorRelations: [],
    requiresComment: false,
    formFields: [],
    order: 1,
    ...overrides,
  } as import("@project-delivery/shared").WorkflowActionSummary;
}

function makeDetailResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FS1",
    statusCategory: "IN_PROGRESS",
    title: "Detail test task",
    priority: "MEDIUM",
    type: "TASK",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    lastStatusChangedAt: "2026-05-12T00:00:00.000Z",
    permissions: {
      canEdit: true,
      canComment: true,
      canUploadAttachment: true,
      availableActions: [],
    },
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolveValue) => {
    resolve = resolveValue;
  });

  return { promise, resolve };
}

function makeBugResponse(overrides: Record<string, unknown> = {}) {
  const { bugDetail: bugDetailOverride, ...baseOverrides } = overrides;
  return {
    ...makeDetailResponse({
      type: "BUG",
      ...baseOverrides,
    }),
    bugDetail: {
      actualResult: "Actual",
      expectedResult: "Expected",
      severity: "MAJOR",
      stepsToReproduce: "Steps",
      workItemId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      ...(bugDetailOverride as Record<string, unknown> | undefined),
    },
  };
}

beforeEach(() => {
  memberMap.clear();
  versionMap.clear();
  getBugMock.mockReset();
  getWorkItemMock.mockReset();
  executeActionMock.mockReset();
  listCommentsMock.mockReset();
  createCommentMock.mockReset();
  getAttachmentDownloadUrlMock.mockReset();
  listAttachmentsMock.mockReset();
  uploadAttachmentMock.mockReset();
  listTimelineMock.mockReset();

  // Default success values to prevent fallbacks from masking failures.
  getBugMock.mockResolvedValue(makeBugResponse());
  getWorkItemMock.mockResolvedValue(makeDetailResponse());
  getAttachmentDownloadUrlMock.mockResolvedValue({
    downloadUrl: "https://object-storage.local/download/design.png",
    expiresInSeconds: 300,
  });
  listCommentsMock.mockResolvedValue({ items: [], total: 0 });
  listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
  listTimelineMock.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("TaskDetailSheet", () => {
  it.each([
    ["TASK", "taskDetail.sheetDescription.task"],
    ["BUG", "taskDetail.sheetDescription.bug"],
  ] as const)(
    "wires an accessible sheet description for %s details",
    (type, descriptionKey) => {
      render(
        <TaskDetailSheet
          item={makeViewModel({ type })}
          open
          onOpenChange={() => {}}
        />,
      );

      const sheet = screen.getByTestId("task-detail-sheet");
      const description = screen.getByText(descriptionKey);
      expect(description).toHaveClass("sr-only");
      expect(sheet).toHaveAttribute("aria-describedby", description.id);
    },
  );

  it("renders the action bar buttons from PermissionSnapshot.availableActions", async () => {
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [
            makeAction({ id: "01A1", name: "Approve" }),
            makeAction({ id: "01A2", name: "Reject" }),
          ],
        },
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", { name: "Approve" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("shows the empty actions message when availableActions is empty", async () => {
    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalled());
    expect(
      await screen.findByText("taskDetail.actions.empty"),
    ).toBeInTheDocument();
  });

  it("renders workflow action fields and submits the populated payload", async () => {
    const onChanged = vi.fn();
    const action = makeAction({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
      name: "Resolve",
      requiresComment: true,
      formFields: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FF1",
          key: "resolution",
          label: "Resolution",
          fieldType: "TEXT",
          required: true,
          order: 1,
        },
      ],
    });
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [action],
        },
      }),
    );
    executeActionMock.mockResolvedValueOnce(
      makeDetailResponse({
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
        statusCategory: "DONE",
      }),
    );

    render(
      <TaskDetailSheet
        item={makeViewModel()}
        open
        onOpenChange={() => {}}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    fireEvent.change(screen.getByTestId("task-action-field-resolution"), {
      target: { value: "fixed" },
    });
    fireEvent.change(screen.getByTestId("task-action-comment"), {
      target: { value: "Looks good" },
    });

    const form = screen.getByTestId("task-action-form");
    fireEvent.click(within(form).getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(executeActionMock).toHaveBeenCalledTimes(1));
    expect(executeActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
        spaceId: "SPC_01",
        workItemId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      }),
      {
        comment: "Looks good",
        formValues: { resolution: "fixed" },
      },
    );
    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("loads bug permissions through the bug detail endpoint", async () => {
    getBugMock.mockResolvedValueOnce(
      makeBugResponse({
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [makeAction({ id: "01B1", name: "Confirm bug" })],
        },
      }),
    );

    render(
      <TaskDetailSheet
        item={makeViewModel({ type: "BUG", title: "Bug detail" })}
        open
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() =>
      expect(getBugMock).toHaveBeenCalledWith({
        bugId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      }),
    );
    expect(getWorkItemMock).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Confirm bug" }),
    ).toBeInTheDocument();
  });

  it("renders comments fetched via listComments on the comments tab", async () => {
    listCommentsMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          targetType: "WORK_ITEM",
          targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          author: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
            username: "alice",
            name: "Alice",
          },
          body: "First comment from API",
          createdAt: "2026-05-12T10:00:00.000Z",
        },
      ],
      total: 1,
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/comments/i);

    await waitFor(() => expect(listCommentsMock).toHaveBeenCalled());
    expect(
      await screen.findByText("First comment from API"),
    ).toBeInTheDocument();
  });

  it("renders real work item detail fields from getWorkItem", async () => {
    memberMap.set("01ARZ3NDEKTSV4RRFFQ69G5FR1", {
      user: { name: "Reporter Name" },
    });
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        description: "Real detail description",
        reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
      }),
    );

    render(
      <TaskDetailSheet
        item={makeViewModel({ title: "List title" })}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(
      await screen.findByText("Real detail description"),
    ).toBeInTheDocument();
    expect(screen.getByText("Reporter Name")).toBeInTheDocument();
  });

  it("clears loaded detail and permissions when switching items", async () => {
    const secondDetail =
      createDeferred<ReturnType<typeof makeDetailResponse>>();
    getWorkItemMock
      .mockResolvedValueOnce(
        makeDetailResponse({
          id: "TASK_A",
          title: "Loaded first task",
          permissions: {
            canEdit: true,
            canComment: true,
            canUploadAttachment: true,
            availableActions: [makeAction({ id: "ACT_A", name: "Old action" })],
          },
        }),
      )
      .mockReturnValueOnce(secondDetail.promise);

    const { rerender } = render(
      <TaskDetailSheet
        item={makeViewModel({ id: "TASK_A", title: "List first task" })}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText("Loaded first task")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Old action" }),
    ).toBeInTheDocument();

    rerender(
      <TaskDetailSheet
        item={makeViewModel({ id: "TASK_B", title: "List second task" })}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.queryByText("Loaded first task")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Old action" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("List second task")).toBeInTheDocument();

    await act(async () => {
      secondDetail.resolve(
        makeDetailResponse({ id: "TASK_B", title: "Loaded second task" }),
      );
    });

    expect(await screen.findByText("Loaded second task")).toBeInTheDocument();
  });

  it("ignores stale detail responses after switching items", async () => {
    const firstDetail = createDeferred<ReturnType<typeof makeDetailResponse>>();
    const secondDetail =
      createDeferred<ReturnType<typeof makeDetailResponse>>();
    getWorkItemMock
      .mockReturnValueOnce(firstDetail.promise)
      .mockReturnValueOnce(secondDetail.promise);

    const { rerender } = render(
      <TaskDetailSheet
        item={makeViewModel({ id: "TASK_A", title: "List first task" })}
        open
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalledTimes(1));

    rerender(
      <TaskDetailSheet
        item={makeViewModel({ id: "TASK_B", title: "List second task" })}
        open
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondDetail.resolve(
        makeDetailResponse({ id: "TASK_B", title: "Loaded second task" }),
      );
    });

    expect(await screen.findByText("Loaded second task")).toBeInTheDocument();

    await act(async () => {
      firstDetail.resolve(
        makeDetailResponse({ id: "TASK_A", title: "Stale first task" }),
      );
    });

    expect(screen.queryByText("Stale first task")).not.toBeInTheDocument();
    expect(screen.getByText("Loaded second task")).toBeInTheDocument();
  });

  it("submits a new comment via createComment when send button is clicked", async () => {
    listCommentsMock.mockResolvedValueOnce({ items: [], total: 0 });
    createCommentMock.mockResolvedValueOnce({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FC2",
      organizationId: "ORG_01",
      spaceId: "SPC_01",
      targetType: "WORK_ITEM",
      targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      author: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
        username: "tester",
        name: "Tester",
      },
      body: "Hello world",
      createdAt: "2026-05-13T00:00:00.000Z",
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/comments/i);
    await waitFor(() => expect(listCommentsMock).toHaveBeenCalled());

    const input = await screen.findByPlaceholderText(
      "taskDetail.comments.placeholder",
    );
    fireEvent.change(input, { target: { value: "Hello world" } });

    const submit = screen.getByRole("button", {
      name: /taskDetail\.comments\.submit/,
    });
    fireEvent.click(submit);

    await waitFor(() => expect(createCommentMock).toHaveBeenCalledTimes(1));
    expect(createCommentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Hello world",
        spaceId: "SPC_01",
        targetType: "WORK_ITEM",
      }),
    );
    expect(await screen.findByText("Hello world")).toBeInTheDocument();
  });

  it("hides the comment composer when PermissionSnapshot.canComment is false", async () => {
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        permissions: {
          canEdit: true,
          canComment: false,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );
    listCommentsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/comments/i);

    expect(
      await screen.findByTestId("task-comments-readonly"),
    ).toHaveTextContent("taskDetail.comments.readonly");
    expect(screen.queryByTestId("task-comments-input")).not.toBeInTheDocument();
    expect(createCommentMock).not.toHaveBeenCalled();
  });

  it("renders attachments from listAttachments on the attachments tab", async () => {
    listAttachmentsMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAT1",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          targetType: "WORK_ITEM",
          targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          fileName: "design.png",
          fileKey: "k",
          mimeType: "image/png",
          size: 12345,
          uploadedById: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
          createdAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      total: 1,
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/attachments/i);

    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());
    expect(await screen.findByText("design.png")).toBeInTheDocument();
    expect(screen.getByLabelText("Preview design.png")).toBeInTheDocument();
    expect(screen.getByLabelText("Download design.png")).toBeInTheDocument();
    // Upload button is present
    expect(
      screen.getByRole("button", {
        name: /taskDetail\.attachments\.uploadAction/,
      }),
    ).toBeInTheDocument();
  });

  it("uses the signed download-url endpoint for attachment preview", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    listAttachmentsMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAT1",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          targetType: "WORK_ITEM",
          targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          fileName: "design.png",
          fileKey: "k",
          mimeType: "image/png",
          size: 12345,
          uploadedById: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
          createdAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      total: 1,
    });
    getAttachmentDownloadUrlMock.mockResolvedValueOnce({
      downloadUrl: "https://object-storage.local/download/design.png",
      expiresInSeconds: 300,
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/attachments/i);
    fireEvent.click(await screen.findByLabelText("Preview design.png"));

    await waitFor(() =>
      expect(getAttachmentDownloadUrlMock).toHaveBeenCalledWith({
        attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAT1",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      }),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://object-storage.local/download/design.png",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("calls uploadAttachment when a file is selected on the attachments tab", async () => {
    listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
    uploadAttachmentMock.mockResolvedValueOnce(undefined);

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/attachments/i);
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

    // Sheet renders into a Portal -> query the whole document.
    const fileInput = document.body.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1));
    expect(uploadAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        targetType: "WORK_ITEM",
      }),
    );
  });

  it("hides the attachment upload entry when PermissionSnapshot.canUploadAttachment is false", async () => {
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: false,
          availableActions: [],
        },
      }),
    );
    listAttachmentsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/attachments/i);

    expect(
      await screen.findByTestId("task-attachments-readonly"),
    ).toHaveTextContent("taskDetail.attachments.readonly");
    expect(
      screen.queryByRole("button", {
        name: /taskDetail\.attachments\.uploadAction/,
      }),
    ).not.toBeInTheDocument();
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
  });

  it("renders timeline events from listTimeline on the timeline tab", async () => {
    listTimelineMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FTL1",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          target: {
            type: "WORK_ITEM",
            id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
            title: "Task",
          },
          eventType: "WORK_ITEM_CREATED",
          actor: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
            username: "alice",
            name: "Alice",
          },
          title: "created the task",
          createdAt: "2026-05-10T00:00:00.000Z",
        },
      ],
      total: 1,
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/timeline/i);
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalled());
    expect(await screen.findByText("created the task")).toBeInTheDocument();
  });

  it("shows the empty timeline state when there are no events", async () => {
    listTimelineMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/timeline/i);
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalled());
    expect(
      await screen.findByText("taskDetail.timeline.emptyTitle"),
    ).toBeInTheDocument();
  });

  it("shows EmptyState on the links tab when all relation ids are missing", async () => {
    getWorkItemMock.mockResolvedValue(
      makeDetailResponse({
        versionId: undefined,
        requirementId: undefined,
        intakeItemId: undefined,
        reporterId: undefined,
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/links/i);
    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalled());

    expect(
      await screen.findByText("taskDetail.missingApi.title"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("taskDetail.fields.reporter"),
    ).not.toBeInTheDocument();
  });

  it("shows the resolved version name on the links tab when versionId is present", async () => {
    versionMap.set("01ARZ3NDEKTSV4RRFFQ69G5FV1", { name: "Sprint 2026.5" });
    getWorkItemMock.mockResolvedValue(
      makeDetailResponse({
        versionId: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/links/i);
    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalled());
    expect(
      within(await screen.findByTestId("task-links-list")).getByText(
        "Sprint 2026.5",
      ),
    ).toBeInTheDocument();
  });

  it("loads bug relation data from the bug detail endpoint on the links tab", async () => {
    versionMap.set("01ARZ3NDEKTSV4RRFFQ69G5FV1", { name: "Bugfix train" });
    getBugMock.mockResolvedValue(
      makeBugResponse({
        versionId: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
      }),
    );

    render(
      <TaskDetailSheet
        item={makeViewModel({ type: "BUG", title: "Linked bug" })}
        open
        onOpenChange={() => {}}
      />,
    );

    await activateTab(/links/i);
    await waitFor(() => expect(getBugMock).toHaveBeenCalled());
    expect(getWorkItemMock).not.toHaveBeenCalled();
    expect(
      within(await screen.findByTestId("task-links-list")).getByText(
        "Bugfix train",
      ),
    ).toBeInTheDocument();
  });

  it("renders bug-specific detail fields from getBug", async () => {
    getBugMock.mockResolvedValueOnce(
      makeBugResponse({
        bugDetail: {
          actualResult: "Actual crash",
          expectedResult: "Expected save",
          fixNote: "Patched validation",
          regressionAt: "2026-05-14T10:00:00.000Z",
          regressionBy: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
          regressionResult: "Regression passed",
          severity: "CRITICAL",
          stepsToReproduce: "Open form and submit",
          workItemId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        },
      }),
    );
    memberMap.set("01ARZ3NDEKTSV4RRFFQ69G5FU1", {
      user: { name: "QA Owner" },
    });

    render(
      <TaskDetailSheet
        item={makeViewModel({ type: "BUG", title: "Bug detail" })}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText("Open form and submit")).toBeInTheDocument();
    expect(screen.getByText("Expected save")).toBeInTheDocument();
    expect(screen.getByText("Actual crash")).toBeInTheDocument();
    expect(screen.getByText("Patched validation")).toBeInTheDocument();
    expect(screen.getByText("Regression passed")).toBeInTheDocument();
    expect(screen.getByText("QA Owner")).toBeInTheDocument();
  });

  it("renders the empty placeholder when item is null", () => {
    render(<TaskDetailSheet item={null} open onOpenChange={() => {}} />);
    const sheet = screen.getByTestId("task-detail-sheet");
    const description = screen.getByText("taskDetail.emptyDescription");

    expect(sheet).toHaveAttribute("aria-describedby", description.id);
    expect(screen.getByText("taskDetail.empty")).toBeInTheDocument();
  });

  it("uses the resolved member name on the comments author when available", async () => {
    memberMap.set("01ARZ3NDEKTSV4RRFFQ69G5FU1", {
      user: { name: "Resolved Member Name" },
    });
    listCommentsMock.mockResolvedValueOnce({
      items: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          targetType: "WORK_ITEM",
          targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          author: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
            username: "alice",
            name: "Cached fallback",
          },
          body: "Hi",
          createdAt: "2026-05-12T10:00:00.000Z",
        },
      ],
      total: 1,
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/comments/i);
    await waitFor(() => expect(listCommentsMock).toHaveBeenCalled());
    // Resolved name from lookup wins over comment.author.name.
    expect(await screen.findByText("Resolved Member Name")).toBeInTheDocument();
    expect(screen.queryByText("Cached fallback")).not.toBeInTheDocument();
  });
});
