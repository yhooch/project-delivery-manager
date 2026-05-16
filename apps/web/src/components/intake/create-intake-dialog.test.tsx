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

const {
  createIntakeItemMock,
  listRequirementsMock,
  listSpaceMembersMock,
  listVersionsMock,
} = vi.hoisted(() => ({
  createIntakeItemMock: vi.fn(),
  listRequirementsMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  listVersionsMock: vi.fn(),
}));

vi.mock("../../lib/intake-service", () => ({
  createIntakeItem: createIntakeItemMock,
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

import { CreateIntakeDialog } from "./create-intake-dialog";

const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const versionTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const requirementTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
const unversionedRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR3";

beforeEach(() => {
  createIntakeItemMock.mockReset();
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();

  listRequirementsMock.mockResolvedValue({ items: [], total: 0 });
  listVersionsMock.mockResolvedValue({ items: [], total: 0 });
  listSpaceMembersMock.mockResolvedValue({
    items: [
      {
        userId: assigneeId,
        user: { name: "Alice", username: "alice" },
      },
    ],
    total: 1,
  });
  createIntakeItemMock.mockResolvedValue({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FI1",
  });
});

afterEach(() => {
  cleanup();
});

describe("CreateIntakeDialog", () => {
  it("submits assigneeId, sourceObject, and every shared source type through the create schema", async () => {
    render(
      <CreateIntakeDialog open onOpenChange={vi.fn()} spaceId={spaceId} />,
    );

    await screen.findByText("Alice");

    const sourceSelect = screen.getByTestId("create-intake-source-select");
    expect(sourceSelect).toHaveTextContent(
      "intakeItems.sourceType.EXTERNAL_COLLABORATION",
    );

    fireEvent.change(screen.getByTestId("create-intake-title-input"), {
      target: { value: "  New intake  " },
    });
    fireEvent.change(screen.getByTestId("create-intake-assignee-select"), {
      target: { value: assigneeId },
    });
    fireEvent.change(screen.getByTestId("create-intake-source-object-input"), {
      target: { value: '{ "meetingId": "m-1" }' },
    });
    fireEvent.change(sourceSelect, {
      target: { value: "EXTERNAL_COLLABORATION" },
    });
    fireEvent.click(screen.getByTestId("create-intake-submit"));

    await waitFor(() => expect(createIntakeItemMock).toHaveBeenCalledTimes(1));
    expect(createIntakeItemMock).toHaveBeenCalledWith(
      { spaceId },
      expect.objectContaining({
        assigneeId,
        sourceObject: { meetingId: "m-1" },
        sourceType: "EXTERNAL_COLLABORATION",
        title: "New intake",
      }),
    );
  });

  it("shows an option load error, disables submit, and retries", async () => {
    listSpaceMembersMock.mockRejectedValueOnce(new Error("network"));

    render(
      <CreateIntakeDialog open onOpenChange={vi.fn()} spaceId={spaceId} />,
    );

    expect(
      await screen.findByTestId("create-intake-options-error"),
    ).toHaveTextContent("common.states.optionsLoadFailed");
    expect(screen.getByTestId("create-intake-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("create-intake-options-retry"));

    await screen.findByText("Alice");
    await waitFor(() =>
      expect(screen.getByTestId("create-intake-submit")).not.toBeDisabled(),
    );
    expect(listSpaceMembersMock).toHaveBeenCalledTimes(2);
  });

  it("filters requirement options by the selected version", async () => {
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

    render(
      <CreateIntakeDialog open onOpenChange={vi.fn()} spaceId={spaceId} />,
    );

    await screen.findByText("Requirement v1");
    const versionSelect = screen.getByTestId(
      "create-intake-version-select",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "create-intake-requirement-select",
    ) as HTMLSelectElement;

    fireEvent.change(requirementSelect, { target: { value: requirementId } });
    expect(requirementSelect.value).toBe(requirementId);

    fireEvent.change(versionSelect, { target: { value: versionTwoId } });

    expect(requirementSelect.value).toBe("");
    expect(screen.queryByText("Requirement v1")).not.toBeInTheDocument();
    expect(
      screen.getByText("Requirement no version"),
    ).toBeInTheDocument();
    expect(screen.getByText("Requirement v2")).toBeInTheDocument();
  });

  it("infers the version from a versioned requirement", async () => {
    listVersionsMock.mockResolvedValue({
      items: [{ id: versionId, name: "Version 1" }],
      total: 1,
    });
    listRequirementsMock.mockResolvedValue({
      items: [{ id: requirementId, title: "Requirement v1", versionId }],
      total: 1,
    });

    render(
      <CreateIntakeDialog open onOpenChange={vi.fn()} spaceId={spaceId} />,
    );

    await screen.findByText("Requirement v1");
    const versionSelect = screen.getByTestId(
      "create-intake-version-select",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "create-intake-requirement-select",
    ) as HTMLSelectElement;

    fireEvent.change(requirementSelect, { target: { value: requirementId } });

    await waitFor(() => expect(versionSelect.value).toBe(versionId));
    expect(requirementSelect.value).toBe(requirementId);
  });
});
