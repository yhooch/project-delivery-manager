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
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FJ1";

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

  it("shows an option load error, disables submit, and retries", async () => {
    listRequirementsMock.mockRejectedValueOnce(new Error("network"));

    render(
      <CreateTaskDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    expect(await screen.findByTestId("create-task-options-error")).toHaveTextContent(
      "common.states.optionsLoadFailed",
    );
    expect(screen.getByTestId("create-task-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("create-task-options-retry"));

    await screen.findByText("Requirement 1");
    await screen.findByText("Intake 1");
    await waitFor(() =>
      expect(screen.getByTestId("create-task-submit")).not.toBeDisabled(),
    );
    expect(listRequirementsMock).toHaveBeenCalledTimes(2);
  });
});
