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

function getSelectOptionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.options, (option) => option.textContent ?? "");
}

function makeFileTransfer(files: File[]) {
  return {
    files,
    getData: () => "",
    items: [],
    types: ["Files"],
  };
}

// Stable translator: same memoized fn per namespace across renders.
const { rootMessages, translatorCache } = vi.hoisted(() => ({
  rootMessages: new Map<string, string>(),
  translatorCache: new Map<string, (key: string) => string>(),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string) => {
        const messageKey = namespace ? `${namespace}.${k}` : k;
        return namespace ? messageKey : (rootMessages.get(k) ?? messageKey);
      };
      translatorCache.set(key, fn);
    }
    return fn;
  },
  useLocale: () => "zh-CN",
}));

vi.mock("../../i18n/routing", () => ({
  routing: { defaultLocale: "zh-CN", locales: ["zh-CN", "en-US"] },
  Link: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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
const relationTitleMap = new Map<string, string>();
const workflowStateMap = new Map<string, { code: string; name: string }>();
vi.mock("../../lib/v2/lookups", () => ({
  useRelationTitle: (type: string, id: string | undefined) => ({
    title: id ? relationTitleMap.get(`${type}:${id}`) : undefined,
    loading: false,
    error: null,
  }),
  useSpaceMembers: () => ({
    members: Array.from(memberMap.entries()).map(([userId, member]) => ({
      userId,
      ...member,
    })),
    loading: false,
    error: null,
    getMember: (id: string) => memberMap.get(id),
  }),
  useVersions: () => ({
    versions: Array.from(versionMap.entries()).map(([id, version]) => ({
      id,
      ...version,
    })),
    loading: false,
    error: null,
    getVersion: (id: string) => versionMap.get(id),
  }),
  useWorkflowStateLookup: () => ({
    loading: false,
    error: null,
    getState: (
      _workflowVersionId: string | undefined,
      stateId: string | undefined,
    ) => (stateId ? workflowStateMap.get(stateId) : undefined),
  }),
}));

// Service mocks (hoisted so factories can wire them).
const {
  getBugMock,
  updateBugMock,
  getWorkItemMock,
  executeActionMock,
  listCommentsMock,
  createCommentMock,
  getAttachmentDownloadUrlMock,
  listAttachmentsMock,
  uploadAttachmentMock,
  listTimelineMock,
  updateWorkItemMock,
  getIntakeItemMock,
  listIntakeItemsMock,
  listWorkItemsMock,
  listRequirementsMock,
} = vi.hoisted(() => ({
  getBugMock: vi.fn(),
  updateBugMock: vi.fn(),
  getWorkItemMock: vi.fn(),
  executeActionMock: vi.fn(),
  listCommentsMock: vi.fn(),
  createCommentMock: vi.fn(),
  getAttachmentDownloadUrlMock: vi.fn(),
  listAttachmentsMock: vi.fn(),
  uploadAttachmentMock: vi.fn(),
  listTimelineMock: vi.fn(),
  updateWorkItemMock: vi.fn(),
  getIntakeItemMock: vi.fn(),
  listIntakeItemsMock: vi.fn(),
  listWorkItemsMock: vi.fn(),
  listRequirementsMock: vi.fn(),
}));
const realtimeInvalidationHandlers = vi.hoisted(
  () =>
    [] as {
      callback: (context: {
        events: { hints?: Record<string, unknown>; target: { id: string; type: string } }[];
        keys: string[];
        lastEventId: string | null;
        mode: "realtime";
        resyncs: unknown[];
      }) => void | Promise<void>;
      keys: readonly string[];
    }[],
);

vi.mock("../../lib/work-item-service", () => ({
  getWorkItem: getWorkItemMock,
  listWorkItems: listWorkItemsMock,
  updateWorkItem: updateWorkItemMock,
}));
vi.mock("../../lib/requirement-service", () => ({
  listRequirements: listRequirementsMock,
}));
vi.mock("../../lib/intake-service", () => ({
  getIntakeItem: getIntakeItemMock,
  listIntakeItems: listIntakeItemsMock,
}));
vi.mock("../../lib/bug-service", () => ({
  getBug: getBugMock,
  updateBug: updateBugMock,
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

import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { ApiClientError } from "../../lib/api-client";
import { AttachmentUploadError } from "../../lib/attachment-service";
import { TaskDetailSheet } from "./task-detail-sheet";

// -----------------------------------------------------------------------------

const minioDesignDownloadUrl =
  "http://127.0.0.1:9000/project-attachments/design.png?X-Amz-Signature=test";

function makeViewModel(
  overrides: Partial<WorkItemViewModel> = {},
): WorkItemViewModel {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    code: "TASK-AAA001",
    type: "TASK",
    title: "Detail test task",
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FS1",
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
  rootMessages.clear();
  memberMap.clear();
  versionMap.clear();
  relationTitleMap.clear();
  workflowStateMap.clear();
  getBugMock.mockReset();
  updateBugMock.mockReset();
  getWorkItemMock.mockReset();
  executeActionMock.mockReset();
  listCommentsMock.mockReset();
  createCommentMock.mockReset();
  getAttachmentDownloadUrlMock.mockReset();
  listAttachmentsMock.mockReset();
  uploadAttachmentMock.mockReset();
  listTimelineMock.mockReset();
  updateWorkItemMock.mockReset();
  getIntakeItemMock.mockReset();
  listIntakeItemsMock.mockReset();
  listWorkItemsMock.mockReset();
  listRequirementsMock.mockReset();
  realtimeInvalidationHandlers.length = 0;

  // Default success values to prevent fallbacks from masking failures.
  getBugMock.mockResolvedValue(makeBugResponse());
  updateBugMock.mockResolvedValue(makeBugResponse());
  getWorkItemMock.mockResolvedValue(makeDetailResponse());
  getAttachmentDownloadUrlMock.mockResolvedValue({
    downloadUrl: minioDesignDownloadUrl,
    expiresInSeconds: 300,
  });
  listCommentsMock.mockResolvedValue({ items: [], total: 0 });
  listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
  listTimelineMock.mockResolvedValue({ items: [], total: 0 });
  updateWorkItemMock.mockResolvedValue(makeDetailResponse());
  getIntakeItemMock.mockResolvedValue({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FI1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Loaded intake",
    description: "Intake detail",
    sourceType: "AD_HOC",
    status: "PENDING",
    priority: "MEDIUM",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
  });
  listIntakeItemsMock.mockResolvedValue({ items: [], total: 0 });
  listWorkItemsMock.mockResolvedValue({ items: [], total: 0 });
  listRequirementsMock.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

async function dispatchRealtimeInvalidation(
  key: string,
  event: { target: { id: string; type: string }; hints?: Record<string, unknown> },
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

describe("TaskDetailSheet", () => {
  it.each([
    ["TASK", "taskDetail.sheetDescription.task", "workflow.workItemType.TASK"],
    ["BUG", "taskDetail.sheetDescription.bug", "workflow.workItemType.BUG"],
  ] as const)(
    "wires an accessible sheet description for %s details",
    (type, descriptionKey, typeLabel) => {
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
      expect(screen.getByText(typeLabel)).toBeInTheDocument();
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

  it("keeps the detail header on the real workflow state name after detail loads", async () => {
    workflowStateMap.set("01ARZ3NDEKTSV4RRFFQ69G5FS2", {
      code: "CUSTOM_ACCEPTANCE",
      name: "客户验收中",
    });
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FS2",
        statusCategory: "VERIFYING",
      }),
    );

    render(
      <TaskDetailSheet
        item={makeViewModel({ statusLabel: "开始处理" })}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText("客户验收中")).toBeInTheDocument();
    expect(
      screen.queryByText("workItems.statusCategory.VERIFYING"),
    ).not.toBeInTheDocument();
  });

  it("focuses the workflow action region when requested by a shortcut", async () => {
    render(
      <TaskDetailSheet
        actionFocusRequest={1}
        item={makeViewModel()}
        open
        onOpenChange={() => {}}
      />,
    );

    const region = await screen.findByTestId("task-actions-region");
    await waitFor(() => expect(region).toHaveFocus());
  });

  it("preselects a preferred action for confirmation without executing it", async () => {
    const action = makeAction({ id: "ACT_START", name: "Start work" });
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
      }),
    );

    render(
      <TaskDetailSheet
        actionFocusRequest={1}
        item={makeViewModel()}
        open
        onOpenChange={() => {}}
        preferredActionId="ACT_START"
      />,
    );

    const form = await screen.findByTestId("task-action-form");
    expect(executeActionMock).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole("button", { name: "Start work" }));

    await waitFor(() => expect(executeActionMock).toHaveBeenCalledTimes(1));
  });

  it("preselects input-required actions without auto-submitting them", async () => {
    const action = makeAction({
      formFields: [
        {
          fieldType: "TEXT",
          id: "ACT_FIELD",
          key: "resolution",
          label: "Resolution",
          order: 1,
          required: true,
        },
      ],
      id: "ACT_RESOLVE",
      name: "Resolve",
      requiresComment: true,
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

    render(
      <TaskDetailSheet
        actionFocusRequest={1}
        item={makeViewModel()}
        open
        onOpenChange={() => {}}
        preferredActionId="ACT_RESOLVE"
      />,
    );

    expect(await screen.findByTestId("task-action-form")).toBeInTheDocument();
    expect(screen.getByTestId("task-action-comment")).toBeInTheDocument();
    expect(screen.getByTestId("task-action-field")).toHaveAttribute(
      "data-field-key",
      "resolution",
    );
    expect(executeActionMock).not.toHaveBeenCalled();
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

  it("shows counts on comments and attachments tabs without adding a timeline count", async () => {
    listCommentsMock.mockResolvedValue({ items: [], total: 3 });
    listAttachmentsMock.mockResolvedValue({ items: [], total: 2 });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("task-comments-tab")).toHaveTextContent("3");
      expect(screen.getByTestId("task-attachments-tab")).toHaveTextContent("2");
    });
    expect(screen.getByTestId("task-timeline-tab")).not.toHaveTextContent("3");
    expect(screen.getByTestId("task-timeline-tab")).not.toHaveTextContent("2");
  });

  it("refreshes realtime comments without clearing the local draft", async () => {
    let comments = [
      {
        id: "COMMENT_OLD",
        author: { id: "USER_OLD", name: "Old User" },
        body: "old comment",
        createdAt: "2026-05-12T00:00:00.000Z",
      },
    ];
    listCommentsMock.mockImplementation(
      async (input: { pageSize?: number } | undefined) =>
        input?.pageSize === 1
          ? { items: [], total: comments.length }
          : { items: comments, total: comments.length },
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/taskDetail\.tabs\.comments/u);
    expect(await screen.findByText("old comment")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("task-comments-input"), {
      target: { value: "local draft" },
    });

    comments = [
      {
        id: "COMMENT_NEW",
        author: { id: "USER_NEW", name: "New User" },
        body: "new realtime comment",
        createdAt: "2026-05-12T00:01:00.000Z",
      },
    ];
    await dispatchRealtimeInvalidation("comments", {
      target: { id: "01ARZ3NDEKTSV4RRFFQ69G5FA1", type: "WORK_ITEM" },
    });

    expect(await screen.findByText("new realtime comment")).toBeInTheDocument();
    expect(screen.getByTestId("task-comments-input")).toHaveValue(
      "local draft",
    );
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
    const resolutionField = screen.getByTestId("task-action-field");
    expect(resolutionField).toHaveAttribute("data-field-key", "resolution");
    fireEvent.change(resolutionField, {
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

  it("shows field-level errors before executing invalid action forms", async () => {
    const action = makeAction({
      formFields: [
        {
          fieldType: "SELECT",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FC2",
          key: "resolution",
          label: "Resolution",
          options: ["fixed"],
          order: 1,
          required: true,
        },
      ],
      id: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
      name: "Resolve",
      requiresComment: true,
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

    render(
      <TaskDetailSheet
        item={makeViewModel()}
        open
        onOpenChange={() => {}}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    const form = screen.getByTestId("task-action-form");
    fireEvent.click(within(form).getByRole("button", { name: "Resolve" }));

    const resolutionField = screen.getByTestId("task-action-field");
    const commentField = screen.getByTestId("task-action-comment");
    expect(resolutionField).toHaveAttribute("aria-invalid", "true");
    expect(commentField).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("taskDetail.actions.fieldError"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("taskDetail.actions.commentError"),
    ).toBeInTheDocument();
    expect(executeActionMock).not.toHaveBeenCalled();
  });

  it("renders select action field options with display labels instead of raw enum values", async () => {
    rootMessages.set(
      "common.workflowDefaults.states.REGRESSION_PASSED",
      "Regression passed",
    );
    rootMessages.set(
      "common.workflowDefaults.fieldOptions.resolution.WONT_FIX",
      "Won't fix",
    );
    const action = makeAction({
      formFields: [
        {
          fieldType: "SELECT",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FC2",
          key: "resolution",
          label: "Resolution",
          options: ["REGRESSION_PASSED", "WONT_FIX", "custom-option"],
          order: 1,
          required: true,
        },
      ],
      id: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
      name: "Resolve",
      requiresComment: false,
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

    render(
      <TaskDetailSheet
        item={makeViewModel()}
        open
        onOpenChange={() => {}}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));

    const resolutionField = screen.getByTestId(
      "task-action-field",
    ) as HTMLSelectElement;
    expect(getSelectOptionLabels(resolutionField)).toEqual([
      "",
      "Regression passed",
      "Won't fix",
      "Custom Option",
    ]);
    expect(getSelectOptionLabels(resolutionField)).not.toContain(
      "REGRESSION_PASSED",
    );
    expect(getSelectOptionLabels(resolutionField)).not.toContain("WONT_FIX");
  });

  it("renders an unavailable user action field as a disabled select", async () => {
    const action = makeAction({
      formFields: [
        {
          fieldType: "USER",
          id: "01ARZ3NDEKTSV4RRFFQ69G5FU2",
          key: "reviewerId",
          label: "Reviewer",
          order: 1,
          required: true,
        },
      ],
      id: "01ARZ3NDEKTSV4RRFFQ69G5FC1",
      name: "Assign reviewer",
      requiresComment: false,
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

    render(
      <TaskDetailSheet
        item={makeViewModel()}
        open
        onOpenChange={() => {}}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Assign reviewer" }),
    );

    const reviewerField = screen.getByTestId("task-action-field");
    expect(reviewerField.tagName).toBe("SELECT");
    expect(reviewerField).toBeDisabled();
    expect(reviewerField).toHaveAttribute("data-field-key", "reviewerId");
  });

  it("refreshes the open timeline after a workflow action succeeds", async () => {
    const action = makeAction({ id: "01ACT_REFRESH", name: "Complete" });
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
      }),
    );
    listTimelineMock
      .mockResolvedValueOnce({
        items: [
          {
            id: "01TL_BEFORE",
            organizationId: "ORG_01",
            spaceId: "SPC_01",
            target: {
              type: "WORK_ITEM",
              id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
              title: "Initial timeline task",
            },
            eventType: "CREATED",
            actor: { id: "USR_01", username: "tester", name: "Tester" },
            title: "created the task",
            createdAt: "2026-05-10T00:00:00.000Z",
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "01TL_AFTER",
            organizationId: "ORG_01",
            spaceId: "SPC_01",
            target: {
              type: "WORK_ITEM",
              id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
              title: "Task",
            },
            eventType: "ACTION_EXECUTED",
            actor: { id: "USR_01", username: "tester", name: "Tester" },
            metadata: { actionName: "Complete" },
            title: "completed the task",
            createdAt: "2026-05-13T00:00:00.000Z",
          },
        ],
        total: 1,
      });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/timeline/i);
    expect(
      await screen.findByText("common.timeline.event.CREATED"),
    ).toBeInTheDocument();
    expect(screen.getByText("Initial timeline task")).toBeInTheDocument();
    expect(screen.queryByText("created the task")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));

    await waitFor(() => expect(executeActionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Complete")).toBeInTheDocument();
    expect(screen.queryByText("completed the task")).not.toBeInTheDocument();
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
    listCommentsMock.mockResolvedValue({
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

  it("ignores stale comments responses after switching items", async () => {
    const firstComments = createDeferred<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>();
    const secondComments = createDeferred<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>();
    listCommentsMock.mockImplementation(
      (input: { pageSize?: number; targetId: string }) => {
        if (input.pageSize === 1) {
          return Promise.resolve({ items: [], total: 0 });
        }
        if (input.targetId === "TASK_A") {
          return firstComments.promise;
        }
        if (input.targetId === "TASK_B") {
          return secondComments.promise;
        }
        return Promise.resolve({ items: [], total: 0 });
      },
    );

    const { rerender } = render(
      <TaskDetailSheet
        item={makeViewModel({ id: "TASK_A", title: "List first task" })}
        open
        onOpenChange={() => {}}
      />,
    );

    await activateTab(/comments/i);
    await waitFor(() =>
      expect(
        listCommentsMock.mock.calls.some(
          ([input]) => input.targetId === "TASK_A" && input.pageSize !== 1,
        ),
      ).toBe(true),
    );

    rerender(
      <TaskDetailSheet
        item={makeViewModel({ id: "TASK_B", title: "List second task" })}
        open
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        listCommentsMock.mock.calls.some(
          ([input]) => input.targetId === "TASK_B" && input.pageSize !== 1,
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByText("taskDetail.comments.loading"),
    ).toBeInTheDocument();

    await act(async () => {
      secondComments.resolve({
        items: [
          {
            id: "COMMENT_B",
            organizationId: "ORG_01",
            spaceId: "SPC_01",
            targetType: "WORK_ITEM",
            targetId: "TASK_B",
            author: {
              id: "USR_02",
              username: "bob",
              name: "Bob",
            },
            body: "Fresh second comment",
            createdAt: "2026-05-13T00:00:00.000Z",
          },
        ],
        total: 1,
      });
      await secondComments.promise;
    });

    expect(await screen.findByText("Fresh second comment")).toBeInTheDocument();

    await act(async () => {
      firstComments.resolve({
        items: [
          {
            id: "COMMENT_A",
            organizationId: "ORG_01",
            spaceId: "SPC_01",
            targetType: "WORK_ITEM",
            targetId: "TASK_A",
            author: {
              id: "USR_01",
              username: "alice",
              name: "Alice",
            },
            body: "Stale first comment",
            createdAt: "2026-05-12T00:00:00.000Z",
          },
        ],
        total: 1,
      });
      await firstComments.promise;
    });

    expect(screen.queryByText("Stale first comment")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh second comment")).toBeInTheDocument();
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

  it("updates editable task fields when PermissionSnapshot.canEdit is true", async () => {
    const onChanged = vi.fn();
    const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FAS";
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FRQ";
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FJ1";
    memberMap.set(assigneeId, {
      user: { name: "Alice Owner" },
    });
    versionMap.set(versionId, { name: "Release 1" });
    listRequirementsMock.mockResolvedValueOnce({
      items: [{ id: requirementId, title: "Requirement B" }],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [{ id: intakeItemId, title: "Intake B", versionId }],
      total: 1,
    });
    getWorkItemMock
      .mockResolvedValueOnce(
        makeDetailResponse({
          description: "Before",
          dueDate: "2026-06-01T00:00:00.000Z",
          permissions: {
            canEdit: true,
            canComment: true,
            canUploadAttachment: true,
            availableActions: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeDetailResponse({
          assigneeId,
          description: "After",
          dueDate: "2026-06-02T00:00:00.000Z",
          priority: "HIGH",
          intakeItemId,
          requirementId,
          title: "Edited task",
          versionId,
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

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId(
            "task-edit-requirement-select",
          ) as HTMLSelectElement,
        ),
      ).toContain("Requirement B"),
    );

    fireEvent.change(screen.getByTestId("task-edit-title-input"), {
      target: { value: "  Edited task  " },
    });
    fireEvent.change(screen.getByTestId("task-edit-description-input"), {
      target: { value: "  After  " },
    });
    fireEvent.change(screen.getByTestId("task-edit-priority-select"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(screen.getByTestId("task-edit-assignee-select"), {
      target: { value: assigneeId },
    });
    fireEvent.change(screen.getByTestId("task-edit-version-select"), {
      target: { value: versionId },
    });
    fireEvent.change(screen.getByTestId("task-edit-requirement-select"), {
      target: { value: requirementId },
    });
    fireEvent.change(screen.getByTestId("task-edit-intake-select"), {
      target: { value: intakeItemId },
    });
    fireEvent.change(screen.getByTestId("task-edit-due-date-input"), {
      target: { value: "2026-06-02" },
    });
    fireEvent.click(screen.getByTestId("task-edit-submit"));

    await waitFor(() => expect(updateWorkItemMock).toHaveBeenCalledTimes(1));
    expect(updateWorkItemMock).toHaveBeenCalledWith(
      {
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workItemId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      },
      expect.objectContaining({
        assigneeId,
        description: "After",
        dueDate: expect.any(String),
        intakeItemId,
        priority: "HIGH",
        requirementId,
        title: "Edited task",
        versionId,
      }),
    );
    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Edited task")).toBeInTheDocument();
    expect(screen.queryByTestId("task-edit-form")).not.toBeInTheDocument();
  });

  it("updates editable bug fields through updateBug when PermissionSnapshot.canEdit is true", async () => {
    const onChanged = vi.fn();
    const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FAS";
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FRQ";
    const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FTK";
    memberMap.set(assigneeId, {
      user: { name: "Alice Owner" },
    });
    versionMap.set(versionId, { name: "Release 1" });
    listRequirementsMock.mockResolvedValueOnce({
      items: [{ id: requirementId, title: "Requirement B" }],
      total: 1,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        makeDetailResponse({
          id: relatedTaskId,
          title: "Related task",
          type: "TASK",
          versionId,
        }),
      ],
      total: 1,
    });
    getBugMock
      .mockResolvedValueOnce(
        makeBugResponse({
          description: "Before",
          permissions: {
            canEdit: true,
            canComment: true,
            canUploadAttachment: true,
            availableActions: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeBugResponse({
          assigneeId,
          bugDetail: {
            actualResult: "Actual after",
            expectedResult: "Expected after",
            relatedTaskId,
            severity: "CRITICAL",
            stepsToReproduce: "Steps after",
          },
          description: "After",
          priority: "HIGH",
          requirementId,
          title: "Edited bug",
          versionId,
        }),
      );

    render(
      <TaskDetailSheet
        item={makeViewModel({ type: "BUG", title: "Bug detail" })}
        open
        onOpenChange={() => {}}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId(
            "task-edit-related-task-select",
          ) as HTMLSelectElement,
        ),
      ).toContain("Related task"),
    );

    fireEvent.change(screen.getByTestId("task-edit-title-input"), {
      target: { value: "  Edited bug  " },
    });
    fireEvent.change(screen.getByTestId("task-edit-description-input"), {
      target: { value: "  After  " },
    });
    fireEvent.change(screen.getByTestId("task-edit-priority-select"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(screen.getByTestId("task-edit-severity-select"), {
      target: { value: "CRITICAL" },
    });
    fireEvent.change(screen.getByTestId("task-edit-assignee-select"), {
      target: { value: assigneeId },
    });
    fireEvent.change(screen.getByTestId("task-edit-version-select"), {
      target: { value: versionId },
    });
    fireEvent.change(screen.getByTestId("task-edit-requirement-select"), {
      target: { value: requirementId },
    });
    fireEvent.change(screen.getByTestId("task-edit-related-task-select"), {
      target: { value: relatedTaskId },
    });
    fireEvent.change(screen.getByTestId("task-edit-steps-input"), {
      target: { value: "  Steps after  " },
    });
    fireEvent.change(screen.getByTestId("task-edit-expected-input"), {
      target: { value: "  Expected after  " },
    });
    fireEvent.change(screen.getByTestId("task-edit-actual-input"), {
      target: { value: "  Actual after  " },
    });
    fireEvent.click(screen.getByTestId("task-edit-submit"));

    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(1));
    expect(updateBugMock).toHaveBeenCalledWith(
      {
        bugId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      },
      expect.objectContaining({
        actualResult: "Actual after",
        assigneeId,
        description: "After",
        expectedResult: "Expected after",
        priority: "HIGH",
        relatedTaskId,
        requirementId,
        severity: "CRITICAL",
        stepsToReproduce: "Steps after",
        title: "Edited bug",
        versionId,
      }),
    );
    expect(updateWorkItemMock).not.toHaveBeenCalled();
    await waitFor(() => expect(getBugMock).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("confirms and retries bug save from the detail editor when version cascade is required", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const nextVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
    const affectedBugId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
    const onChanged = vi.fn();
    versionMap.set(versionId, { name: "Release 1" });
    versionMap.set(nextVersionId, { name: "Release 2" });
    getBugMock
      .mockResolvedValueOnce(
        makeBugResponse({
          versionId,
          permissions: {
            canEdit: true,
            canComment: true,
            canUploadAttachment: true,
            availableActions: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeBugResponse({
          versionId: nextVersionId,
          permissions: {
            canEdit: true,
            canComment: true,
            canUploadAttachment: true,
            availableActions: [],
          },
        }),
      );
    updateBugMock
      .mockRejectedValueOnce(
        new ApiClientError(
          {
            code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
            message: "Bug version change requires cascade",
            requestId: "REQ_TRACE",
            details: {
              targetType: "TASK",
              targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
              fromVersionId: versionId,
              toVersionId: nextVersionId,
              impact: {
                bugCount: 1,
                bugIds: [affectedBugId],
                relatedBugCount: 0,
                workItemCount: 0,
              },
            },
          },
          new Response(null, { status: 409, statusText: "Conflict" }),
        ),
      )
      .mockResolvedValueOnce(makeBugResponse({ versionId: nextVersionId }));

    render(
      <TaskDetailSheet
        item={makeViewModel({ type: "BUG", title: "Bug detail" })}
        open
        onOpenChange={() => {}}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId("task-edit-version-select") as HTMLSelectElement,
        ),
      ).toContain("Release 2"),
    );
    fireEvent.change(screen.getByTestId("task-edit-version-select"), {
      target: { value: nextVersionId },
    });
    fireEvent.click(screen.getByTestId("task-edit-submit"));

    const confirmDialog = await screen.findByTestId(
      "trace-version-cascade-confirm-dialog",
    );
    expect(confirmDialog).toHaveTextContent(
      "errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
    );
    expect(confirmDialog).toHaveTextContent(
      "traceVersionCascadeConfirm.scopeTitle",
    );
    expect(confirmDialog).toHaveTextContent(affectedBugId);
    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(1));
    expect(updateBugMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.not.objectContaining({ cascadeVersionChange: true }),
    );

    fireEvent.click(screen.getByTestId("trace-version-cascade-confirm"));

    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(2));
    expect(updateBugMock).toHaveBeenLastCalledWith(
      {
        bugId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      },
      expect.objectContaining({ cascadeVersionChange: true }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("links requirement and version when editing a bug related task", async () => {
    const linkedRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
    const requirementVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const relatedTaskVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
    const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FT2";
    versionMap.set(requirementVersionId, { name: "Requirement release" });
    versionMap.set(relatedTaskVersionId, { name: "Task release" });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        {
          id: linkedRequirementId,
          title: "Linked requirement",
          versionId: requirementVersionId,
        },
      ],
      total: 1,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        makeDetailResponse({
          id: relatedTaskId,
          requirementId: linkedRequirementId,
          title: "Linked task",
          type: "TASK",
          versionId: relatedTaskVersionId,
        }),
      ],
      total: 1,
    });
    getBugMock.mockResolvedValueOnce(
      makeBugResponse({
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
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

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId(
            "task-edit-related-task-select",
          ) as HTMLSelectElement,
        ),
      ).toContain("Linked task"),
    );

    fireEvent.change(screen.getByTestId("task-edit-related-task-select"), {
      target: { value: relatedTaskId },
    });
    fireEvent.click(screen.getByTestId("task-edit-submit"));

    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(1));
    expect(updateBugMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        relatedTaskId,
        requirementId: linkedRequirementId,
        versionId: relatedTaskVersionId,
      }),
    );
  });

  it("submits null for cleared editable task fields", async () => {
    const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FAS";
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FRQ";
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FJ1";
    memberMap.set(assigneeId, {
      user: { name: "Alice Owner" },
    });
    versionMap.set(versionId, { name: "Release 1" });
    listRequirementsMock.mockResolvedValue({
      items: [{ id: requirementId, title: "Requirement B" }],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValue({
      items: [{ id: intakeItemId, title: "Intake B", versionId }],
      total: 1,
    });
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        assigneeId,
        description: "Before",
        dueDate: "2026-06-01T00:00:00.000Z",
        intakeItemId,
        requirementId,
        versionId,
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("task-edit-requirement-select")).toHaveValue(
        requirementId,
      ),
    );

    fireEvent.change(screen.getByTestId("task-edit-description-input"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("task-edit-assignee-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("task-edit-version-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("task-edit-requirement-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("task-edit-intake-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("task-edit-due-date-input"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("task-edit-submit"));

    await waitFor(() => expect(updateWorkItemMock).toHaveBeenCalledTimes(1));
    expect(updateWorkItemMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        assigneeId: null,
        description: null,
        dueDate: null,
        intakeItemId: null,
        requirementId: null,
        versionId: null,
      }),
    );
  });

  it("resets the edit draft when canceling and opening again", async () => {
    const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FAS";
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FRQ";
    memberMap.set(assigneeId, {
      user: { name: "Alice Owner" },
    });
    versionMap.set(versionId, { name: "Release 1" });
    listRequirementsMock.mockResolvedValue({
      items: [{ id: requirementId, title: "Requirement B" }],
      total: 1,
    });
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        assigneeId,
        description: "Before",
        dueDate: "2026-06-01T00:00:00.000Z",
        requirementId,
        versionId,
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("task-edit-requirement-select")).toHaveValue(
        requirementId,
      ),
    );

    fireEvent.change(screen.getByTestId("task-edit-title-input"), {
      target: { value: "Unsaved title" },
    });
    fireEvent.change(screen.getByTestId("task-edit-description-input"), {
      target: { value: "Unsaved description" },
    });
    fireEvent.change(screen.getByTestId("task-edit-assignee-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("task-edit-version-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("task-edit-requirement-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("task-edit-due-date-input"), {
      target: { value: "" },
    });

    const form = screen.getByTestId("task-edit-form");
    fireEvent.click(
      within(form).getByRole("button", { name: "taskDetail.edit.cancel" }),
    );
    expect(screen.queryByTestId("task-edit-form")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("task-edit-button"));

    expect(screen.getByTestId("task-edit-title-input")).toHaveValue(
      "Detail test task",
    );
    expect(screen.getByTestId("task-edit-description-input")).toHaveValue(
      "Before",
    );
    expect(screen.getByTestId("task-edit-assignee-select")).toHaveValue(
      assigneeId,
    );
    expect(screen.getByTestId("task-edit-version-select")).toHaveValue(
      versionId,
    );
    expect(screen.getByTestId("task-edit-requirement-select")).toHaveValue(
      requirementId,
    );
    expect(screen.getByTestId("task-edit-due-date-input")).toHaveValue(
      "2026-06-01",
    );
  });

  it("infers task edit version and requirement from a selected intake item", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FRQ";
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FJ1";
    versionMap.set(versionId, { name: "Release 1" });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        { id: requirementId, title: "Requirement from intake", versionId },
      ],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        {
          id: intakeItemId,
          title: "Versioned intake",
          requirementId,
          versionId,
        },
      ],
      total: 1,
    });
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    expect(await screen.findByText("Versioned intake")).toBeInTheDocument();

    const versionSelect = screen.getByTestId(
      "task-edit-version-select",
    ) as HTMLSelectElement;
    const intakeSelect = screen.getByTestId(
      "task-edit-intake-select",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "task-edit-requirement-select",
    ) as HTMLSelectElement;

    fireEvent.change(intakeSelect, { target: { value: intakeItemId } });

    await waitFor(() => expect(versionSelect.value).toBe(versionId));
    expect(requirementSelect.value).toBe(requirementId);
    expect(intakeSelect.value).toBe(intakeItemId);
  });

  it("clears linked requirement and intake when the task version changes", async () => {
    const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
    const nextVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FRQ";
    const nextRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FJ1";
    const nextIntakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FJ2";
    versionMap.set(versionId, { name: "Release 1" });
    versionMap.set(nextVersionId, { name: "Release 2" });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        { id: requirementId, title: "Requirement v1", versionId },
        {
          id: nextRequirementId,
          title: "Requirement v2",
          versionId: nextVersionId,
        },
      ],
      total: 2,
    });
    listIntakeItemsMock.mockResolvedValueOnce({
      items: [
        { id: intakeItemId, title: "Intake v1", versionId },
        { id: nextIntakeItemId, title: "Intake v2", versionId: nextVersionId },
      ],
      total: 2,
    });
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        intakeItemId,
        requirementId,
        versionId,
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("task-edit-requirement-select")).toHaveValue(
        requirementId,
      ),
    );

    const requirementSelect = screen.getByTestId(
      "task-edit-requirement-select",
    ) as HTMLSelectElement;
    const intakeSelect = screen.getByTestId(
      "task-edit-intake-select",
    ) as HTMLSelectElement;

    fireEvent.change(screen.getByTestId("task-edit-version-select"), {
      target: { value: nextVersionId },
    });

    await waitFor(() => expect(requirementSelect.value).toBe(""));
    expect(intakeSelect.value).toBe("");
    expect(getSelectOptionLabels(requirementSelect)).toContain(
      "Requirement v2",
    );
    expect(getSelectOptionLabels(requirementSelect)).not.toContain(
      "Requirement v1",
    );
    expect(getSelectOptionLabels(intakeSelect)).toContain("Intake v2");
    expect(getSelectOptionLabels(intakeSelect)).not.toContain("Intake v1");
  });

  it("shows a localized trace conflict error when task update fails", async () => {
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );
    updateWorkItemMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "TRACE_CASCADE_CONFLICT",
          message: "Linked downstream version still conflicts",
          requestId: "REQ_TRACE",
        },
        new Response(null, { status: 409, statusText: "Conflict" }),
      ),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    fireEvent.click(screen.getByTestId("task-edit-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.api.TRACE_CASCADE_CONFLICT",
    );
  });

  it("confirms and retries task save when version cascade is required", async () => {
    const cascadeError = new ApiClientError(
      {
        code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
        message: "任务版本变更需要同步上下游对象",
        requestId: "REQ_TRACE",
        details: {
          targetType: "TASK",
          targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          fromVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
          toVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FV2",
          impact: {
            bugCount: 1,
            bugIds: ["01ARZ3NDEKTSV4RRFFQ69G5FB1"],
            relatedBugCount: 0,
            workItemCount: 0,
          },
        },
      },
      new Response(null, { status: 409, statusText: "Conflict" }),
    );
    updateWorkItemMock
      .mockRejectedValueOnce(cascadeError)
      .mockResolvedValueOnce(makeDetailResponse());

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    fireEvent.click(await screen.findByTestId("task-edit-button"));
    fireEvent.click(screen.getByTestId("task-edit-submit"));

    expect(
      await screen.findByTestId("trace-version-cascade-confirm-dialog"),
    ).toHaveTextContent("errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE");
    expect(
      screen.getByTestId("trace-version-cascade-confirm-dialog"),
    ).toHaveTextContent("traceVersionCascadeConfirm.scopeTitle");
    expect(
      screen.getByTestId("trace-version-cascade-confirm-dialog"),
    ).toHaveTextContent("01ARZ3NDEKTSV4RRFFQ69G5FB1");
    await waitFor(() => expect(updateWorkItemMock).toHaveBeenCalledTimes(1));
    expect(updateWorkItemMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.not.objectContaining({ cascadeVersionChange: true }),
    );

    fireEvent.click(screen.getByTestId("trace-version-cascade-confirm"));

    await waitFor(() => expect(updateWorkItemMock).toHaveBeenCalledTimes(2));
    expect(updateWorkItemMock).toHaveBeenLastCalledWith(
      {
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workItemId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      },
      expect.objectContaining({ cascadeVersionChange: true }),
    );
  });

  it("does not show task field editing when PermissionSnapshot.canEdit is false", async () => {
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        permissions: {
          canEdit: false,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalled());
    expect(screen.queryByTestId("task-edit-button")).not.toBeInTheDocument();
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

  it("keeps a locally incremented comment count when the initial count request resolves later", async () => {
    const countResponse = createDeferred<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>();
    listCommentsMock.mockImplementation((input: { pageSize?: number }) =>
      input.pageSize === 1
        ? countResponse.promise
        : Promise.resolve({ items: [], total: 5 }),
    );
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
      body: "Race-safe comment",
      createdAt: "2026-05-13T00:00:00.000Z",
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/comments/i);
    await waitFor(() =>
      expect(screen.getByTestId("task-comments-tab")).toHaveTextContent("5"),
    );

    fireEvent.change(
      await screen.findByPlaceholderText("taskDetail.comments.placeholder"),
      { target: { value: "Race-safe comment" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /taskDetail\.comments\.submit/,
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("task-comments-tab")).toHaveTextContent("6"),
    );

    await act(async () => {
      countResponse.resolve({ items: [], total: 5 });
      await countResponse.promise;
    });

    expect(screen.getByTestId("task-comments-tab")).toHaveTextContent("6");
  });

  it("loads a fresh timeline after creating a comment", async () => {
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
      body: "Timeline comment",
      createdAt: "2026-05-13T00:00:00.000Z",
    });
    listTimelineMock.mockResolvedValueOnce({
      items: [
        {
          id: "01TL_COMMENT",
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          target: {
            type: "WORK_ITEM",
            id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
            title: "Task",
          },
          eventType: "COMMENTED",
          actor: { id: "USR_01", username: "tester", name: "Tester" },
          title: "commented on the task",
          createdAt: "2026-05-13T00:00:00.000Z",
        },
      ],
      total: 1,
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/comments/i);
    fireEvent.change(
      await screen.findByPlaceholderText("taskDetail.comments.placeholder"),
      { target: { value: "Timeline comment" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /taskDetail\.comments\.submit/,
      }),
    );

    await waitFor(() => expect(createCommentMock).toHaveBeenCalledTimes(1));
    await activateTab(/timeline/i);

    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("common.timeline.event.COMMENTED"),
    ).toBeInTheDocument();
    expect(screen.queryByText("commented on the task")).not.toBeInTheDocument();
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
    listAttachmentsMock.mockResolvedValue({
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
    expect(
      screen.getByLabelText("taskDetail.attachments.previewFile"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("taskDetail.attachments.downloadFile"),
    ).toBeInTheDocument();
    // Upload button is present
    expect(
      screen.getByRole("button", {
        name: /taskDetail\.attachments\.uploadAction/,
      }),
    ).toBeInTheDocument();
  });

  it("uses the signed download-url endpoint for attachment preview", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    listAttachmentsMock.mockResolvedValue({
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
      downloadUrl: minioDesignDownloadUrl,
      expiresInSeconds: 300,
    });

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/attachments/i);
    fireEvent.click(
      await screen.findByLabelText("taskDetail.attachments.previewFile"),
    );

    await waitFor(() =>
      expect(getAttachmentDownloadUrlMock).toHaveBeenCalledWith({
        attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAT1",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      }),
    );
    expect(openSpy).toHaveBeenCalledWith(
      minioDesignDownloadUrl,
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

  it("uploads files pasted into the attachments tab", async () => {
    listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
    uploadAttachmentMock.mockResolvedValueOnce(undefined);

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/attachments/i);
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

    const dropZone = screen.getByTestId("task-attachments-drop-zone");
    const file = new File(["screenshot"], "screenshot.png", {
      type: "image/png",
    });
    fireEvent.paste(dropZone, {
      clipboardData: makeFileTransfer([file]),
    });

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1));
    expect(uploadAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        targetType: "WORK_ITEM",
      }),
    );
  });

  it("uploads dropped files and shows drop feedback", async () => {
    listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
    uploadAttachmentMock.mockResolvedValueOnce(undefined);

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/attachments/i);
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

    const dropZone = screen.getByTestId("task-attachments-drop-zone");
    const file = new File(["dragged"], "dragged.pdf", {
      type: "application/pdf",
    });
    fireEvent.dragEnter(dropZone, {
      dataTransfer: makeFileTransfer([file]),
    });

    expect(
      await screen.findByText("taskDetail.attachments.dropActive"),
    ).toBeInTheDocument();

    fireEvent.drop(dropZone, {
      dataTransfer: makeFileTransfer([file]),
    });

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1));
    expect(uploadAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        targetId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        targetType: "WORK_ITEM",
      }),
    );
    expect(
      screen.queryByText("taskDetail.attachments.dropActive"),
    ).not.toBeInTheDocument();
  });

  it("uses the WORK_ITEM attachment target when the detail sheet shows a bug", async () => {
    listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
    uploadAttachmentMock.mockResolvedValueOnce(undefined);

    render(
      <TaskDetailSheet
        item={makeViewModel({
          id: "01ARZ3NDEKTSV4RRFFQ69G5FBG",
          type: "BUG",
          title: "Bug attachment test",
        })}
        open
        onOpenChange={() => {}}
      />,
    );

    await activateTab(/attachments/i);
    await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

    const dropZone = screen.getByTestId("task-attachments-drop-zone");
    const file = new File(["bug-shot"], "bug-shot.png", {
      type: "image/png",
    });
    fireEvent.paste(dropZone, {
      clipboardData: makeFileTransfer([file]),
    });

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1));
    expect(uploadAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        targetId: "01ARZ3NDEKTSV4RRFFQ69G5FBG",
        targetType: "WORK_ITEM",
      }),
    );
  });

  it("refreshes the open timeline after an attachment upload succeeds", async () => {
    listTimelineMock
      .mockResolvedValueOnce({
        items: [
          {
            id: "01TL_ATTACHMENT_BEFORE",
            organizationId: "ORG_01",
            spaceId: "SPC_01",
            target: {
              type: "WORK_ITEM",
              id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
              title: "Attachment timeline task",
            },
            eventType: "CREATED",
            actor: { id: "USR_01", username: "tester", name: "Tester" },
            title: "created the task",
            createdAt: "2026-05-10T00:00:00.000Z",
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "01TL_ATTACHMENT_AFTER",
            organizationId: "ORG_01",
            spaceId: "SPC_01",
            target: {
              type: "WORK_ITEM",
              id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
              title: "Task",
            },
            eventType: "ATTACHMENT_ADDED",
            actor: { id: "USR_01", username: "tester", name: "Tester" },
            metadata: { fileName: "hello.txt" },
            title: "uploaded an attachment",
            createdAt: "2026-05-13T00:00:00.000Z",
          },
        ],
        total: 1,
      });
    listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
    uploadAttachmentMock.mockResolvedValueOnce(undefined);

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await activateTab(/timeline/i);
    expect(
      await screen.findByText("common.timeline.event.CREATED"),
    ).toBeInTheDocument();
    expect(screen.getByText("Attachment timeline task")).toBeInTheDocument();
    expect(screen.queryByText("created the task")).not.toBeInTheDocument();
    await activateTab(/attachments/i);

    const fileInput = document.body.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1));
    await activateTab(/timeline/i);
    await waitFor(() => expect(listTimelineMock).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("common.timeline.event.ATTACHMENT_ADDED"),
    ).toBeInTheDocument();
    expect(screen.getByText("hello.txt")).toBeInTheDocument();
    expect(
      screen.queryByText("uploaded an attachment"),
    ).not.toBeInTheDocument();
  });

  it.each([
    "FILE_TOO_LARGE",
    "UNSUPPORTED_MIME_TYPE",
    "ATTACHMENT_LIMIT_EXCEEDED",
  ] as const)(
    "renders localized attachment upload limit error %s",
    async (code) => {
      listAttachmentsMock.mockResolvedValue({ items: [], total: 0 });
      uploadAttachmentMock.mockRejectedValueOnce(
        new AttachmentUploadError(code),
      );

      render(
        <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
      );

      await activateTab(/attachments/i);
      await waitFor(() => expect(listAttachmentsMock).toHaveBeenCalled());

      const fileInput = document.body.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["hello"], "hello.txt", { type: "text/plain" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(
        await screen.findByText(`forms.attachments.uploadErrors.${code}`),
      ).toBeInTheDocument();
    },
  );

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

    const dropZone = screen.getByTestId("task-attachments-drop-zone");
    const file = new File(["readonly"], "readonly.txt", {
      type: "text/plain",
    });
    fireEvent.paste(dropZone, {
      clipboardData: makeFileTransfer([file]),
    });
    fireEvent.drop(dropZone, {
      dataTransfer: makeFileTransfer([file]),
    });

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
            title: "Timeline task target",
          },
          eventType: "CREATED",
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
    expect(
      await screen.findByText("common.timeline.event.CREATED"),
    ).toBeInTheDocument();
    expect(screen.getByText("Timeline task target")).toBeInTheDocument();
    expect(screen.queryByText("created the task")).not.toBeInTheDocument();
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

  it("shows an empty traceability section on the detail tab when all relation ids are missing", async () => {
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

    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalled());

    expect(await screen.findByTestId("task-links-section")).toBeInTheDocument();
    expect(
      screen.getByText("taskDetail.links.emptyDescription"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("task-links-tab")).not.toBeInTheDocument();
  });

  it("shows the resolved version name in the detail traceability section when versionId is present", async () => {
    versionMap.set("01ARZ3NDEKTSV4RRFFQ69G5FV1", { name: "Sprint 2026.5" });
    getWorkItemMock.mockResolvedValue(
      makeDetailResponse({
        versionId: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    await waitFor(() => expect(getWorkItemMock).toHaveBeenCalled());
    expect(
      within(await screen.findByTestId("task-links-list")).getByText(
        "Sprint 2026.5",
      ),
    ).toBeInTheDocument();
  });

  it("shows readable relation titles instead of short relation ids in the detail traceability section", async () => {
    relationTitleMap.set(
      "requirement:01ARZ3NDEKTSV4RRFFQ69G5FRQ",
      "Checkout requirement",
    );
    relationTitleMap.set(
      "intake:01ARZ3NDEKTSV4RRFFQ69G5FJ1",
      "Customer intake",
    );
    getWorkItemMock.mockResolvedValue(
      makeDetailResponse({
        requirementId: "01ARZ3NDEKTSV4RRFFQ69G5FRQ",
        intakeItemId: "01ARZ3NDEKTSV4RRFFQ69G5FJ1",
      }),
    );

    render(
      <TaskDetailSheet item={makeViewModel()} open onOpenChange={() => {}} />,
    );

    const list = await screen.findByTestId("task-links-list");
    expect(within(list).getByText("Checkout requirement")).toBeInTheDocument();
    expect(within(list).getByText("Customer intake")).toBeInTheDocument();
    expect(within(list).queryByText("9G5FRQ")).not.toBeInTheDocument();
    expect(within(list).queryByText("9G5FJ1")).not.toBeInTheDocument();
  });

  it("opens linked requirement in a new tab and source intake in a nested drawer", async () => {
    const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FRQ";
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FIN";
    relationTitleMap.set(`requirement:${requirementId}`, "Requirement Alpha");
    relationTitleMap.set(`intake:${intakeItemId}`, "Intake Alpha");
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        requirementId,
        intakeItemId,
      }),
    );
    getIntakeItemMock.mockResolvedValueOnce({
      id: intakeItemId,
      organizationId: "ORG_01",
      spaceId: "SPC_01",
      title: "Loaded nested intake",
      description: "Nested intake detail",
      sourceType: "AD_HOC",
      status: "PENDING",
      priority: "MEDIUM",
      reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    });

    render(
      <TaskDetailSheet
        item={makeViewModel({ title: "Task with links" })}
        open
        onOpenChange={() => {}}
      />,
    );

    const requirementLink = await screen.findByTestId("task-requirement-link");
    expect(requirementLink).toHaveAttribute(
      "href",
      `/requirements/${requirementId}`,
    );
    expect(requirementLink).toHaveAttribute("target", "_blank");
    expect(requirementLink).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(screen.getByTestId("task-intake-link"));

    expect(
      await screen.findByTestId("nested-intake-detail-sheet"),
    ).toHaveTextContent("Loaded nested intake");
    expect(getIntakeItemMock).toHaveBeenCalledWith({
      intakeItemId,
      organizationId: "ORG_01",
      spaceId: "SPC_01",
    });
  });

  it("closes the nested intake drawer when switching parent tasks", async () => {
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5INA";
    relationTitleMap.set(`intake:${intakeItemId}`, "Intake from task A");
    getWorkItemMock.mockImplementation(
      ({ workItemId }: { workItemId: string }) =>
        Promise.resolve(
          makeDetailResponse({
            id: workItemId,
            intakeItemId: workItemId === "TASK_A" ? intakeItemId : undefined,
            title: workItemId === "TASK_A" ? "Parent task A" : "Parent task B",
          }),
        ),
    );
    getIntakeItemMock.mockResolvedValueOnce({
      id: intakeItemId,
      organizationId: "ORG_01",
      spaceId: "SPC_01",
      title: "Nested intake from task A",
      description: "Nested intake detail",
      sourceType: "AD_HOC",
      status: "PENDING",
      priority: "MEDIUM",
      reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    });

    const { rerender } = render(
      <TaskDetailSheet
        item={makeViewModel({ id: "TASK_A", title: "Parent task A" })}
        open
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("task-intake-link"));
    expect(
      await screen.findByTestId("nested-intake-detail-sheet"),
    ).toHaveTextContent("Nested intake from task A");

    rerender(
      <TaskDetailSheet
        item={makeViewModel({ id: "TASK_B", title: "Parent task B" })}
        open
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("nested-intake-detail-sheet"),
      ).not.toBeInTheDocument(),
    );
  });

  it("closes nested drawers when the parent task sheet closes", async () => {
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5INB";
    relationTitleMap.set(`intake:${intakeItemId}`, "Intake from open task");
    getWorkItemMock.mockResolvedValue(
      makeDetailResponse({
        intakeItemId,
      }),
    );
    getIntakeItemMock.mockResolvedValueOnce({
      id: intakeItemId,
      organizationId: "ORG_01",
      spaceId: "SPC_01",
      title: "Nested intake before close",
      description: "Nested intake detail",
      sourceType: "AD_HOC",
      status: "PENDING",
      priority: "MEDIUM",
      reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    });

    const item = makeViewModel({ title: "Parent task" });
    const { rerender } = render(
      <TaskDetailSheet item={item} open onOpenChange={() => {}} />,
    );

    fireEvent.click(await screen.findByTestId("task-intake-link"));
    expect(
      await screen.findByTestId("nested-intake-detail-sheet"),
    ).toHaveTextContent("Nested intake before close");

    rerender(
      <TaskDetailSheet item={item} open={false} onOpenChange={() => {}} />,
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("nested-intake-detail-sheet"),
      ).not.toBeInTheDocument(),
    );
  });

  it("loads bug relation data from the bug detail endpoint in the detail traceability section", async () => {
    versionMap.set("01ARZ3NDEKTSV4RRFFQ69G5FV1", { name: "Bugfix train" });
    relationTitleMap.set(
      "workItem:01ARZ3NDEKTSV4RRFFQ69G5FTK",
      "Related task title",
    );
    getBugMock.mockResolvedValue(
      makeBugResponse({
        bugDetail: {
          relatedTaskId: "01ARZ3NDEKTSV4RRFFQ69G5FTK",
        },
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

    await waitFor(() => expect(getBugMock).toHaveBeenCalled());
    expect(getWorkItemMock).not.toHaveBeenCalled();
    expect(
      within(await screen.findByTestId("task-links-list")).getByText(
        "Bugfix train",
      ),
    ).toBeInTheDocument();
    expect(
      within(await screen.findByTestId("task-links-list")).getByText(
        "Related task title",
      ),
    ).toBeInTheDocument();
  });

  it("opens a bug source intake in a nested intake drawer", async () => {
    const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5BJI";
    relationTitleMap.set(`intake:${intakeItemId}`, "Bug source intake");
    getBugMock.mockResolvedValueOnce(
      makeBugResponse({
        intakeItemId,
      }),
    );
    getIntakeItemMock.mockResolvedValueOnce({
      id: intakeItemId,
      organizationId: "ORG_01",
      spaceId: "SPC_01",
      title: "Loaded bug source intake",
      description: "Bug source intake detail",
      sourceType: "DEFECT_PROBLEM",
      status: "PENDING",
      priority: "HIGH",
      reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FR1",
    });

    render(
      <TaskDetailSheet
        item={makeViewModel({ type: "BUG", title: "Bug with source intake" })}
        open
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("task-intake-link"));

    expect(
      await screen.findByTestId("nested-intake-detail-sheet"),
    ).toHaveTextContent("Loaded bug source intake");
    expect(getIntakeItemMock).toHaveBeenCalledWith({
      intakeItemId,
      organizationId: "ORG_01",
      spaceId: "SPC_01",
    });
  });

  it("opens a bug related task in a nested task sheet", async () => {
    const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5RT1";
    relationTitleMap.set(`workItem:${relatedTaskId}`, "Related task title");
    getBugMock.mockResolvedValueOnce(
      makeBugResponse({
        bugDetail: {
          relatedTaskId,
        },
      }),
    );
    getWorkItemMock.mockResolvedValueOnce(
      makeDetailResponse({
        id: relatedTaskId,
        title: "Nested related task",
      }),
    );

    render(
      <TaskDetailSheet
        item={makeViewModel({ type: "BUG", title: "Bug with related task" })}
        open
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("task-related-task-link"));

    await waitFor(() =>
      expect(getWorkItemMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workItemId: relatedTaskId,
      }),
    );
    expect(await screen.findByText("Nested related task")).toBeInTheDocument();
  });

  it("ignores stale nested task loads after switching parent tasks", async () => {
    const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5STA";
    relationTitleMap.set(`workItem:${relatedTaskId}`, "Task linked from A");
    getBugMock.mockImplementation(({ bugId }: { bugId: string }) =>
      Promise.resolve(
        makeBugResponse({
          id: bugId,
          bugDetail:
            bugId === "BUG_A"
              ? {
                  relatedTaskId,
                }
              : {},
          title: bugId === "BUG_A" ? "Bug A" : "Bug B",
        }),
      ),
    );
    const nestedTask = createDeferred<ReturnType<typeof makeDetailResponse>>();
    getWorkItemMock.mockImplementation(
      ({ workItemId }: { workItemId: string }) =>
        workItemId === relatedTaskId
          ? nestedTask.promise
          : Promise.resolve(makeDetailResponse({ id: workItemId })),
    );

    const { rerender } = render(
      <TaskDetailSheet
        item={makeViewModel({ id: "BUG_A", type: "BUG", title: "Bug A" })}
        open
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(await screen.findByTestId("task-related-task-link"));
    await waitFor(() =>
      expect(getWorkItemMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workItemId: relatedTaskId,
      }),
    );

    rerender(
      <TaskDetailSheet
        item={makeViewModel({ id: "BUG_B", type: "BUG", title: "Bug B" })}
        open
        onOpenChange={() => {}}
      />,
    );

    await act(async () => {
      nestedTask.resolve(
        makeDetailResponse({
          id: relatedTaskId,
          title: "Stale nested task",
        }),
      );
      await Promise.resolve();
    });

    expect(screen.queryByText("Stale nested task")).not.toBeInTheDocument();
  });

  it("ignores stale nested task loads after closing the parent task sheet", async () => {
    const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5STB";
    relationTitleMap.set(
      `workItem:${relatedTaskId}`,
      "Task linked before close",
    );
    getBugMock.mockResolvedValue(
      makeBugResponse({
        id: "BUG_A",
        bugDetail: {
          relatedTaskId,
        },
        title: "Bug A",
      }),
    );
    const nestedTask = createDeferred<ReturnType<typeof makeDetailResponse>>();
    getWorkItemMock.mockImplementation(
      ({ workItemId }: { workItemId: string }) =>
        workItemId === relatedTaskId
          ? nestedTask.promise
          : Promise.resolve(makeDetailResponse({ id: workItemId })),
    );
    const item = makeViewModel({ id: "BUG_A", type: "BUG", title: "Bug A" });

    const { rerender } = render(
      <TaskDetailSheet item={item} open onOpenChange={() => {}} />,
    );

    fireEvent.click(await screen.findByTestId("task-related-task-link"));
    await waitFor(() =>
      expect(getWorkItemMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workItemId: relatedTaskId,
      }),
    );

    rerender(
      <TaskDetailSheet item={item} open={false} onOpenChange={() => {}} />,
    );

    await act(async () => {
      nestedTask.resolve(
        makeDetailResponse({
          id: relatedTaskId,
          title: "Nested task after parent close",
        }),
      );
      await Promise.resolve();
    });

    expect(
      screen.queryByText("Nested task after parent close"),
    ).not.toBeInTheDocument();
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
    listCommentsMock.mockResolvedValue({
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
