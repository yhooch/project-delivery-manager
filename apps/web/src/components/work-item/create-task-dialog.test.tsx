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
} = vi.hoisted(() => ({
  createWorkItemMock: vi.fn(),
  listIntakeItemsMock: vi.fn(),
  listRequirementsMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  listVersionsMock: vi.fn(),
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

beforeEach(() => {
  createWorkItemMock.mockReset();
  listIntakeItemsMock.mockReset();
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();
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
