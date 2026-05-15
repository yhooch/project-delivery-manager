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
});
