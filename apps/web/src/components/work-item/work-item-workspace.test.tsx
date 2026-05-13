// @vitest-environment jsdom

import type {
  AppSession,
  Attachment,
  Comment,
  PageResult,
  Requirement,
  SessionSpaceSummary,
  SpaceRole,
  SpaceMemberWithUser,
  TimelineEvent,
  Version,
  WorkflowActionSummary,
  WorkItem,
  WorkItemDetail,
} from "@project-delivery/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkItemWorkspace } from "./work-item-workspace";

type SessionMockValue = {
  currentSpace: SessionSpaceSummary | undefined;
  session: AppSession | null;
  status: "authenticated" | "loading" | "unauthenticated";
};

const mocks = vi.hoisted(() => ({
  createAttachmentUploadFailure: vi.fn(),
  createComment: vi.fn(),
  createWorkItem: vi.fn(),
  executeAction: vi.fn(),
  getWorkItem: vi.fn(),
  listAttachments: vi.fn(),
  listComments: vi.fn(),
  listRequirementAssignableMembers: vi.fn(),
  listRequirementVersions: vi.fn(),
  listRequirements: vi.fn(),
  listWorkItemTimeline: vi.fn(),
  listWorkItems: vi.fn(),
  sessionValue: {
    currentSpace: undefined,
    session: null,
    status: "loading",
  } as SessionMockValue,
  updateWorkItem: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace?: string) => {
    return (key: string, _values?: Record<string, unknown>) =>
      namespace ? `${namespace}.${key}` : key;
  },
}));

vi.mock("../../i18n/routing", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => mocks.sessionValue,
}));

vi.mock("../../lib/work-item-service", () => ({
  createWorkItem: mocks.createWorkItem,
  getWorkItem: mocks.getWorkItem,
  listWorkItems: mocks.listWorkItems,
  updateWorkItem: mocks.updateWorkItem,
}));

vi.mock("../../lib/action-service", () => ({
  executeAction: mocks.executeAction,
}));

vi.mock("../../lib/requirement-service", () => ({
  listRequirementAssignableMembers: mocks.listRequirementAssignableMembers,
  listRequirementVersions: mocks.listRequirementVersions,
  listRequirements: mocks.listRequirements,
}));

vi.mock("../../lib/comment-service", () => ({
  createComment: mocks.createComment,
  listComments: mocks.listComments,
}));

vi.mock("../../lib/attachment-service", () => ({
  createAttachmentUploadFailure: mocks.createAttachmentUploadFailure,
  listAttachments: mocks.listAttachments,
  uploadAttachment: mocks.uploadAttachment,
}));

vi.mock("../../lib/timeline-service", () => ({
  listWorkItemTimeline: mocks.listWorkItemTimeline,
}));

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5F13";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5F14";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5F15";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const actionId = "01ARZ3NDEKTSV4RRFFQ69G5F17";

