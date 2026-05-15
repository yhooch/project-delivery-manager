import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { SpaceMemberWithUser, Version } from "@project-delivery/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const { listSpaceMembersMock, updateVersionMock } = vi.hoisted(() => ({
  listSpaceMembersMock: vi.fn(),
  updateVersionMock: vi.fn(),
}));

vi.mock("../../lib/space-service", () => ({
  isActiveStatus: (status: string | undefined) => status === "ACTIVE",
  listSpaceMembers: listSpaceMembersMock,
}));

vi.mock("../../lib/version-service", () => ({
  updateVersion: updateVersionMock,
}));

import { EditVersionDialog } from "./edit-version-dialog";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";

function makeVersion(overrides: Partial<Version> = {}): Version {
  return {
    id: versionId,
    organizationId,
    spaceId,
    name: "Sprint 1",
    ownerId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    releaseDate: "2026-05-31T00:00:00.000Z",
    startDate: "2026-05-01T00:00:00.000Z",
    status: "PLANNED",
    target: "Initial goal",
    targetDate: "2026-05-20T00:00:00.000Z",
    stats: {
      blockedCount: 0,
      bugCount: 0,
      requirementCount: 0,
      taskCount: 0,
    },
    ...overrides,
  };
}

function makeMember(
  userId: string,
  name: string,
  username: string,
  status: SpaceMemberWithUser["status"] = "ACTIVE",
): SpaceMemberWithUser {
  return {
    id: `${userId}_MEMBER`,
    organizationId,
    role: "MEMBER",
    spaceId,
    status,
    userId,
    user: {
      id: userId,
      name,
      status: "ACTIVE",
      username,
    },
  };
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof EditVersionDialog>> = {},
) {
  const onOpenChange = vi.fn();
  const onUpdated = vi.fn();
  const version = makeVersion();
  render(
    <EditVersionDialog
      open
      onOpenChange={onOpenChange}
      organizationId={organizationId}
      spaceId={spaceId}
      version={version}
      onUpdated={onUpdated}
      {...props}
    />,
  );
  return { onOpenChange, onUpdated, version };
}

beforeEach(() => {
  listSpaceMembersMock.mockReset();
  updateVersionMock.mockReset();
  listSpaceMembersMock.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("EditVersionDialog", () => {
  it("renders a dialog description for assistive technology", () => {
    renderDialog();

    const dialog = screen.getByTestId("edit-version-dialog");
    const description = screen.getByText("versionBoard.edit.description");
    expect(description).toHaveClass("sr-only");
    expect(dialog).toHaveAttribute("aria-describedby", description.id);
  });

  it("requires a version name before submitting", () => {
    renderDialog();

    fireEvent.input(screen.getByTestId("edit-version-name-input"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByTestId("edit-version-submit"));

    expect(updateVersionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "versionBoard.create.fields.nameError",
    );
  });

  it("loads space members into the owner select", async () => {
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [
        makeMember("01ARZ3NDEKTSV4RRFFQ69G5FA1", "Alice Zhang", "alice"),
        makeMember("01ARZ3NDEKTSV4RRFFQ69G5FB1", "", "bob"),
        makeMember("01ARZ3NDEKTSV4RRFFQ69G5FC1", "Disabled", "disabled", "DISABLED"),
      ],
      total: 3,
    });

    renderDialog();

    expect(await screen.findByText("Alice Zhang")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.queryByText("Disabled")).not.toBeInTheDocument();
    expect(listSpaceMembersMock).toHaveBeenCalledWith(spaceId, {
      status: "ACTIVE",
    });
  });

  it("submits the update payload with ISO dates and undefined optional dates", async () => {
    const updated = makeVersion({ name: "Sprint 2" });
    updateVersionMock.mockResolvedValueOnce(updated);
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [makeMember("01ARZ3NDEKTSV4RRFFQ69G5FB1", "Bob", "bob")],
      total: 1,
    });
    const { onOpenChange, onUpdated } = renderDialog();

    fireEvent.input(screen.getByTestId("edit-version-name-input"), {
      target: { value: "  Sprint 2  " },
    });
    fireEvent.input(screen.getByLabelText("versionBoard.create.fields.target"), {
      target: { value: "  Harden release  " },
    });
    fireEvent.input(
      screen.getByLabelText("versionBoard.create.fields.description"),
      {
        target: { value: "  Regression pass  " },
      },
    );
    await screen.findByText("Bob");
    fireEvent.change(screen.getByTestId("edit-version-owner-select"), {
      target: { value: "01ARZ3NDEKTSV4RRFFQ69G5FB1" },
    });
    fireEvent.change(screen.getByTestId("edit-version-status-select"), {
      target: { value: "RELEASED" },
    });
    fireEvent.change(screen.getByTestId("edit-version-start-date-input"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByTestId("edit-version-target-date-input"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("edit-version-release-date-input"), {
      target: { value: "2026-07-15" },
    });

    fireEvent.click(screen.getByTestId("edit-version-submit"));

    await waitFor(() =>
      expect(updateVersionMock).toHaveBeenCalledWith(
        { organizationId, spaceId, versionId },
        {
          description: "Regression pass",
          name: "Sprint 2",
          ownerId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
          releaseDate: "2026-07-15T00:00:00.000Z",
          startDate: "2026-07-01T00:00:00.000Z",
          status: "RELEASED",
          target: "Harden release",
          targetDate: undefined,
        },
      ),
    );
    expect(onUpdated).toHaveBeenCalledWith(updated);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("edit-version-name-input")).toHaveValue("");
  });

  it("shows an API error and keeps the dialog open", async () => {
    updateVersionMock.mockRejectedValueOnce(new Error("boom"));
    const { onOpenChange, onUpdated } = renderDialog();

    fireEvent.click(screen.getByTestId("edit-version-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.api.UNKNOWN",
    );
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
