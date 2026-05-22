import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<string, (key: string) => string>(),
}));

function getSelectOptionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.options, (option) => option.textContent ?? "");
}

function getVersionSelect(): HTMLSelectElement {
  const versionSelect = document.getElementById("create-task-version");
  expect(versionSelect).not.toBeNull();
  return versionSelect as HTMLSelectElement;
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

vi.mock("../providers/session-provider", () => ({
  useSession: () => ({
    currentOrganization: { id: "ORG_01" },
    session: { defaultOrganizationId: "ORG_01" },
  }),
}));

const {
  createWorkItemMock,
  listIntakeItemsMock,
  listRequirementsMock,
  listSpaceMembersMock,
  listVersionsMock,
  loadWorkflowVersionOptionsMock,
} = vi.hoisted(() => ({
  createWorkItemMock: vi.fn(),
  listIntakeItemsMock: vi.fn(),
  listRequirementsMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  listVersionsMock: vi.fn(),
  loadWorkflowVersionOptionsMock: vi.fn(),
}));

vi.mock("../../lib/work-item-service", () => ({
  createWorkItem: createWorkItemMock,
}));
vi.mock("../../lib/intake-service", () => ({
  listIntakeItems: listIntakeItemsMock,
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
      displayName: "#manual",
      id: "01ARZ3NDEKTSV4RRFFQ69G5FT3",
      name: "manual",
      normalizedName: "manual",
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

import type { TagDto } from "@project-delivery/shared";

import { CreateTaskDialog } from "./create-task-dialog";

const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const organizationId = "ORG_01";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const requirementTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
const unversionedRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR3";
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FJ1";
const intakeItemTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FJ2";
const unversionedIntakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FJ3";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const versionTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FW1";
const workflowVersionTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FW2";
const requirementTagId = "01ARZ3NDEKTSV4RRFFQ69G5FT1";
const intakeTagId = "01ARZ3NDEKTSV4RRFFQ69G5FT2";
const manualTagId = "01ARZ3NDEKTSV4RRFFQ69G5FT3";
const intakeTwoTagId = "01ARZ3NDEKTSV4RRFFQ69G5FT4";

function makeTag(id: string, name: string): TagDto {
  return {
    colorKey: "green",
    createdAt: "2026-05-20T00:00:00.000Z",
    displayName: `#${name}`,
    id,
    name,
    normalizedName: name,
    organizationId,
    spaceId,
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

beforeEach(() => {
  createWorkItemMock.mockReset();
  listIntakeItemsMock.mockReset();
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();
  loadWorkflowVersionOptionsMock.mockReset();
  listVersionsMock.mockResolvedValue({ items: [], total: 0 });
  listRequirementsMock.mockResolvedValue({
    items: [{ id: requirementId, title: "Requirement 1" }],
    total: 1,
  });
  listIntakeItemsMock.mockResolvedValue({
    items: [{ id: intakeItemId, title: "Intake 1" }],
    total: 1,
  });
  listSpaceMembersMock.mockResolvedValue({ items: [], total: 0 });
  loadWorkflowVersionOptionsMock.mockResolvedValue([]);
  createWorkItemMock.mockResolvedValue({ id: "created" });
});

afterEach(() => {
  cleanup();
});

describe("CreateTaskDialog", () => {
  it("submits requirement and intake relations when selected", async () => {
    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByText("Requirement 1");
    await screen.findByText("Intake 1");

    fireEvent.change(screen.getByTestId("create-task-title-input"), {
      target: { value: "Linked task" },
    });
    fireEvent.change(screen.getByTestId("create-task-requirement-select"), {
      target: { value: requirementId },
    });
    fireEvent.change(screen.getByTestId("create-task-intake-select"), {
      target: { value: intakeItemId },
    });
    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => expect(createWorkItemMock).toHaveBeenCalledTimes(1));
    expect(createWorkItemMock).toHaveBeenCalledWith(
      { organizationId, spaceId },
      expect.objectContaining({
        intakeItemId,
        requirementId,
        title: "Linked task",
      }),
    );
  });

  it("inherits requirement tags when no intake item is selected", async () => {
    listRequirementsMock.mockResolvedValue({
      items: [
        {
          id: requirementId,
          tags: [makeTag(requirementTagId, "frontend")],
          title: "Requirement tagged",
        },
      ],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValue({ items: [], total: 0 });

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByText("Requirement tagged");
    fireEvent.change(screen.getByTestId("create-task-title-input"), {
      target: { value: "Task from requirement" },
    });
    fireEvent.change(screen.getByTestId("create-task-requirement-select"), {
      target: { value: requirementId },
    });
    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => expect(createWorkItemMock).toHaveBeenCalledTimes(1));
    expect(createWorkItemMock).toHaveBeenCalledWith(
      { organizationId, spaceId },
      expect.objectContaining({
        tagIds: [requirementTagId],
        title: "Task from requirement",
      }),
    );
  });

  it("prefers intake item tags over requirement tags", async () => {
    listRequirementsMock.mockResolvedValue({
      items: [
        {
          id: requirementId,
          tags: [makeTag(requirementTagId, "frontend")],
          title: "Requirement tagged",
        },
      ],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValue({
      items: [
        {
          id: intakeItemId,
          requirementId,
          tags: [makeTag(intakeTagId, "intake")],
          title: "Intake tagged",
        },
      ],
      total: 1,
    });

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByText("Intake tagged");
    fireEvent.change(screen.getByTestId("create-task-title-input"), {
      target: { value: "Task from intake" },
    });
    fireEvent.change(screen.getByTestId("create-task-intake-select"), {
      target: { value: intakeItemId },
    });
    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => expect(createWorkItemMock).toHaveBeenCalledTimes(1));
    expect(createWorkItemMock).toHaveBeenCalledWith(
      { organizationId, spaceId },
      expect.objectContaining({
        requirementId,
        tagIds: [intakeTagId],
        title: "Task from intake",
      }),
    );
  });

  it("does not overwrite manually edited tags when the intake item changes", async () => {
    listIntakeItemsMock.mockResolvedValue({
      items: [
        {
          id: intakeItemId,
          tags: [makeTag(intakeTagId, "intake")],
          title: "Intake tagged",
        },
        {
          id: intakeItemTwoId,
          tags: [makeTag(intakeTwoTagId, "other")],
          title: "Other intake",
        },
      ],
      total: 2,
    });

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByText("Intake tagged");
    fireEvent.change(screen.getByTestId("create-task-title-input"), {
      target: { value: "Manual tagged task" },
    });
    fireEvent.change(screen.getByTestId("create-task-intake-select"), {
      target: { value: intakeItemId },
    });
    fireEvent.click(screen.getByTestId("create-task-tags"));
    fireEvent.change(screen.getByTestId("create-task-intake-select"), {
      target: { value: intakeItemTwoId },
    });
    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => expect(createWorkItemMock).toHaveBeenCalledTimes(1));
    expect(createWorkItemMock).toHaveBeenCalledWith(
      { organizationId, spaceId },
      expect.objectContaining({
        intakeItemId: intakeItemTwoId,
        tagIds: [intakeTagId, manualTagId],
        title: "Manual tagged task",
      }),
    );
  });

  it("defaults to the default workflow version and submits an explicitly selected version", async () => {
    loadWorkflowVersionOptionsMock.mockResolvedValue([
      {
        binding: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
          isDefault: true,
          workflowVersionId,
        },
        isDefault: true,
        version: { id: workflowVersionId, version: 2 },
        workflow: { name: "Task flow" },
      },
      {
        binding: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FB2",
          isDefault: false,
          workflowVersionId: workflowVersionTwoId,
        },
        isDefault: false,
        version: { id: workflowVersionTwoId, version: 1 },
        workflow: { name: "Task flow" },
      },
    ]);

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const workflowSelect = (await screen.findByTestId(
      "create-task-workflow-version-select",
    )) as HTMLSelectElement;
    await waitFor(() => expect(workflowSelect.value).toBe(workflowVersionId));
    expect(getSelectOptionLabels(workflowSelect)).toEqual(
      [
        "Task flow v2 · workflow.bindingsPanel.fields.isDefault",
        "Task flow v1",
      ],
    );
    expect(workflowSelect.options[0]?.value).not.toBe("");
    expect(workflowSelect.options[0]).toHaveAttribute(
      "title",
      "Task flow v2 · workflow.bindingsPanel.fields.isDefault",
    );
    expect(screen.getByTestId("create-task-workflow-version-select-trigger"))
      .toHaveAttribute(
        "title",
        "Task flow v2 · workflow.bindingsPanel.fields.isDefault",
      );

    fireEvent.change(workflowSelect, {
      target: { value: workflowVersionTwoId },
    });
    fireEvent.change(screen.getByTestId("create-task-title-input"), {
      target: { value: "Task with workflow" },
    });
    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => expect(createWorkItemMock).toHaveBeenCalledTimes(1));
    expect(createWorkItemMock).toHaveBeenCalledWith(
      { organizationId, spaceId },
      expect.objectContaining({
        title: "Task with workflow",
        workflowVersionId: workflowVersionTwoId,
      }),
    );
  });

  it("shows an option load error, keeps base submit enabled, and retries", async () => {
    listRequirementsMock.mockRejectedValueOnce(new Error("network"));

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    expect(
      await screen.findByTestId("create-task-options-error"),
    ).toHaveTextContent("common.states.optionsLoadFailed");
    expect(screen.getByTestId("create-task-requirement-select")).toBeDisabled();
    expect(screen.getByTestId("create-task-submit")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("create-task-options-retry"));

    await screen.findByText("Requirement 1");
    await screen.findByText("Intake 1");
    await waitFor(() =>
      expect(screen.getByTestId("create-task-submit")).not.toBeDisabled(),
    );
    expect(listRequirementsMock).toHaveBeenCalledTimes(2);
  });

  it("submits a base task when optional lookups fail", async () => {
    listRequirementsMock.mockRejectedValueOnce(new Error("network"));

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByTestId("create-task-options-error");
    fireEvent.change(screen.getByTestId("create-task-title-input"), {
      target: { value: "Fallback task" },
    });
    fireEvent.click(screen.getByTestId("create-task-submit"));

    await waitFor(() => expect(createWorkItemMock).toHaveBeenCalledTimes(1));
    expect(createWorkItemMock).toHaveBeenCalledWith(
      { organizationId, spaceId },
      expect.objectContaining({ title: "Fallback task" }),
    );
  });

  it("clears selected requirement and intake when the selected version differs", async () => {
    listVersionsMock.mockResolvedValue({
      items: [
        { id: versionId, name: "Version 1" },
        { id: versionTwoId, name: "Version 2" },
      ],
      total: 2,
    });
    listRequirementsMock.mockResolvedValue({
      items: [
        { id: requirementId, title: "Requirement v1", versionId },
        {
          id: requirementTwoId,
          title: "Requirement v2",
          versionId: versionTwoId,
        },
        { id: unversionedRequirementId, title: "Requirement no version" },
      ],
      total: 3,
    });
    listIntakeItemsMock.mockResolvedValue({
      items: [
        { id: intakeItemId, title: "Intake v1", versionId },
        { id: intakeItemTwoId, title: "Intake v2", versionId: versionTwoId },
        { id: unversionedIntakeItemId, title: "Intake no version" },
      ],
      total: 3,
    });

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const versionSelect = getVersionSelect();
    const requirementSelect = screen.getByTestId(
      "create-task-requirement-select",
    ) as HTMLSelectElement;
    const intakeSelect = screen.getByTestId(
      "create-task-intake-select",
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(getSelectOptionLabels(requirementSelect)).toContain(
        "Requirement v1",
      ),
    );

    fireEvent.change(requirementSelect, { target: { value: requirementId } });
    fireEvent.change(intakeSelect, { target: { value: intakeItemId } });
    expect(requirementSelect.value).toBe(requirementId);
    expect(intakeSelect.value).toBe(intakeItemId);

    fireEvent.change(versionSelect, { target: { value: versionTwoId } });

    await waitFor(() => expect(requirementSelect.value).toBe(""));
    expect(intakeSelect.value).toBe("");
    expect(getSelectOptionLabels(requirementSelect)).toEqual(
      expect.arrayContaining(["Requirement no version", "Requirement v2"]),
    );
    expect(getSelectOptionLabels(requirementSelect)).not.toContain(
      "Requirement v1",
    );
    expect(getSelectOptionLabels(intakeSelect)).toEqual(
      expect.arrayContaining(["Intake no version", "Intake v2"]),
    );
    expect(getSelectOptionLabels(intakeSelect)).not.toContain("Intake v1");
  });

  it("infers the version from a versioned requirement and keeps unversioned intake", async () => {
    listVersionsMock.mockResolvedValue({
      items: [{ id: versionId, name: "Version 1" }],
      total: 1,
    });
    listRequirementsMock.mockResolvedValue({
      items: [{ id: requirementId, title: "Requirement v1", versionId }],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValue({
      items: [{ id: unversionedIntakeItemId, title: "Intake no version" }],
      total: 1,
    });

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const versionSelect = getVersionSelect();
    const requirementSelect = screen.getByTestId(
      "create-task-requirement-select",
    ) as HTMLSelectElement;
    const intakeSelect = screen.getByTestId(
      "create-task-intake-select",
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(getSelectOptionLabels(requirementSelect)).toContain(
        "Requirement v1",
      ),
    );

    fireEvent.change(intakeSelect, {
      target: { value: unversionedIntakeItemId },
    });
    expect(intakeSelect.value).toBe(unversionedIntakeItemId);

    fireEvent.change(requirementSelect, { target: { value: requirementId } });

    await waitFor(() => expect(versionSelect.value).toBe(versionId));
    expect(requirementSelect.value).toBe(requirementId);
    expect(intakeSelect.value).toBe(unversionedIntakeItemId);
  });

  it("infers the version from a versioned intake item and keeps unversioned requirement", async () => {
    listVersionsMock.mockResolvedValue({
      items: [{ id: versionId, name: "Version 1" }],
      total: 1,
    });
    listRequirementsMock.mockResolvedValue({
      items: [
        { id: unversionedRequirementId, title: "Requirement no version" },
      ],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValue({
      items: [{ id: intakeItemId, title: "Intake v1", versionId }],
      total: 1,
    });

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const versionSelect = getVersionSelect();
    const requirementSelect = screen.getByTestId(
      "create-task-requirement-select",
    ) as HTMLSelectElement;
    const intakeSelect = screen.getByTestId(
      "create-task-intake-select",
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(getSelectOptionLabels(intakeSelect)).toContain("Intake v1"),
    );

    fireEvent.change(requirementSelect, {
      target: { value: unversionedRequirementId },
    });
    expect(requirementSelect.value).toBe(unversionedRequirementId);

    fireEvent.change(intakeSelect, { target: { value: intakeItemId } });

    await waitFor(() => expect(versionSelect.value).toBe(versionId));
    expect(intakeSelect.value).toBe(intakeItemId);
    expect(requirementSelect.value).toBe(unversionedRequirementId);
  });

  it("infers the version and requirement from a selected intake item", async () => {
    listVersionsMock.mockResolvedValue({
      items: [{ id: versionId, name: "Version 1" }],
      total: 1,
    });
    listRequirementsMock.mockResolvedValue({
      items: [{ id: requirementId, title: "Requirement v1", versionId }],
      total: 1,
    });
    listIntakeItemsMock.mockResolvedValue({
      items: [
        { id: intakeItemId, title: "Intake v1", requirementId, versionId },
      ],
      total: 1,
    });

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const versionSelect = getVersionSelect();
    const requirementSelect = screen.getByTestId(
      "create-task-requirement-select",
    ) as HTMLSelectElement;
    const intakeSelect = screen.getByTestId(
      "create-task-intake-select",
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(getSelectOptionLabels(intakeSelect)).toContain("Intake v1"),
    );

    fireEvent.change(intakeSelect, { target: { value: intakeItemId } });

    await waitFor(() => expect(versionSelect.value).toBe(versionId));
    expect(requirementSelect.value).toBe(requirementId);
    expect(intakeSelect.value).toBe(intakeItemId);
  });
});
