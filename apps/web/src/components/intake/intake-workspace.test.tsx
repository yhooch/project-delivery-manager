// @vitest-environment jsdom

import type {
  AppSession,
  Comment,
  IntakeItem,
  PageResult,
  Requirement,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  SpaceRole,
  TimelineEvent,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntakeWorkspace } from "./intake-workspace";

type SessionMockValue = {
  currentSpace: SessionSpaceSummary | undefined;
  session: AppSession | null;
  status: "authenticated" | "loading" | "unauthenticated";
};

const mocks = vi.hoisted(() => ({
  acceptIntakeItem: vi.fn(),
  convertIntakeItemToWorkItems: vi.fn(),
  createComment: vi.fn(),
  createIntakeItem: vi.fn(),
  deferIntakeItem: vi.fn(),
  getIntakeItem: vi.fn(),
  listComments: vi.fn(),
  listIntakeItems: vi.fn(),
  listRequirementAssignableMembers: vi.fn(),
  listRequirementVersions: vi.fn(),
  listRequirements: vi.fn(),
  listTimeline: vi.fn(),
  listWorkItems: vi.fn(),
  rejectIntakeItem: vi.fn(),
  sessionValue: {
    currentSpace: undefined,
    session: null,
    status: "loading",
  } as SessionMockValue,
  updateIntakeItem: vi.fn(),
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

vi.mock("../../lib/intake-service", () => ({
  acceptIntakeItem: mocks.acceptIntakeItem,
  convertIntakeItemToWorkItems: mocks.convertIntakeItemToWorkItems,
  createIntakeItem: mocks.createIntakeItem,
  deferIntakeItem: mocks.deferIntakeItem,
  getIntakeItem: mocks.getIntakeItem,
  listIntakeItems: mocks.listIntakeItems,
  rejectIntakeItem: mocks.rejectIntakeItem,
  updateIntakeItem: mocks.updateIntakeItem,
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

vi.mock("../../lib/timeline-service", () => ({
  listTimeline: mocks.listTimeline,
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
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5F17";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5F18";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5F19";

describe("IntakeWorkspace", () => {
  beforeEach(() => {
    mocks.sessionValue = createSession("MEMBER");
    mocks.listIntakeItems.mockResolvedValue(page([createIntakeFixture()]));
    mocks.listRequirementVersions.mockResolvedValue(page([createVersionFixture()]));
    mocks.listRequirements.mockResolvedValue(page([createRequirementFixture()]));
    mocks.listRequirementAssignableMembers.mockResolvedValue(
      page([createMemberFixture(assigneeId), createMemberFixture(reporterId)]),
    );
    mocks.getIntakeItem.mockResolvedValue(createIntakeFixture());
    mocks.listComments.mockResolvedValue(page<Comment>([]));
    mocks.listTimeline.mockResolvedValue(page<TimelineEvent>([]));
    mocks.listWorkItems.mockResolvedValue(page<WorkItem>([]));
    mocks.acceptIntakeItem.mockResolvedValue(
      createIntakeFixture({
        acceptedAt: "2026-05-13T10:10:00.000Z",
        status: "ACCEPTED",
      }),
    );
    mocks.createComment.mockResolvedValue(createCommentFixture());
    mocks.convertIntakeItemToWorkItems.mockResolvedValue({
      intakeItemId,
      workItems: [createWorkItemFixture()],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the list with space-scoped filters", async () => {
    render(createElement(IntakeWorkspace, { spaceId }));

    await screen.findByText("Checkout scope follow-up");

    expect(mocks.listIntakeItems).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 100,
        spaceId,
      }),
    );

    fireEvent.change(screen.getByLabelText("intakeItems.filters.priority"), {
      target: { value: "HIGH" },
    });

    await waitFor(() =>
      expect(mocks.listIntakeItems).toHaveBeenLastCalledWith(
        expect.objectContaining({
          priority: "HIGH",
          spaceId,
        }),
      ),
    );
  });

  it("runs status actions through the intake API", async () => {
    render(createElement(IntakeWorkspace, { spaceId }));

    await screen.findByText("Checkout scope follow-up");
    fireEvent.click(
      screen.getByText("Checkout scope follow-up").closest("button")!,
    );

    await screen.findByText("intakeItems.statusActions.accept");

    fireEvent.click(screen.getByText("intakeItems.statusActions.accept"));

    await waitFor(() =>
      expect(mocks.acceptIntakeItem).toHaveBeenCalledWith(
        expect.objectContaining({
          intakeItemId,
          spaceId,
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getAllByText("intakeItems.status.ACCEPTED").length).toBeGreaterThan(
        1,
      ),
    );
  });

  it("converts an accepted item into multiple tasks and refreshes related data", async () => {
    const accepted = createIntakeFixture({
      acceptedAt: "2026-05-13T10:10:00.000Z",
      status: "ACCEPTED",
    });
    const converted = createIntakeFixture({
      convertedAt: "2026-05-13T10:30:00.000Z",
      status: "CONVERTED",
    });
    mocks.listIntakeItems.mockResolvedValue(page([accepted]));
    mocks.getIntakeItem
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce(converted);
    mocks.listWorkItems
      .mockResolvedValueOnce(page<WorkItem>([]))
      .mockResolvedValueOnce(
        page([
          createWorkItemFixture({ title: "Implement checkout scope" }),
          createWorkItemFixture({
            id: "01ARZ3NDEKTSV4RRFFQ69G5F1A",
            title: "Verify checkout scope",
          }),
        ]),
      );

    render(createElement(IntakeWorkspace, { spaceId }));

    await screen.findByText("Checkout scope follow-up");
    fireEvent.click(
      screen.getByText("Checkout scope follow-up").closest("button")!,
    );

    await screen.findByText("intakeItems.convert.submit");

    const titleInputs = screen.getAllByLabelText("intakeItems.taskForm.title");
    fireEvent.change(titleInputs[0], {
      target: { value: "Implement checkout scope" },
    });
    fireEvent.click(screen.getByText("intakeItems.convert.addTask"));

    const nextTitleInputs = screen.getAllByLabelText(
      "intakeItems.taskForm.title",
    );
    fireEvent.change(nextTitleInputs[1], {
      target: { value: "Verify checkout scope" },
    });

    fireEvent.click(screen.getByText("intakeItems.convert.submit"));

    await waitFor(() =>
      expect(mocks.convertIntakeItemToWorkItems).toHaveBeenCalledWith(
        expect.objectContaining({
          intakeItemId,
          spaceId,
        }),
        expect.objectContaining({
          tasks: [
            expect.objectContaining({
              title: "Implement checkout scope",
            }),
            expect.objectContaining({
              title: "Verify checkout scope",
            }),
          ],
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.listWorkItems).toHaveBeenLastCalledWith(
        expect.objectContaining({
          intakeItemId,
          spaceId,
        }),
      ),
    );
    expect(await screen.findByText("Verify checkout scope")).toBeTruthy();
  });

  it("disables breakdown for converted items with a localized hint", async () => {
    const converted = createIntakeFixture({
      convertedAt: "2026-05-13T10:30:00.000Z",
      status: "CONVERTED",
    });
    mocks.listIntakeItems.mockResolvedValue(page([converted]));
    mocks.getIntakeItem.mockResolvedValue(converted);

    render(createElement(IntakeWorkspace, { spaceId }));

    await screen.findByText("Checkout scope follow-up");
    fireEvent.click(
      screen.getByText("Checkout scope follow-up").closest("button")!,
    );

    await screen.findByText("intakeItems.convert.alreadyConverted");

    const submitButton = screen
      .getByText("intakeItems.convert.submit")
      .closest("button");

    expect(submitButton?.hasAttribute("disabled")).toBe(true);
  });

  it("renders comments and timeline, then posts a comment to the intake target", async () => {
    mocks.listComments.mockResolvedValue(page([createCommentFixture()]));
    mocks.listTimeline.mockResolvedValue(page([createTimelineFixture()]));

    render(createElement(IntakeWorkspace, { spaceId }));

    await screen.findByText("Checkout scope follow-up");
    fireEvent.click(
      screen.getByText("Checkout scope follow-up").closest("button")!,
    );

    await screen.findByText("Looks good");
    await screen.findByText("Intake created");

    fireEvent.change(screen.getByLabelText("intakeItems.comments.body"), {
      target: { value: "Please split into two tasks" },
    });
    fireEvent.click(screen.getByText("intakeItems.comments.submit"));

    await waitFor(() =>
      expect(mocks.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "Please split into two tasks",
          spaceId,
          targetId: intakeItemId,
          targetType: "INTAKE_ITEM",
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

function createIntakeFixture(overrides: Partial<IntakeItem> = {}): IntakeItem {
  return {
    assigneeId,
    description: "Follow up checkout scope",
    id: intakeItemId,
    organizationId,
    priority: "HIGH",
    reporterId,
    requirementId,
    sourceObject: {
      meetingId: "m-1",
    },
    sourceType: "MEETING_DECISION",
    spaceId,
    status: "PENDING",
    title: "Checkout scope follow-up",
    versionId,
    ...overrides,
  };
}

function createWorkItemFixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    assigneeId,
    currentStateId: stateId,
    id: workItemId,
    intakeItemId,
    lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
    organizationId,
    priority: "HIGH",
    reporterId,
    requirementId,
    spaceId,
    statusCategory: "NOT_STARTED",
    title: "Implement checkout scope",
    type: "TASK",
    versionId,
    workflowVersionId,
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

function createCommentFixture(overrides: Partial<Comment> = {}): Comment {
  return {
    author: {
      id: reporterId,
      name: "Reporter",
      username: "reporter",
    },
    body: "Looks good",
    createdAt: "2026-05-13T10:20:00.000Z",
    id: "01ARZ3NDEKTSV4RRFFQ69G5F1B",
    organizationId,
    spaceId,
    targetId: intakeItemId,
    targetType: "INTAKE_ITEM",
    ...overrides,
  };
}

function createTimelineFixture(
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    actor: {
      id: reporterId,
      name: "Reporter",
      username: "reporter",
    },
    createdAt: "2026-05-13T10:20:00.000Z",
    eventType: "CREATED",
    id: "01ARZ3NDEKTSV4RRFFQ69G5F1C",
    organizationId,
    spaceId,
    target: {
      id: intakeItemId,
      title: "Checkout scope follow-up",
      type: "INTAKE_ITEM",
    },
    title: "Intake created",
    ...overrides,
  };
}
