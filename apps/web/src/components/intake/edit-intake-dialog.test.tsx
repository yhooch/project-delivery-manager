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
  listRequirementsMock,
  listSpaceMembersMock,
  listVersionsMock,
  sessionOrganizationId,
  updateIntakeItemMock,
} = vi.hoisted(() => ({
  listRequirementsMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
  listVersionsMock: vi.fn(),
  sessionOrganizationId: "01ARZ3NDEKTSV4RRFFQ69G5FO1",
  updateIntakeItemMock: vi.fn(),
}));

vi.mock("../../lib/intake-service", () => ({
  updateIntakeItem: updateIntakeItemMock,
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
vi.mock("../providers/session-provider", () => ({
  useSession: () => ({
    currentOrganization: { id: sessionOrganizationId },
    session: { defaultOrganizationId: sessionOrganizationId },
  }),
}));

import type { IntakeItem } from "@project-delivery/shared";

import { ApiClientError } from "../../lib/api-client";
import { EditIntakeDialog } from "./edit-intake-dialog";

const organizationId = sessionOrganizationId;
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const intakeItemId = "01ARZ3NDEKTSV4RRFFQ69G5FI1";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5FU1";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const versionTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const requirementTwoId = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
const unversionedRequirementId = "01ARZ3NDEKTSV4RRFFQ69G5FR3";

beforeEach(() => {
  listRequirementsMock.mockReset();
  listSpaceMembersMock.mockReset();
  listVersionsMock.mockReset();
  updateIntakeItemMock.mockReset();

  listRequirementsMock.mockResolvedValue({ items: [], total: 0 });
  listVersionsMock.mockResolvedValue({ items: [], total: 0 });
  listSpaceMembersMock.mockResolvedValue({ items: [], total: 0 });
  updateIntakeItemMock.mockResolvedValue(makeIntakeItem());
});

afterEach(() => {
  cleanup();
});

describe("EditIntakeDialog", () => {
  it("keeps the selected requirement option when the selected version differs", async () => {
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
      <EditIntakeDialog
        open
        onOpenChange={vi.fn()}
        spaceId={spaceId}
        intakeItem={makeIntakeItem({ requirementId, versionId })}
      />,
    );

    await screen.findByText("Requirement v1");
    expect(listVersionsMock).toHaveBeenCalledWith({
      organizationId,
      page: 1,
      pageSize: 100,
      spaceId,
    });
    expect(listRequirementsMock).toHaveBeenCalledWith({
      organizationId,
      page: 1,
      pageSize: 100,
      spaceId,
    });
    const versionSelect = screen.getByTestId(
      "edit-intake-version-select",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "edit-intake-requirement-select",
    ) as HTMLSelectElement;

    expect(versionSelect.value).toBe(versionId);
    expect(requirementSelect.value).toBe(requirementId);

    fireEvent.change(versionSelect, { target: { value: versionTwoId } });

    expect(requirementSelect.value).toBe(requirementId);
    expect(screen.getByText("Requirement v1")).toBeInTheDocument();
    expect(screen.getByText("Requirement no version")).toBeInTheDocument();
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
      <EditIntakeDialog
        open
        onOpenChange={vi.fn()}
        spaceId={spaceId}
        intakeItem={makeIntakeItem()}
      />,
    );

    await screen.findByText("Requirement v1");
    const versionSelect = screen.getByTestId(
      "edit-intake-version-select",
    ) as HTMLSelectElement;
    const requirementSelect = screen.getByTestId(
      "edit-intake-requirement-select",
    ) as HTMLSelectElement;

    fireEvent.change(requirementSelect, { target: { value: requirementId } });

    await waitFor(() => expect(versionSelect.value).toBe(versionId));
    expect(requirementSelect.value).toBe(requirementId);
  });

  it("confirms and retries intake save when version cascade is required", async () => {
    const cascadeError = new ApiClientError(
      {
        code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
        message: "事项版本变更需要同步任务",
        requestId: "REQ_TRACE",
      },
      new Response(null, { status: 409, statusText: "Conflict" }),
    );
    const onUpdated = vi.fn();
    updateIntakeItemMock
      .mockRejectedValueOnce(cascadeError)
      .mockResolvedValueOnce(makeIntakeItem({ versionId }));

    render(
      <EditIntakeDialog
        open
        onOpenChange={vi.fn()}
        spaceId={spaceId}
        intakeItem={makeIntakeItem()}
        onUpdated={onUpdated}
      />,
    );

    await screen.findByDisplayValue("Existing intake");
    fireEvent.click(screen.getByTestId("edit-intake-submit"));

    expect(
      await screen.findByTestId("trace-version-cascade-confirm-dialog"),
    ).toHaveTextContent("errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE");
    expect(
      screen.getByTestId("trace-version-cascade-confirm-dialog"),
    ).not.toHaveTextContent("事项版本变更需要同步任务");
    await waitFor(() => expect(updateIntakeItemMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("trace-version-cascade-confirm"));

    await waitFor(() => expect(updateIntakeItemMock).toHaveBeenCalledTimes(2));
    expect(updateIntakeItemMock).toHaveBeenLastCalledWith(
      { intakeItemId, organizationId, spaceId },
      expect.objectContaining({ cascadeVersionChange: true }),
    );
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ versionId }),
    );
  });
});

function makeIntakeItem(
  overrides: Partial<Pick<IntakeItem, "requirementId" | "versionId">> = {},
): IntakeItem {
  return {
    id: intakeItemId,
    organizationId,
    reporterId,
    sourceType: "AD_HOC",
    spaceId,
    status: "PENDING",
    title: "Existing intake",
    ...overrides,
  };
}
