import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const nextVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const nextRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
const relatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FT1";
const nextRelatedTaskId = "01ARZ3NDEKTSV4RRFFQ69G5FT2";

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

  it("infers the version from a selected requirement and narrows related task options", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [
        { id: versionId, name: "v1" },
        { id: nextVersionId, name: "v2" },
      ],
      total: 2,
    });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        { id: requirementId, title: "Requirement v1", versionId },
        {
          id: nextRequirementId,
          title: "Requirement v2",
          versionId: nextVersionId,
        },
      ],
      total: 2,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        { id: relatedTaskId, title: "Task v1", versionId },
        { id: nextRelatedTaskId, title: "Task v2", versionId: nextVersionId },
      ],
      total: 2,
    });

    render(
      <CreateBugDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByText("Requirement v2");

    const versionSelect = screen.getByTestId(
      "create-bug-version-select",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "create-bug-requirement-select",
    ) as HTMLSelectElement;
    const relatedTaskSelect = screen.getByTestId(
      "create-bug-related-task-select",
    ) as HTMLSelectElement;

    fireEvent.change(requirementSelect, {
      target: { value: nextRequirementId },
    });

    await waitFor(() => expect(versionSelect.value).toBe(nextVersionId));
    expect(requirementSelect.value).toBe(nextRequirementId);
    expect(
      within(relatedTaskSelect).queryByRole("option", { name: "Task v1" }),
    ).not.toBeInTheDocument();
    expect(
      within(relatedTaskSelect).getByRole("option", { name: "Task v2" }),
    ).toBeInTheDocument();

    fireEvent.change(versionSelect, { target: { value: versionId } });

    await waitFor(() => expect(requirementSelect.value).toBe(""));
    expect(
      within(requirementSelect).getByRole("option", {
        name: "Requirement v1",
      }),
    ).toBeInTheDocument();
    expect(
      within(requirementSelect).queryByRole("option", {
        name: "Requirement v2",
      }),
    ).not.toBeInTheDocument();
  });

  it("infers the version and requirement from a selected related task", async () => {
    listVersionsMock.mockResolvedValueOnce({
      items: [
        { id: versionId, name: "v1" },
        { id: nextVersionId, name: "v2" },
      ],
      total: 2,
    });
    listRequirementsMock.mockResolvedValueOnce({
      items: [
        { id: requirementId, title: "Requirement v1", versionId },
        {
          id: nextRequirementId,
          title: "Requirement v2",
          versionId: nextVersionId,
        },
      ],
      total: 2,
    });
    listWorkItemsMock.mockResolvedValueOnce({
      items: [
        { id: relatedTaskId, title: "Task v1", versionId },
        {
          id: nextRelatedTaskId,
          title: "Task v2",
          requirementId: nextRequirementId,
          versionId: nextVersionId,
        },
      ],
      total: 2,
    });

    render(
      <CreateBugDialog
        open
        onOpenChange={() => {}}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    await screen.findByText("Task v2");

    const versionSelect = screen.getByTestId(
      "create-bug-version-select",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "create-bug-requirement-select",
    ) as HTMLSelectElement;

    fireEvent.change(screen.getByTestId("create-bug-related-task-select"), {
      target: { value: nextRelatedTaskId },
    });

    await waitFor(() => expect(versionSelect.value).toBe(nextVersionId));
    expect(requirementSelect.value).toBe(nextRequirementId);
    expect(
      within(requirementSelect).queryByRole("option", {
        name: "Requirement v1",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(requirementSelect).getByRole("option", {
        name: "Requirement v2",
      }),
    ).toBeInTheDocument();
  });
});