describe("WorkItemWorkspace", () => {
  beforeEach(() => {
    mocks.sessionValue = createSession("MEMBER");
    mocks.listWorkItems.mockResolvedValue(page([createWorkItemFixture()]));
    mocks.listRequirementVersions.mockResolvedValue(page([createVersionFixture()]));
    mocks.listRequirements.mockResolvedValue(page([createRequirementFixture()]));
    mocks.listRequirementAssignableMembers.mockResolvedValue(
      page([createMemberFixture(assigneeId), createMemberFixture(reporterId)]),
    );
    mocks.getWorkItem.mockResolvedValue(createWorkItemDetailFixture());
    mocks.executeAction.mockResolvedValue(
      createWorkItemDetailFixture({
        lastActionAt: "2026-05-13T10:10:00.000Z",
        statusCategory: "IN_PROGRESS",
      }),
    );
    mocks.listComments.mockResolvedValue(page<Comment>([]));
    mocks.listAttachments.mockResolvedValue(page<Attachment>([]));
    mocks.listWorkItemTimeline.mockResolvedValue(page<TimelineEvent>([]));
    mocks.createAttachmentUploadFailure.mockReturnValue({
      code: "UPLOAD_FAILED",
      fileName: "evidence.txt",
      retryable: true,
    });
    mocks.uploadAttachment.mockRejectedValue(new Error("upload failed"));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the list with space-scoped filters", async () => {
    render(createElement(WorkItemWorkspace, { spaceId }));

    await screen.findByText("Build task");

    expect(mocks.listWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 100,
        spaceId,
      }),
    );

    fireEvent.change(screen.getByLabelText("workItems.filters.priority"), {
      target: { value: "HIGH" },
    });

    await waitFor(() =>
      expect(mocks.listWorkItems).toHaveBeenLastCalledWith(
        expect.objectContaining({
          priority: "HIGH",
          spaceId,
        }),
      ),
    );
  });

  it("hides write entries for viewer permissions", async () => {
    mocks.sessionValue = createSession("VIEWER");
    mocks.listWorkItems.mockResolvedValue(
      page([createWorkItemFixture({ title: "Read only task" })]),
    );
    mocks.getWorkItem.mockResolvedValue(
      createWorkItemDetailFixture({
        permissions: {
          availableActions: [],
          canComment: false,
          canEdit: false,
          canUploadAttachment: false,
        },
        title: "Read only task",
      }),
    );

    render(createElement(WorkItemWorkspace, { spaceId }));

    await screen.findByText("Read only task");

    expect(screen.queryByText("workItems.create.submit")).toBeNull();

    fireEvent.click(screen.getByText("Read only task").closest("button")!);

    await screen.findByText("workItems.permissions.detailReadonly");

    expect(screen.queryByText("workItems.edit.submit")).toBeNull();
    expect(screen.queryByText("workItems.comments.submit")).toBeNull();
    expect(screen.queryByText("workItems.attachments.upload")).toBeNull();
  });

  it("renders backend available actions and executes dynamic action forms", async () => {
    const action = createActionFixture({
      formFields: [
        {
          fieldType: "TEXT",
          id: "01ARZ3NDEKTSV4RRFFQ69G5F19",
          key: "summary",
          label: "Summary",
          order: 0,
          required: true,
        },
        {
          fieldType: "SELECT",
          id: "01ARZ3NDEKTSV4RRFFQ69G5F1A",
          key: "resolution",
          label: "Resolution",
          options: ["FIXED"],
          order: 1,
          required: true,
        },
      ],
      requiresComment: true,
    });
    mocks.getWorkItem.mockResolvedValue(
      createWorkItemDetailFixture({
        permissions: {
          availableActions: [action],
          canComment: true,
          canEdit: true,
          canUploadAttachment: true,
        },
      }),
    );

    render(createElement(WorkItemWorkspace, { spaceId }));

    await screen.findByText("Build task");
    fireEvent.click(screen.getByText("Build task").closest("button")!);

    await screen.findByText("Start progress");
    fireEvent.click(screen.getByText("Start progress"));
    fireEvent.click(screen.getByText("workItems.workflowActions.submit"));

    await screen.findByText("workItems.workflowActions.errors.commentRequired");

    fireEvent.change(screen.getByLabelText("workItems.workflowActions.comment"), {
      target: { value: "Move forward" },
    });
    const requiredFields = screen.getAllByLabelText(
      "workItems.workflowActions.requiredField",
    );
    fireEvent.change(requiredFields[0], {
      target: { value: "Ready" },
    });
    fireEvent.change(requiredFields[1], {
      target: { value: "FIXED" },
    });
    fireEvent.click(screen.getByText("workItems.workflowActions.submit"));

    await waitFor(() =>
      expect(mocks.executeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: action.id,
          spaceId,
          workItemId,
        }),
        {
          comment: "Move forward",
          formValues: {
            resolution: "FIXED",
            summary: "Ready",
          },
        },
      ),
    );
    await waitFor(() =>
      expect(mocks.listWorkItemTimeline).toHaveBeenCalledTimes(2),
    );
  });

  it("keeps action form input when execution fails", async () => {
    const action = createActionFixture({
      requiresComment: true,
    });
    mocks.getWorkItem.mockResolvedValue(
      createWorkItemDetailFixture({
        permissions: {
          availableActions: [action],
          canComment: true,
          canEdit: true,
          canUploadAttachment: true,
        },
      }),
    );
    mocks.executeAction.mockRejectedValue(new Error("failed"));

    render(createElement(WorkItemWorkspace, { spaceId }));

    await screen.findByText("Build task");
    fireEvent.click(screen.getByText("Build task").closest("button")!);

    await screen.findByText("Start progress");
    fireEvent.click(screen.getByText("Start progress"));
    fireEvent.change(screen.getByLabelText("workItems.workflowActions.comment"), {
      target: { value: "Still needed" },
    });
    fireEvent.click(screen.getByText("workItems.workflowActions.submit"));

    await screen.findByText("errors.api.UNKNOWN");
    expect(
      screen.getByDisplayValue("Still needed"),
    ).toBeTruthy();
  });

  it("shows an empty state when the backend exposes no available actions", async () => {
    render(createElement(WorkItemWorkspace, { spaceId }));

    await screen.findByText("Build task");
    fireEvent.click(screen.getByText("Build task").closest("button")!);

    await screen.findByText("workItems.workflowActions.empty.title");
    expect(screen.queryByText("Start progress")).toBeNull();
  });

  it("renders action timeline lifecycle metadata", async () => {
    mocks.listWorkItemTimeline.mockResolvedValue(
      page([
        createTimelineEventFixture({
          after: {
            currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5F20",
            statusCategory: "DONE",
          },
          before: {
            currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5F18",
            statusCategory: "IN_PROGRESS",
          },
          eventType: "ACTION_EXECUTED",
          metadata: {
            actionCode: "CLOSE",
            actionName: "Close task",
            closedAt: "2026-05-13T10:15:00.000Z",
          },
          title: "Close task",
        }),
      ]),
    );

    render(createElement(WorkItemWorkspace, { spaceId }));

    await screen.findByText("Build task");
    fireEvent.click(screen.getByText("Build task").closest("button")!);

    await screen.findAllByText("Close task");
    expect(screen.getByText("workItems.timeline.metadata.action")).toBeTruthy();
    expect(screen.getByText("CLOSE")).toBeTruthy();
    expect(screen.getByText("DONE")).toBeTruthy();
  });

  it("keeps failed attachment uploads visible and retryable", async () => {
    render(createElement(WorkItemWorkspace, { spaceId }));

    await screen.findByText("Build task");
    fireEvent.click(screen.getByText("Build task").closest("button")!);

    await screen.findByText("workItems.attachments.upload");

    const input = screen.getByLabelText(
      "workItems.attachments.uploadInput",
    ) as HTMLInputElement;
    const file = new File(["evidence"], "evidence.txt", {
      type: "text/plain",
    });

    fireEvent.change(input, {
      target: {
        files: [file],
      },
    });

    await screen.findByText("workItems.uploadErrors.UPLOAD_FAILED");

    fireEvent.click(screen.getByText("workItems.attachments.retry"));

    await waitFor(() => expect(mocks.uploadAttachment).toHaveBeenCalledTimes(2));
    expect(screen.getByText("workItems.uploadErrors.UPLOAD_FAILED")).toBeTruthy();
  });
});

