import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { BugView } from "@project-delivery/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<string, (key: string) => string>(),
}));

function getSelectOptionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.options, (option) => option.textContent ?? "");
}

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
import { ApiClientError } from "../../lib/api-client";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const bugId = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const nextVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FT1";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FA2";
const regressionById = "01ARZ3NDEKTSV4RRFFQ69G5FA3";

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
      fixNote: "Patch validation",
      regressionResult: "Pending regression",
      regressionBy: regressionById,
      regressionAt: "2026-05-10T10:00:00.000Z",
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
    items: [{ id: requirementId, title: "Requirement 1", versionId }],
    total: 1,
  });
  listWorkItemsMock.mockResolvedValue({
    items: [{ id: relatedTaskId, title: "Task 1", versionId }],
    total: 1,
  });
  listSpaceMembersMock.mockResolvedValue({
    items: [
      {
        userId: assigneeId,
        user: { name: "Alice", username: "alice" },
      },
      {
        userId: regressionById,
        user: { name: "Bob", username: "bob" },
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
    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId(
            "edit-bug-requirement-select",
          ) as HTMLSelectElement,
        ),
      ).toContain("Requirement 1"),
    );
    expect(
      getSelectOptionLabels(
        screen.getByTestId("edit-bug-related-task-select") as HTMLSelectElement,
      ),
    ).toContain("Task 1");
    expect(listSpaceMembersMock).toHaveBeenCalledWith(spaceId, {
      status: "ACTIVE",
    });

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
        relatedTaskId: null,
        requirementId: null,
        severity: "CRITICAL",
        stepsToReproduce: "Step one",
        title: "Updated bug",
        versionId: nextVersionId,
      }),
    );
    expect(updateBugMock.mock.calls[0]![1]).not.toHaveProperty("fixNote");
    expect(updateBugMock.mock.calls[0]![1]).not.toHaveProperty("regressionAt");
    expect(updateBugMock.mock.calls[0]![1]).not.toHaveProperty("regressionBy");
    expect(updateBugMock.mock.calls[0]![1]).not.toHaveProperty(
      "regressionResult",
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

    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId("edit-bug-version-select") as HTMLSelectElement,
        ),
      ).toContain("v1"),
    );

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
    expect(updateBugMock.mock.calls[0]![1]).not.toHaveProperty("fixNote");
    expect(updateBugMock.mock.calls[0]![1]).not.toHaveProperty("regressionAt");
    expect(updateBugMock.mock.calls[0]![1]).not.toHaveProperty("regressionBy");
    expect(updateBugMock.mock.calls[0]![1]).not.toHaveProperty(
      "regressionResult",
    );
  });

  it("shows an option load error, keeps base submit enabled, and retries", async () => {
    listVersionsMock.mockRejectedValueOnce(new Error("network"));

    render(
      <EditBugDialog
        bug={makeBug()}
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    expect(
      await screen.findByTestId("edit-bug-options-error"),
    ).toHaveTextContent("common.states.optionsLoadFailed");
    expect(screen.getByTestId("edit-bug-version-select")).toBeDisabled();
    expect(screen.getByTestId("edit-bug-submit")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("edit-bug-options-retry"));

    await screen.findByText("v2");
    await waitFor(() =>
      expect(screen.getByTestId("edit-bug-submit")).not.toBeDisabled(),
    );
    expect(listVersionsMock).toHaveBeenCalledTimes(2);
  });

  it("submits base bug edits when optional lookups fail", async () => {
    listVersionsMock.mockRejectedValueOnce(new Error("network"));

    render(
      <EditBugDialog
        bug={makeBug()}
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByTestId("edit-bug-options-error");
    fireEvent.change(screen.getByTestId("edit-bug-title-input"), {
      target: { value: "Fallback edit" },
    });
    fireEvent.click(screen.getByTestId("edit-bug-submit"));

    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(1));
    expect(updateBugMock).toHaveBeenCalledWith(
      { bugId, organizationId, spaceId },
      expect.objectContaining({ title: "Fallback edit" }),
    );
  });

  it("clears incompatible trace fields when the version changes", async () => {
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        { id: requirementId, title: "Requirement 1", versionId },
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FR2",
          title: "Requirement 2",
          versionId: nextVersionId,
        },
      ],
      total: 2,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        { id: relatedTaskId, title: "Task 1", versionId },
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FT2",
          title: "Task 2",
          versionId: nextVersionId,
        },
      ],
      total: 2,
    });

    render(
      <EditBugDialog
        bug={makeBug()}
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const requirementSelect = screen.getByTestId(
      "edit-bug-requirement-select",
    ) as HTMLSelectElement;
    const relatedTaskSelect = screen.getByTestId(
      "edit-bug-related-task-select",
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(getSelectOptionLabels(relatedTaskSelect)).toContain("Task 1"),
    );

    fireEvent.change(screen.getByTestId("edit-bug-version-select"), {
      target: { value: nextVersionId },
    });

    await waitFor(() => expect(requirementSelect.value).toBe(""));
    expect(relatedTaskSelect.value).toBe("");
    expect(getSelectOptionLabels(requirementSelect)).toContain("Requirement 2");
    expect(getSelectOptionLabels(requirementSelect)).not.toContain(
      "Requirement 1",
    );
    expect(getSelectOptionLabels(relatedTaskSelect)).toContain("Task 2");
    expect(getSelectOptionLabels(relatedTaskSelect)).not.toContain("Task 1");
  });

  it("shows a localized trace conflict error from updateBug", async () => {
    updateBugMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "TRACE_VERSION_CONFLICT",
          message: "Version differs from linked trace object",
          requestId: "REQ_TRACE",
        },
        new Response(null, { status: 409, statusText: "Conflict" }),
      ),
    );

    render(
      <EditBugDialog
        bug={makeBug()}
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId(
            "edit-bug-requirement-select",
          ) as HTMLSelectElement,
        ),
      ).toContain("Requirement 1"),
    );
    fireEvent.click(screen.getByTestId("edit-bug-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.api.TRACE_VERSION_CONFLICT",
    );
  });

  it("confirms and retries bug save when version cascade is required", async () => {
    updateBugMock
      .mockRejectedValueOnce(
        new ApiClientError(
          {
            code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
            message: "Bug version change requires cascade",
            requestId: "REQ_TRACE",
            details: {
              targetType: "TASK",
              targetId: bugId,
              fromVersionId: versionId,
              toVersionId: nextVersionId,
              impact: {
                bugCount: 1,
                bugIds: ["01ARZ3NDEKTSV4RRFFQ69G5FB2"],
                relatedBugCount: 0,
                workItemCount: 0,
              },
            },
          },
          new Response(null, { status: 409, statusText: "Conflict" }),
        ),
      )
      .mockResolvedValueOnce(makeBug({ versionId: nextVersionId }));
    const onUpdated = vi.fn();

    render(
      <EditBugDialog
        bug={makeBug()}
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        onUpdated={onUpdated}
      />,
    );

    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId("edit-bug-version-select") as HTMLSelectElement,
        ),
      ).toContain("v2"),
    );
    fireEvent.change(screen.getByTestId("edit-bug-version-select"), {
      target: { value: nextVersionId },
    });
    fireEvent.click(screen.getByTestId("edit-bug-submit"));

    const confirmDialog = await screen.findByTestId(
      "trace-version-cascade-confirm-dialog",
    );
    expect(confirmDialog).toHaveTextContent(
      "errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
    );
    expect(confirmDialog).toHaveTextContent(
      "traceVersionCascadeConfirm.scopeTitle",
    );
    expect(confirmDialog).toHaveTextContent(bugId);
    expect(confirmDialog).toHaveTextContent("01ARZ3NDEKTSV4RRFFQ69G5FB2");
    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(1));
    expect(updateBugMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.not.objectContaining({ cascadeVersionChange: true }),
    );

    fireEvent.click(screen.getByTestId("trace-version-cascade-confirm"));

    await waitFor(() => expect(updateBugMock).toHaveBeenCalledTimes(2));
    expect(updateBugMock).toHaveBeenLastCalledWith(
      { bugId, organizationId, spaceId },
      expect.objectContaining({ cascadeVersionChange: true }),
    );
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: nextVersionId }),
    );
  });

  it("infers a missing version and requirement from the selected related task", async () => {
    const versionedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FT2";
    const versionedRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        {
          id: versionedRequirementId,
          title: "Requirement 2",
          versionId: nextVersionId,
        },
      ],
      total: 1,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        { id: relatedTaskId, title: "Task 1", versionId },
        {
          id: versionedTaskId,
          title: "Task 2",
          requirementId: versionedRequirementId,
          versionId: nextVersionId,
        },
      ],
      total: 2,
    });

    render(
      <EditBugDialog
        bug={makeBug({
          requirementId: undefined,
          versionId: undefined,
          bugDetail: {
            ...makeBug().bugDetail,
            relatedTaskId: undefined,
          },
        })}
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const versionSelect = screen.getByTestId(
      "edit-bug-version-select",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "edit-bug-requirement-select",
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(
        getSelectOptionLabels(
          screen.getByTestId(
            "edit-bug-related-task-select",
          ) as HTMLSelectElement,
        ),
      ).toContain("Task 2"),
    );

    fireEvent.change(screen.getByTestId("edit-bug-related-task-select"), {
      target: { value: versionedTaskId },
    });

    await waitFor(() => expect(versionSelect.value).toBe(nextVersionId));
    expect(requirementSelect.value).toBe(versionedRequirementId);
  });
});
