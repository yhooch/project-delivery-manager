import { cleanup, render, screen } from "@testing-library/react";
import type { TagDto } from "@project-delivery/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

import { TagBadge } from "./tag-badge";
import { TagBadgeList } from "./tag-assignment-field";
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
});
