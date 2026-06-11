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

const { createVersionMock, listSpaceMembersMock } = vi.hoisted(() => ({
  createVersionMock: vi.fn(),
  listSpaceMembersMock: vi.fn(),
}));

vi.mock("../../lib/version-service", () => ({
  createVersion: createVersionMock,
}));

vi.mock("../../lib/space-service", () => ({
  isActiveStatus: (status: string | undefined) => status === "ACTIVE",
  listSpaceMembers: listSpaceMembersMock,
}));

import { CreateVersionDialog } from "./create-version-dialog";
import { ApiClientError } from "../../lib/api-client";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";

function makeVersion(overrides: Partial<Version> = {}): Version {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FV1",
    organizationId,
    spaceId,
    name: "Sprint 1",
    status: "PLANNED",
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
  props: Partial<React.ComponentProps<typeof CreateVersionDialog>> = {},
) {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <CreateVersionDialog
      open
      onOpenChange={onOpenChange}
      organizationId={organizationId}
      spaceId={spaceId}
      onCreated={onCreated}
      {...props}
    />,
  );
  return { onCreated, onOpenChange };
}

beforeEach(() => {
  createVersionMock.mockReset();
  listSpaceMembersMock.mockReset();
  listSpaceMembersMock.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("CreateVersionDialog", () => {
  it("renders a dialog description for assistive technology", () => {
    renderDialog();

    const dialog = screen.getByTestId("create-version-dialog");
    const description = screen.getByText("versionBoard.create.description");
    expect(description).toHaveClass("sr-only");
    expect(dialog).toHaveAttribute("aria-describedby", description.id);
  });

  it("requires a version name before submitting", () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("create-version-submit"));

    expect(createVersionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "versionBoard.create.fields.nameError",
    );
  });

  it("loads space members into the owner select", async () => {
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [
        makeMember("01ARZ3NDEKTSV4RRFFQ69G5FA1", "Alice Zhang", "alice"),
        makeMember("01ARZ3NDEKTSV4RRFFQ69G5FB1", "", "bob"),
        makeMember(
          "01ARZ3NDEKTSV4RRFFQ69G5FC1",
          "Disabled",
          "disabled",
          "DISABLED",
        ),
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

  it("shows backend details when owner candidates fail to load", async () => {
    listSpaceMembersMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "FORBIDDEN",
          details: { reason: "Members are not readable." },
          message: "Cannot load members.",
          requestId: "REQ_VERSION_OWNER",
        },
        new Response(null, { status: 403 }),
      ),
    );

    renderDialog();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("errors.api.FORBIDDEN");
    expect(alert).toHaveTextContent("Cannot load members.");
    expect(alert).toHaveTextContent("reason: Members are not readable.");
    expect(alert).toHaveTextContent(
      "errors.apiDetails.requestId: REQ_VERSION_OWNER",
    );
  });

  it("submits the create payload with ISO dates and undefined optional dates", async () => {
    const created = makeVersion({ name: "Sprint 2026.6" });
    createVersionMock.mockResolvedValueOnce(created);
    listSpaceMembersMock.mockResolvedValueOnce({
      items: [makeMember("01ARZ3NDEKTSV4RRFFQ69G5FA1", "Alice", "alice")],
      total: 1,
    });
    const { onCreated, onOpenChange } = renderDialog();

    fireEvent.input(screen.getByTestId("create-version-name-input"), {
      target: { value: "  Sprint 2026.6  " },
    });
    fireEvent.input(
      screen.getByLabelText("versionBoard.create.fields.target"),
      {
        target: { value: "  Ship billing  " },
      },
    );
    fireEvent.input(
      screen.getByLabelText("versionBoard.create.fields.description"),
      {
        target: { value: "  Payment milestone  " },
      },
    );
    await screen.findByText("Alice");
    fireEvent.change(screen.getByTestId("create-version-owner-select"), {
      target: { value: "01ARZ3NDEKTSV4RRFFQ69G5FA1" },
    });
    fireEvent.change(screen.getByTestId("create-version-status-select"), {
      target: { value: "IN_PROGRESS" },
    });
    fireEvent.change(screen.getByTestId("create-version-start-date-input"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByTestId("create-version-target-date-input"), {
      target: { value: "2026-06-30" },
    });

    fireEvent.click(screen.getByTestId("create-version-submit"));

    await waitFor(() =>
      expect(createVersionMock).toHaveBeenCalledWith(
        { organizationId, spaceId },
        {
          description: "Payment milestone",
          name: "Sprint 2026.6",
          ownerId: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          releaseDate: undefined,
          startDate: "2026-06-01T00:00:00.000Z",
          status: "IN_PROGRESS",
          target: "Ship billing",
          targetDate: "2026-06-30T00:00:00.000Z",
        },
      ),
    );
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("create-version-name-input")).toHaveValue("");
  });

  it("shows an API error and keeps the dialog open", async () => {
    createVersionMock.mockRejectedValueOnce(new Error("boom"));
    const { onCreated, onOpenChange } = renderDialog();

    fireEvent.input(screen.getByTestId("create-version-name-input"), {
      target: { value: "Sprint Error" },
    });
    fireEvent.click(screen.getByTestId("create-version-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.api.UNKNOWN",
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
