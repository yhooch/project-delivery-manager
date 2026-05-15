import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FI1";

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
      { spaceId },
      expect.objectContaining({
        intakeItemId,
        requirementId,
        title: "Linked task",
      }),
    );
  });
});
