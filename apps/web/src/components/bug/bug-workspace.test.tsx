// @vitest-environment jsdom

import type {
  AppSession,
  Attachment,
  BugView,
  Comment,
  PageResult,
  Requirement,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  SpaceRole,
  TimelineEvent,
  Version,
  WorkItem,
  WorkItemDetail,
  WorkflowActionSummary,
} from "@project-delivery/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BugWorkspace } from "./bug-workspace";

type SessionMockValue = {
  currentSpace: SessionSpaceSummary | undefined;
  session: AppSession | null;
  status: "authenticated" | "loading" | "unauthenticated";
};

const mocks = vi.hoisted(() => ({
  createAttachmentUploadFailure: vi.fn(),
  createBug: vi.fn(),
  createComment: vi.fn(),
  executeAction: vi.fn(),
  getBug: vi.fn(),
  listAttachments: vi.fn(),
  listBugs: vi.fn(),
  listComments: vi.fn(),
  listRequirementAssignableMembers: vi.fn(),
  listRequirementVersions: vi.fn(),
  listRequirements: vi.fn(),
  listWorkItems: vi.fn(),
  listWorkItemTimeline: vi.fn(),
  sessionValue: {
    currentSpace: undefined,
    session: null,
    status: "loading",
  } as SessionMockValue,
  updateBug: vi.fn(),
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

vi.mock("../../lib/bug-service", () => ({
  createBug: mocks.createBug,
  getBug: mocks.getBug,
  listBugs: mocks.listBugs,
  updateBug: mocks.updateBug,
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

vi.mock("../../lib/work-item-service", () => ({
  listWorkItems: mocks.listWorkItems,
}));

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5F13";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5F14";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5F15";
const bugId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const taskId = "01ARZ3NDEKTSV4RRFFQ69G5F17";
const actionId = "01ARZ3NDEKTSV4RRFFQ69G5F18";

describe("BugWorkspace", () => {
  beforeEach(() => {
    mocks.sessionValue = createSession("MEMBER");
    mocks.listBugs.mockResolvedValue(page([createBugFixture()]));
    mocks.listRequirementVersions.mockResolvedValue(page([createVersionFixture()]));
    mocks.listRequirements.mockResolvedValue(page([createRequirementFixture()]));
    mocks.listRequirementAssignableMembers.mockResolvedValue(
      page([createMemberFixture(assigneeId), createMemberFixture(reporterId)]),
    );
    mocks.listWorkItems.mockResolvedValue(page([createTaskFixture()]));
    mocks.getBug.mockResolvedValue(createBugFixture());
    mocks.listComments.mockResolvedValue(page<Comment>([]));
    mocks.listAttachments.mockResolvedValue(page<Attachment>([]));
    mocks.listWorkItemTimeline.mockResolvedValue(page<TimelineEvent>([]));
    mocks.createBug.mockResolvedValue(
      createBugFixture({
        id: "01ARZ3NDEKTSV4RRFFQ69G5F19",
        title: "New bug",
      }),
    );
    mocks.updateBug.mockResolvedValue(
      createBugFixture({
        title: "Updated bug",
      }),
    );
    mocks.executeAction.mockResolvedValue(createWorkItemDetailFixture());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the list with bug-specific filters", async () => {
    render(createElement(BugWorkspace, { spaceId }));

    await screen.findByText("Crash on checkout");

    expect(mocks.listBugs).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 100,
        spaceId,
      }),
    );

    fireEvent.change(screen.getByLabelText("bugs.filters.severity"), {
      target: { value: "CRITICAL" },
    });

    await waitFor(() =>
      expect(mocks.listBugs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          severity: "CRITICAL",
          spaceId,
        }),
      ),
    );
  });

  it("creates a bug and opens the returned work item id", async () => {
    render(createElement(BugWorkspace, { spaceId }));

    await screen.findByText("Crash on checkout");

    fireEvent.change(screen.getByLabelText("bugs.form.title"), {
      target: { value: "New bug" },
    });
    fireEvent.change(screen.getByLabelText("bugs.form.severity"), {
      target: { value: "BLOCKER" },
    });
    fireEvent.click(screen.getByText("bugs.create.submit"));

    await waitFor(() =>
      expect(mocks.createBug).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId }),
        expect.objectContaining({
          severity: "BLOCKER",
          title: "New bug",
        }),
      ),
    );
    expect(mocks.getBug).toHaveBeenCalledWith(
      expect.objectContaining({
        bugId: "01ARZ3NDEKTSV4RRFFQ69G5F19",
        spaceId,
      }),
    );
  });

  it("shows readonly and action empty states when permissions do not allow writes", async () => {
    mocks.sessionValue = createSession("VIEWER");
    mocks.getBug.mockResolvedValue(
      createBugFixture({
        permissions: {
          availableActions: [],
          canComment: false,
          canEdit: false,
          canUploadAttachment: false,
        },
      }),
    );

    render(createElement(BugWorkspace, { spaceId }));

    await screen.findByText("Crash on checkout");
    fireEvent.click(screen.getByText("Crash on checkout").closest("button")!);

    await screen.findByText("bugs.workflowActions.empty.title");

    expect(screen.queryByText("bugs.create.submit")).toBeNull();
    expect(screen.queryByText("bugs.edit.submit")).toBeNull();
    expect(screen.queryByText("bugs.comments.submit")).toBeNull();
    expect(screen.queryByText("bugs.attachments.upload")).toBeNull();
  });

  it("edits bug fields from the detail drawer", async () => {
    render(createElement(BugWorkspace, { spaceId }));

    await screen.findByText("Crash on checkout");
    fireEvent.click(screen.getByText("Crash on checkout").closest("button")!);

    await screen.findByText("bugs.edit.submit");

    fireEvent.change(screen.getAllByLabelText("bugs.form.title")[1], {
      target: { value: "Updated bug" },
    });
    fireEvent.click(screen.getByText("bugs.edit.submit"));

    await waitFor(() =>
      expect(mocks.updateBug).toHaveBeenCalledWith(
        expect.objectContaining({
          bugId,
          spaceId,
        }),
        expect.objectContaining({
          title: "Updated bug",
        }),
      ),
    );
  });

  it("executes an available workflow action", async () => {
    render(createElement(BugWorkspace, { spaceId }));

    await screen.findByText("Crash on checkout");
    fireEvent.click(screen.getByText("Crash on checkout").closest("button")!);

    await screen.findByText("Start fix");
    fireEvent.click(screen.getByText("Start fix"));
    fireEvent.click(screen.getByText("bugs.workflowActions.submit"));

    await waitFor(() =>
      expect(mocks.executeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId,
          workItemId: bugId,
        }),
        expect.objectContaining({
          formValues: {},
        }),
      ),
    );
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

