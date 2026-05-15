import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) =>
    (key: string) => (namespace ? `${namespace}.${key}` : key),
}));

vi.mock("../providers/session-provider", () => ({
  useSession: () => ({
    currentOrganization: { id: "ORG_01" },
    session: { defaultOrganizationId: "ORG_01" },
  }),
}));

const {
  convertIntakeItemToWorkItemsMock,
  listRequirementsMock,
  listSpaceMembersMock,
  listVersionsMock,
  listWorkflowBindingsMock,
  listWorkflowsMock,
} = vi.hoisted(() => ({
  convertIntakeItemToWorkItemsMock: vi.fn(),
  listRequirementsMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  listVersionsMock: vi.fn(),
  listWorkflowBindingsMock: vi.fn(),
  listWorkflowsMock: vi.fn(),
}));

vi.mock("../../lib/intake-service", () => ({
  convertIntakeItemToWorkItems: convertIntakeItemToWorkItemsMock,
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
vi.mock("../../lib/workflow-service", () => ({
  listWorkflowBindings: listWorkflowBindingsMock,
  listWorkflows: listWorkflowsMock,
}));

import type {
  IntakeItem,
  Requirement,
  SpaceMemberWithUser,
  Version,
  WorkflowBinding,
  WorkflowDefinition,
} from "@project-delivery/shared";

import { ConvertIntakeDialog } from "./convert-intake-dialog";

const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const organizationId = "ORG_01";
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FI1";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
const workflowId = "01ARZ3NDEKTSV4RRFFQ69G5FW1";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FW2";

function makeIntake(): IntakeItem {
  return {
    assigneeId,
    description: "Break checkout work into tasks",
    id: intakeItemId,
    organizationId,
    priority: "HIGH",
    reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FU1",
    requirementId,
    sourceType: "AD_HOC",
    spaceId,
    status: "ACCEPTED",
    title: "Checkout scope",
    versionId,
  };
}

beforeEach(() => {
  convertIntakeItemToWorkItemsMock.mockReset();
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();
  listWorkflowBindingsMock.mockReset();
  listWorkflowsMock.mockReset();

  listSpaceMembersMock.mockResolvedValue({
    items: [
      {
        userId: assigneeId,
        user: { name: "Alice", username: "alice" },
      } as SpaceMemberWithUser,
    ],
  });
  listVersionsMock.mockResolvedValue({
    items: [{ id: versionId, name: "M2" } as Version],
  });
  listRequirementsMock.mockResolvedValue({
    items: [{ id: requirementId, title: "Requirement A" } as Requirement],
  });
  listWorkflowsMock.mockResolvedValue({
    items: [{ id: workflowId, name: "General task" } as WorkflowDefinition],
  });
  listWorkflowBindingsMock.mockResolvedValue({
    items: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        workflowId,
        workflowVersionId,
        workItemType: "TASK",
        isDefault: true,
      } as WorkflowBinding,
    ],
  });
  convertIntakeItemToWorkItemsMock.mockResolvedValue({
    intakeItemId,
    workItems: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("ConvertIntakeDialog", () => {
  it("submits exposed task fields through the shared convert schema", async () => {
    const onConverted = vi.fn();

    render(
      <ConvertIntakeDialog
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        intakeItem={makeIntake()}
        onConverted={onConverted}
      />,
    );

    expect(await screen.findByDisplayValue("Checkout scope")).toBeInTheDocument();
    await screen.findByText(/General task/);

    fireEvent.change(screen.getByTestId("convert-task-due-date-0"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByTestId("convert-task-workflow-0"), {
      target: { value: workflowVersionId },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "intake.dialog.convert.submit" }),
    );

    await waitFor(() =>
      expect(convertIntakeItemToWorkItemsMock).toHaveBeenCalledWith(
        { intakeItemId, organizationId, spaceId },
        {
          tasks: [
            {
              assigneeId,
              description: "Break checkout work into tasks",
              dueDate: "2026-06-01T00:00:00.000Z",
              priority: "HIGH",
              requirementId,
              title: "Checkout scope",
              versionId,
              workflowVersionId,
            },
          ],
        },
      ),
    );
    expect(onConverted).toHaveBeenCalledWith({
      intakeItemId,
      workItems: [],
    });
  });

  it("keeps non-accepted intake items from being converted", async () => {
    render(
      <ConvertIntakeDialog
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        intakeItem={{ ...makeIntake(), status: "CONVERTED" }}
      />,
    );

    const submit = await screen.findByRole("button", {
      name: "intake.dialog.convert.submit",
    });
    expect(submit).toBeDisabled();
    expect(convertIntakeItemToWorkItemsMock).not.toHaveBeenCalled();
  });

  it("shows an option load error, disables submit, and retries", async () => {
    listWorkflowBindingsMock.mockRejectedValueOnce(new Error("network"));

    render(
      <ConvertIntakeDialog
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        intakeItem={makeIntake()}
      />,
    );

    expect(
      await screen.findByTestId("convert-intake-options-error"),
    ).toHaveTextContent("common.states.optionsLoadFailed");
    expect(
      screen.getByRole("button", { name: "intake.dialog.convert.submit" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByTestId("convert-intake-options-retry"));

    await screen.findByText(/General task/);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "intake.dialog.convert.submit" }),
      ).not.toBeDisabled(),
    );
    expect(listWorkflowBindingsMock).toHaveBeenCalledTimes(2);
  });
});
