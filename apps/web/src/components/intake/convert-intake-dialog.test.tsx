import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
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
  loadWorkflowVersionOptionsMock,
} = vi.hoisted(() => ({
  convertIntakeItemToWorkItemsMock: vi.fn(),
  listRequirementsMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  listVersionsMock: vi.fn(),
  loadWorkflowVersionOptionsMock: vi.fn(),
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
vi.mock("../../lib/workflow-options", () => ({
  formatWorkflowVersionOption: (
    option: {
      isDefault: boolean;
      version: { version: number };
      workflow: { name: string };
    },
    t: (key: string) => string,
  ) =>
    `${option.workflow.name} v${option.version.version}${
      option.isDefault
        ? ` · ${t("workflow.bindingsPanel.fields.isDefault")}`
        : ""
    }`,
  getDefaultWorkflowVersionId: (
    options: Array<{
      isDefault: boolean;
      version: { id: string };
    }>,
  ) => options.find((option) => option.isDefault)?.version.id ?? "",
  loadWorkflowVersionOptions: loadWorkflowVersionOptionsMock,
}));
vi.mock("../tag", () => ({
  TagSelectionField: ({
    onSelectedTagsChange,
    selectedTags,
    testId,
  }: {
    onSelectedTagsChange: (
      tags: import("@project-delivery/shared").TagDto[],
    ) => void;
    selectedTags: import("@project-delivery/shared").TagDto[];
    testId?: string;
  }) => {
    const tag = {
      colorKey: "blue",
      createdAt: "2026-05-20T00:00:00.000Z",
      displayName: "#backend",
      id: "01ARZ3NDEKTSV4RRFFQ69G5FT1",
      name: "backend",
      normalizedName: "backend",
      organizationId: "ORG_01",
      spaceId: "01ARZ3NDEKTSV4RRFFQ69G5FS1",
      updatedAt: "2026-05-20T00:00:00.000Z",
    };

    return (
      <button
        type="button"
        data-testid={testId}
        data-selected={selectedTags.map((item) => item.id).join(",")}
        onClick={() =>
          onSelectedTagsChange(
            selectedTags.some((item) => item.id === tag.id)
              ? selectedTags
              : [...selectedTags, tag],
          )
        }
      >
        select tag
      </button>
    );
  },
}));

import type {
  IntakeItem,
  Requirement,
  SpaceMemberWithUser,
  TagDto,
  Version,
} from "@project-delivery/shared";

import { ConvertIntakeDialog } from "./convert-intake-dialog";

const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const organizationId = "ORG_01";
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FI1";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const versionTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const requirementTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
const unversionedRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR3";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FW2";
const selectedTagId = "01ARZ3NDEKTSV4RRFFQ69G5FT1";
const intakeTagId = "01ARZ3NDEKTSV4RRFFQ69G5FT2";

function makeTag(overrides: Partial<TagDto> = {}): TagDto {
  return {
    colorKey: "green",
    createdAt: "2026-05-20T00:00:00.000Z",
    displayName: "#frontend",
    id: intakeTagId,
    name: "frontend",
    normalizedName: "frontend",
    organizationId,
    spaceId,
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

function makeIntake(overrides: Partial<IntakeItem> = {}): IntakeItem {
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
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

beforeEach(() => {
  convertIntakeItemToWorkItemsMock.mockReset();
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();
  loadWorkflowVersionOptionsMock.mockReset();

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
    items: [
      { id: requirementId, title: "Requirement A", versionId } as Requirement,
    ],
  });
  loadWorkflowVersionOptionsMock.mockResolvedValue([
    {
      binding: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
        workflowVersionId,
        workItemType: "TASK",
        isDefault: true,
      },
      isDefault: true,
      version: { id: workflowVersionId, version: 2 },
      workflow: { name: "General task" },
    },
  ]);
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

    expect(
      await screen.findByDisplayValue("Checkout scope"),
    ).toBeInTheDocument();
    await screen.findAllByText(/General task/);
    const workflowSelect = screen.getByTestId(
      "convert-task-workflow-0",
    ) as HTMLSelectElement;
    await waitFor(() => expect(workflowSelect.value).toBe(workflowVersionId));
    expect(workflowSelect.options[0]?.value).toBe(workflowVersionId);
    expect(workflowSelect.options[0]).toHaveAttribute(
      "title",
      "General task v2 · workflow.bindingsPanel.fields.isDefault",
    );
    expect(screen.getByTestId("convert-task-workflow-0-trigger"))
      .toHaveAttribute(
        "title",
        "General task v2 · workflow.bindingsPanel.fields.isDefault",
      );
    expect(listSpaceMembersMock).toHaveBeenCalledWith(spaceId, {
      status: "ACTIVE",
    });

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

  it("uses the loaded workflow default for rows added after options are ready", async () => {
    render(
      <ConvertIntakeDialog
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        intakeItem={makeIntake()}
      />,
    );

    const firstWorkflowSelect = (await screen.findByTestId(
      "convert-task-workflow-0",
    )) as HTMLSelectElement;
    await waitFor(() =>
      expect(firstWorkflowSelect.value).toBe(workflowVersionId),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "intake.dialog.convert.addTask" }),
    );

    const secondWorkflowSelect = screen.getByTestId(
      "convert-task-workflow-1",
    ) as HTMLSelectElement;
    expect(secondWorkflowSelect.value).toBe(workflowVersionId);

    fireEvent.change(screen.getByTestId("convert-task-title-1"), {
      target: { value: "Follow-up task" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "intake.dialog.convert.submit" }),
    );

    await waitFor(() =>
      expect(convertIntakeItemToWorkItemsMock).toHaveBeenCalledWith(
        { intakeItemId, organizationId, spaceId },
        {
          tasks: [
            expect.objectContaining({
              title: "Checkout scope",
              workflowVersionId,
            }),
            expect.objectContaining({
              title: "Follow-up task",
              workflowVersionId,
            }),
          ],
        },
      ),
    );
  });

  it("submits inherited and selected tags for converted task rows", async () => {
    const intakeTag = makeTag();

    render(
      <ConvertIntakeDialog
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        intakeItem={makeIntake({ tags: [intakeTag] })}
      />,
    );

    expect(
      await screen.findByDisplayValue("Checkout scope"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("convert-task-tags-0")).toHaveAttribute(
      "data-selected",
      intakeTagId,
    );

    fireEvent.click(screen.getByTestId("convert-task-tags-0"));
    fireEvent.click(
      screen.getByRole("button", { name: "intake.dialog.convert.submit" }),
    );

    await waitFor(() =>
      expect(convertIntakeItemToWorkItemsMock).toHaveBeenCalledWith(
        { intakeItemId, organizationId, spaceId },
        {
          tasks: [
            expect.objectContaining({
              tagIds: [intakeTagId, selectedTagId],
              title: "Checkout scope",
            }),
          ],
        },
      ),
    );
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

  it("shows an option load error, keeps accepted intake submit enabled, and retries", async () => {
    loadWorkflowVersionOptionsMock.mockRejectedValueOnce(new Error("network"));

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
    expect(screen.getByTestId("convert-task-workflow-0")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "intake.dialog.convert.submit" }),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("convert-intake-options-retry"));

    await screen.findAllByText(/General task/);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "intake.dialog.convert.submit" }),
      ).not.toBeDisabled(),
    );
    expect(loadWorkflowVersionOptionsMock).toHaveBeenCalledTimes(2);
  });

  it("converts an accepted intake item when optional lookups fail", async () => {
    loadWorkflowVersionOptionsMock.mockRejectedValueOnce(new Error("network"));

    render(
      <ConvertIntakeDialog
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        intakeItem={makeIntake()}
      />,
    );

    await screen.findByTestId("convert-intake-options-error");
    fireEvent.click(
      screen.getByRole("button", { name: "intake.dialog.convert.submit" }),
    );

    await waitFor(() =>
      expect(convertIntakeItemToWorkItemsMock).toHaveBeenCalledTimes(1),
    );
    expect(convertIntakeItemToWorkItemsMock).toHaveBeenCalledWith(
      { intakeItemId, organizationId, spaceId },
      expect.objectContaining({
        tasks: [expect.objectContaining({ title: "Checkout scope" })],
      }),
    );
  });

  it("clears the selected requirement when the row version is incompatible", async () => {
    listVersionsMock.mockResolvedValue({
      items: [
        { id: versionId, name: "Version 1" } as Version,
        { id: versionTwoId, name: "Version 2" } as Version,
      ],
    });
    listRequirementsMock.mockResolvedValue({
      items: [
        {
          id: requirementId,
          title: "Requirement v1",
          versionId,
        } as Requirement,
        {
          id: requirementTwoId,
          title: "Requirement v2",
          versionId: versionTwoId,
        } as Requirement,
        {
          id: unversionedRequirementId,
          title: "Requirement no version",
        } as Requirement,
      ],
    });

    render(
      <ConvertIntakeDialog
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        intakeItem={makeIntake()}
      />,
    );

    await screen.findAllByText("Requirement v1");
    const versionSelect = screen.getByTestId(
      "convert-task-version-0",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "convert-task-requirement-0",
    ) as HTMLSelectElement;

    expect(versionSelect.value).toBe(versionId);
    expect(requirementSelect.value).toBe(requirementId);

    fireEvent.change(versionSelect, { target: { value: versionTwoId } });

    await waitFor(() => expect(requirementSelect.value).toBe(""));
    expect(screen.queryByText("Requirement v1")).not.toBeInTheDocument();
    expect(screen.getByText("Requirement no version")).toBeInTheDocument();
    expect(screen.getByText("Requirement v2")).toBeInTheDocument();
  });

  it("infers the row version from a versioned requirement", async () => {
    listVersionsMock.mockResolvedValue({
      items: [{ id: versionId, name: "Version 1" } as Version],
    });
    listRequirementsMock.mockResolvedValue({
      items: [
        {
          id: requirementId,
          title: "Requirement v1",
          versionId,
        } as Requirement,
      ],
    });

    render(
      <ConvertIntakeDialog
        open
        onOpenChange={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
        intakeItem={makeIntake({
          requirementId: undefined,
          versionId: undefined,
        })}
      />,
    );

    await screen.findByText("Requirement v1");
    const versionSelect = screen.getByTestId(
      "convert-task-version-0",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "convert-task-requirement-0",
    ) as HTMLSelectElement;

    fireEvent.change(requirementSelect, { target: { value: requirementId } });

    await waitFor(() => expect(versionSelect.value).toBe(versionId));
    expect(requirementSelect.value).toBe(requirementId);
  });
});
