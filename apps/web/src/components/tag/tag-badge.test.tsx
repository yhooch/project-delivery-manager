import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { TagDto } from "@project-delivery/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const { replaceTagAssignmentsMock } = vi.hoisted(() => ({
  replaceTagAssignmentsMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("../../lib/tag-service", () => ({
  createTag: vi.fn(),
  listTags: vi.fn(),
  replaceTagAssignments: replaceTagAssignmentsMock,
}));

import { ApiClientError } from "../../lib/api-client";
import { TagBadge } from "./tag-badge";
import { ObjectTagAssignmentField, TagBadgeList } from "./tag-assignment-field";
import { TAG_COLOR_CLASS_NAMES } from "./tag-colors";

function makeTag(name: string, colorKey: string): TagDto {
  return {
    id: `01VRZ3NDEKTSV4RRFFQ69G5F${name.padEnd(2, "0").slice(0, 2).toUpperCase()}`,
    organizationId: "01VRZ3NDEKTSV4RRFFQ69G5F10",
    spaceId: "01VRZ3NDEKTSV4RRFFQ69G5F11",
    name,
    displayName: `#${name}`,
    normalizedName: name,
    colorKey,
    createdAt: "2026-05-20T10:00:00.000Z",
    updatedAt: "2026-05-20T10:00:00.000Z",
  };
}

afterEach(() => {
  cleanup();
  replaceTagAssignmentsMock.mockReset();
});

describe("TagBadge", () => {
  it("renders the display name without interactive controls by default", () => {
    render(
      <TagBadge
        tag={{ colorKey: "blue", displayName: "#backend", name: "backend" }}
      />,
    );

    expect(screen.getByText("#backend")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses controlled color keys and falls back for unknown keys", () => {
    const { container, rerender } = render(
      <TagBadge
        tag={{ colorKey: "blue", displayName: "#backend", name: "backend" }}
      />,
    );
    expect(container.firstChild).toHaveClass("bg-blue-50", "text-blue-700");

    rerender(
      <TagBadge
        tag={{ colorKey: "unknown", displayName: "#backend", name: "backend" }}
      />,
    );

    expect(container.firstChild).toHaveClass(
      ...TAG_COLOR_CLASS_NAMES.gray.split(" "),
    );
  });

  it("renders an accessible remove button when onRemove is provided", () => {
    const onRemove = vi.fn();
    render(
      <TagBadge
        removeLabel="Remove backend tag"
        tag={{ colorKey: "green", displayName: "#backend", name: "backend" }}
        onRemove={onRemove}
      />,
    );

    screen.getByRole("button", { name: "Remove backend tag" }).click();

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("collapses tags after three and carries omitted tags as tooltip content", () => {
    render(
      <TagBadgeList
        tags={[
          makeTag("one", "blue"),
          makeTag("two", "green"),
          makeTag("three", "orange"),
          makeTag("four", "purple"),
        ]}
      />,
    );

    expect(screen.getByText("#one")).toBeInTheDocument();
    expect(screen.getByText("#three")).toBeInTheDocument();
    expect(screen.queryByText("#four")).not.toBeInTheDocument();

    expect(screen.getByText("+1")).toHaveAttribute("title", "#four");
    expect(screen.getByText("+1")).toHaveAttribute("aria-label", "#four");
  });

  it("shows API server message and request id when tag assignment fails", async () => {
    replaceTagAssignmentsMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "FORBIDDEN",
          details: {
            field: "tagIds",
            issues: [
              {
                code: "custom",
                message: "Tag cannot be removed",
                path: ["tagIds", 0],
              },
            ],
            reason: "space_locked",
          },
          message: "Tag assignment denied",
          requestId: "REQ_TAG_ASSIGN",
        },
        new Response(null, { status: 403 }),
      ),
    );

    render(
      <ObjectTagAssignmentField
        canEdit
        spaceId="01VRZ3NDEKTSV4RRFFQ69G5F11"
        tags={[makeTag("backend", "blue")]}
        targetId="01VRZ3NDEKTSV4RRFFQ69G5FWI"
        targetType="WORK_ITEM"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "tags.badge.remove" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() =>
      expect(replaceTagAssignmentsMock).toHaveBeenCalledWith({
        tagIds: [],
        targetId: "01VRZ3NDEKTSV4RRFFQ69G5FWI",
        targetType: "WORK_ITEM",
      }),
    );
    expect(alert).toHaveTextContent("errors.api.FORBIDDEN");
    expect(alert).toHaveTextContent("Tag assignment denied");
    expect(alert).toHaveTextContent(
      "errors.apiDetails.requestId: REQ_TAG_ASSIGN",
    );
    expect(alert).toHaveTextContent("reason: space_locked");
    expect(alert).toHaveTextContent("field: tagIds");
    expect(alert).toHaveTextContent("tagIds.0: Tag cannot be removed");
  });
});
