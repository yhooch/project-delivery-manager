import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BugView } from "@project-delivery/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));

const {
  listRequirementsMock,
  listSpaceMembersMock,
  listVersionsMock,
  listWorkItemsMock,
  updateBugMock,
} = vi.hoisted(() => ({
  listRequirementsMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  listVersionsMock: vi.fn(),
  listWorkItemsMock: vi.fn(),
  updateBugMock: vi.fn(),
}));

vi.mock("../../lib/bug-service", () => ({
  updateBug: updateBugMock,
}));
vi.mock("../../lib/requirement-service", () => ({
  listRequirements: listRequirementsMock,
}));
vi.mock("../../lib/space-service", () => ({
  listSpaceMembers: listSpaceMembersMock,
}));
vi.mock("../../lib/version-service", () => ({
  listVersions: listVersionsMock,
}));
vi.mock("../../lib/work-item-service", () => ({
  listWorkItems: listWorkItemsMock,
}));

import { EditBugDialog } from "./edit-bug-dialog";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const bugId = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const nextVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FT1";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FA2";

function makeBug(overrides: Partial<BugView> = {}): BugView {
  return {
    id: bugId,
    type: "BUG",
    organizationId,
    spaceId,
    title: "Original bug",
    description: "Original description",
    priority: "MEDIUM",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FRP",
    workflowVersionId: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
    currentStateId: "01ARZ3NDEKTSV4RRFFQ69G5FCS",
    statusCategory: "IN_PROGRESS",
    lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
    assigneeId,
    requirementId,
    versionId,
    bugDetail: {
      workItemId: bugId,
      severity: "MAJOR",
      stepsToReproduce: "Open login",
      expectedResult: "Login works",
      actualResult: "Page crashes",
      relatedTaskId,
    },
    ...overrides,
  } as BugView;
}

beforeEach(() => {
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();
  listWorkItemsMock.mockReset();
  updateBugMock.mockReset();
  listVersionsMock.mockResolvedValue({
    items: [
      { id: versionId, name: "v1" },
      { id: nextVersionId, name: "v2" },
    ],
    total: 2,
  });
  listRequirementsMock.mockResolvedValue({
    items: [{ id: requirementId, title: "Requirement 1" }],
    total: 1,
  });
  listWorkItemsMock.mockResolvedValue({
    items: [{ id: relatedTaskId, title: "Task 1" }],
    total: 1,
  });
  listSpaceMembersMock.mockResolvedValue({
    items: [
      {
        userId: assigneeId,
        user: { name: "Alice", username: "alice" },
      },
    ],
    total: 1,
  });
  updateBugMock.mockResolvedValue(makeBug({ title: "Updated bug" }));
});

afterEach(() => {
  cleanup();
});

describe("EditBugDialog", () => {
  it("submits editable bug fields through updateBug", async () => {
    const onUpdated = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <EditBugDialog
        bug={makeBug()}
        open
        onOpenChange={onOpenChange}
        organizationId={organizationId}
        spaceId={spaceId}
        onUpdated={onUpdated}
      />,
    );

    await screen.findByText("v2");
    await screen.findByText("Requirement 1");
    await screen.findByText("Task 1");

    fireEvent.change(screen.getByTestId("edit-bug-title-input"), {
      target: { value: "Updated bug" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-description-input"), {
      target: { value: "Updated description" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-steps-input"), {
      target: { value: "Step one" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-expected-input"), {
      target: { value: "Expected" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-actual-input"), {
      target: { value: "Actual" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-severity-select"), {
      target: { value: "CRITICAL" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-priority-select"), {
      target: { value: "URGENT" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-version-select"), {
      target: { value: nextVersionId },
    });
    fireEvent.change(screen.getByTestId("edit-bug-duedate-input"), {
      target: { value: "2026-05-20" },
    });
    fireEvent.click(screen.getByTestId("edit-bug-submit"));

    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(1));
    expect(updateBugMock).toHaveBeenCalledWith(
      { bugId, organizationId, spaceId },
      expect.objectContaining({
        actualResult: "Actual",
        description: "Updated description",
        expectedResult: "Expected",
        priority: "URGENT",
        relatedTaskId,
        requirementId,
        severity: "CRITICAL",
        stepsToReproduce: "Step one",
        title: "Updated bug",
        versionId: nextVersionId,
      }),
    );
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Updated bug" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits nulls when optional bug fields are cleared", async () => {
    render(
      <EditBugDialog
        bug={makeBug({ dueDate: "2026-05-15T00:00:00.000Z" })}
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByText("v1");

    fireEvent.change(screen.getByTestId("edit-bug-description-input"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-version-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-requirement-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-related-task-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-assignee-select"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-bug-duedate-input"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("edit-bug-submit"));

    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(1));
    expect(updateBugMock).toHaveBeenCalledWith(
      { bugId, organizationId, spaceId },
      expect.objectContaining({
        assigneeId: null,
        description: null,
        dueDate: null,
        relatedTaskId: null,
        requirementId: null,
        versionId: null,
      }),
    );
  });
});
