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
  createBugMock,
  listRequirementsMock,
  listSpaceMembersMock,
  listVersionsMock,
  listWorkItemsMock,
} = vi.hoisted(() => ({
  createBugMock: vi.fn(),
  listRequirementsMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  listVersionsMock: vi.fn(),
  listWorkItemsMock: vi.fn(),
}));

vi.mock("../../lib/bug-service", () => ({
  createBug: createBugMock,
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

import { CreateBugDialog } from "./create-bug-dialog";

const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const organizationId = "ORG_01";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FT1";

beforeEach(() => {
  createBugMock.mockReset();
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();
  listWorkItemsMock.mockReset();
  listVersionsMock.mockResolvedValue({ items: [], total: 0 });
  listRequirementsMock.mockResolvedValue({
    items: [{ id: requirementId, title: "Requirement 1" }],
    total: 1,
  });
  listWorkItemsMock.mockResolvedValue({
    items: [{ id: relatedTaskId, title: "Task 1" }],
    total: 1,
  });
  listSpaceMembersMock.mockResolvedValue({ items: [], total: 0 });
  createBugMock.mockResolvedValue({ id: "created" });
});

afterEach(() => {
  cleanup();
});

describe("CreateBugDialog", () => {
  it("submits description, requirement, related task, expected and actual fields", async () => {
    render(
      <CreateBugDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByText("Requirement 1");
    await screen.findByText("Task 1");

    fireEvent.change(screen.getByTestId("create-bug-title-input"), {
      target: { value: "Linked bug" },
    });
    fireEvent.change(screen.getByTestId("create-bug-description-input"), {
      target: { value: "  Checkout fails intermittently  " },
    });
    fireEvent.change(screen.getByTestId("create-bug-expected-input"), {
      target: { value: "Expected result" },
    });
    fireEvent.change(screen.getByTestId("create-bug-actual-input"), {
      target: { value: "Actual result" },
    });
    fireEvent.change(screen.getByTestId("create-bug-requirement-select"), {
      target: { value: requirementId },
    });
    fireEvent.change(screen.getByTestId("create-bug-related-task-select"), {
      target: { value: relatedTaskId },
    });
    fireEvent.click(screen.getByTestId("create-bug-submit"));

    await waitFor(() => expect(createBugMock).toHaveBeenCalledTimes(1));
    expect(createBugMock).toHaveBeenCalledWith(
      { organizationId, spaceId },
      expect.objectContaining({
        actualResult: "Actual result",
        description: "Checkout fails intermittently",
        expectedResult: "Expected result",
        relatedTaskId,
        requirementId,
        title: "Linked bug",
      }),
    );
  });

  it("resets the description field when closed", () => {
    render(
      <CreateBugDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const descriptionInput = screen.getByTestId(
      "create-bug-description-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(descriptionInput, {
      target: { value: "Transient checkout error" },
    });

    expect(descriptionInput.value).toBe("Transient checkout error");

    fireEvent.click(
      screen.getByRole("button", { name: "bugs.dialog.actions.cancel" }),
    );

    expect(descriptionInput.value).toBe("");
  });

  it("shows an option load error, disables submit, and retries", async () => {
    listWorkItemsMock.mockRejectedValueOnce(new Error("network"));

    render(
      <CreateBugDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    expect(await screen.findByTestId("create-bug-options-error")).toHaveTextContent(
      "common.states.optionsLoadFailed",
    );
    expect(screen.getByTestId("create-bug-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("create-bug-options-retry"));

    await screen.findByText("Requirement 1");
    await screen.findByText("Task 1");
    await waitFor(() =>
      expect(screen.getByTestId("create-bug-submit")).not.toBeDisabled(),
    );
    expect(listWorkItemsMock).toHaveBeenCalledTimes(2);
  });
});