function page<T>(items: T[]): PageResult<T> {
  return {
    items,
    page: 1,
    pageSize: 100,
    total: items.length,
  };
}

function createSession(role: SpaceRole): SessionMockValue {
  const session: AppSession = {
    capabilities: {
      canCreateOrganization: true,
      canCreateSpace: true,
    },
    defaultOrganizationId: organizationId,
    defaultSpaceId: spaceId,
    organizations: [
      {
        code: "ORG",
        id: organizationId,
        name: "Org",
        role: "MEMBER",
        status: "ACTIVE",
      },
    ],
    spaces: [
      {
        code: "SPACE",
        id: spaceId,
        name: "Space",
        organizationId,
        role,
        status: "ACTIVE",
      },
    ],
    user: {
      id: reporterId,
      name: "Reporter",
      preferences: {
        locale: "en-US",
        themeMode: "LIGHT",
      },
      status: "ACTIVE",
      username: "reporter",
    },
  };

  return {
    currentSpace: session.spaces[0],
    session,
    status: "authenticated",
  };
}

function createWorkItemFixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    assigneeId,
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5F17",
    id: workItemId,
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    organizationId,
    priority: "MEDIUM",
    reporterId,
    spaceId,
    statusCategory: "NOT_STARTED",
    title: "Build task",
    type: "TASK",
    versionId,
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5F18",
    ...overrides,
  };
}

function createWorkItemDetailFixture(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    ...createWorkItemFixture(),
    permissions: {
      availableActions: [],
      canComment: true,
      canEdit: true,
      canUploadAttachment: true,
    },
    ...overrides,
  };
}

function createActionFixture(
  overrides: Partial<WorkflowActionSummary> = {},
): WorkflowActionSummary {
  return {
    actorRelations: ["ASSIGNEE"],
    allowedSpaceRoles: ["MEMBER"],
    code: "START_PROGRESS",
    formFields: [],
    fromStateId: "01ARZ3NDEKTSV4RRFFQ69G5F18",
    id: actionId,
    name: "Start progress",
    order: 0,
    requiresComment: false,
    toStateId: "01ARZ3NDEKTSV4RRFFQ69G5F19",
    ...overrides,
  };
}

function createTimelineEventFixture(
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    actor: {
      id: reporterId,
      name: "Reporter",
      username: "reporter",
    },
    createdAt: "2026-05-13T10:15:00.000Z",
    eventType: "UPDATED",
    id: "01ARZ3NDEKTSV4RRFFQ69G5F1B",
    organizationId,
    spaceId,
    target: {
      id: workItemId,
      type: "WORK_ITEM",
    },
    title: "Updated task",
    ...overrides,
  };
}

function createVersionFixture(): Version {
  return {
    description: "Version",
    id: versionId,
    name: "Version 1",
    organizationId,
    ownerId: assigneeId,
    spaceId,
    stats: {
      blockedCount: 0,
      bugCount: 0,
      requirementCount: 1,
      taskCount: 1,
    },
    status: "IN_PROGRESS",
  };
}

function createRequirementFixture(): Requirement {
  return {
    attachments: [],
    contentFormat: "TIPTAP_JSON",
    contentJson: {},
    id: requirementId,
    organizationId,
    ownerId: assigneeId,
    relatedWorkItems: {
      bugCount: 0,
      bugs: [],
      taskCount: 1,
      tasks: [],
    },
    spaceId,
    status: "CONFIRMED",
    summary: "Requirement",
    title: "Requirement 1",
    versionId,
  };
}

function createMemberFixture(userId: string): SpaceMemberWithUser {
  return {
    id: userId,
    organizationId,
    role: "MEMBER",
    spaceId,
    status: "ACTIVE",
    user: {
      id: userId,
      name: `Member ${userId.slice(-2)}`,
      status: "ACTIVE",
      username: `member-${userId.slice(-2)}`,
    },
    userId,
  };
}