function createBugFixture(overrides: Partial<BugView> = {}): BugView {
  return {
    assigneeId,
    bugDetail: {
      actualResult: "500 page",
      expectedResult: "Order created",
      relatedTaskId: taskId,
      severity: "MAJOR",
      stepsToReproduce: "Submit checkout form",
      workItemId: bugId,
    },
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5F1A",
    id: bugId,
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    organizationId,
    permissions: {
      availableActions: [createActionFixture()],
      canComment: true,
      canEdit: true,
      canUploadAttachment: true,
    },
    priority: "HIGH",
    reporterId,
    requirementId,
    spaceId,
    statusCategory: "NOT_STARTED",
    title: "Crash on checkout",
    type: "BUG",
    versionId,
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5F1B",
    ...overrides,
  };
}

function createActionFixture(): WorkflowActionSummary {
  return {
    actorRelations: ["ASSIGNEE"],
    allowedSpaceRoles: ["MEMBER"],
    code: "START_FIX",
    formFields: [],
    fromStateId: "01ARZ3NDEKTSV4RRFFQ69G5F1A",
    id: actionId,
    name: "Start fix",
    order: 1,
    requiresComment: false,
    toStateId: "01ARZ3NDEKTSV4RRFFQ69G5F1C",
  };
}

function createWorkItemDetailFixture(): WorkItemDetail {
  const bug = createBugFixture();

  return {
    assigneeId: bug.assigneeId,
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5F1C",
    id: bug.id,
    lastStatusChangedAt: "2026-05-13T10:10:00.000Z",
    organizationId,
    permissions: {
      availableActions: [],
      canComment: true,
      canEdit: true,
      canUploadAttachment: true,
    },
    priority: bug.priority,
    reporterId,
    requirementId,
    spaceId,
    statusCategory: "IN_PROGRESS",
    title: bug.title,
    type: "BUG",
    versionId,
    workflowVersionId: bug.workflowVersionId,
  };
}

function createTaskFixture(): WorkItem {
  return {
    assigneeId,
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5F1D",
    id: taskId,
    lastStatusChangedAt: "2026-05-13T09:00:00.000Z",
    organizationId,
    priority: "MEDIUM",
    reporterId,
    requirementId,
    spaceId,
    statusCategory: "IN_PROGRESS",
    title: "Checkout task",
    type: "TASK",
    versionId,
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5F1E",
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
      bugCount: 1,
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
      bugCount: 1,
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
