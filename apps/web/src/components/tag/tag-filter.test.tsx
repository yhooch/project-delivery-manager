import type { TagDto } from "@project-delivery/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, vars?: Record<string, unknown>) => {
      const base = namespace ? `${namespace}.${key}` : key;
      if (!vars) return base;
      return `${base}(${Object.entries(vars)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(",")})`;
    },
}));

import { TagFilter } from "./tag-filter";

const organizationId = "01VRZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01VRZ3NDEKTSV4RRFFQ69G5F11";
const tagId = "01VRZ3NDEKTSV4RRFFQ69G5FAV";
const secondTagId = "01VRZ3NDEKTSV4RRFFQ69G5FBV";

function makeTag(overrides: Partial<TagDto> = {}): TagDto {
  return {
    id: tagId,
    organizationId,
    spaceId,
    name: "backend",
    displayName: "#backend",
    normalizedName: "backend",
    colorKey: "blue",
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("TagFilter", () => {
  it("renders selected chips and removes one tag", () => {
    const backend = makeTag();
    const qa = makeTag({
      id: secondTagId,
      name: "qa",
      displayName: "#qa",
      normalizedName: "qa",
      colorKey: "green",
    });
    const onChange = vi.fn();

    render(
      <TagFilter
        data-testid="tag-filter"
        onChange={onChange}
        selectedTags={[backend, qa]}
        spaceId={spaceId}
        value={{ tagIds: [tagId, secondTagId], tagMatch: "ANY" }}
      />,
    );

    expect(screen.getByText("#backend")).toBeInTheDocument();
    expect(screen.getByText("#qa")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "tags.filter.remove(name=#backend)",
      }),
    );

    expect(onChange).toHaveBeenCalledWith(
      { tagIds: [secondTagId], tagMatch: "ANY" },
      [qa],
    );
  });

  it("adds a tag through the embedded picker", async () => {
    const backend = makeTag();
    const listTagsAction = vi.fn(async () => ({ items: [backend] }));
    const onChange = vi.fn();

    render(
      <TagFilter
        data-testid="tag-filter"
        listTagsAction={listTagsAction}
        onChange={onChange}
        organizationId={organizationId}
        selectedTags={[]}
        spaceId={spaceId}
        value={{ tagIds: [], tagMatch: "ANY" }}
      />,
    );

    expect(
      screen.queryByTestId("tag-filter-picker-input"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tags.field.add" }));

    const input = screen.getByTestId("tag-filter-picker-input");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "#back" } });

    fireEvent.click(
      await screen.findByRole("option", {
        name: "tags.picker.select(name=#backend)",
      }),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        { tagIds: [tagId], tagMatch: "ANY" },
        [backend],
      ),
    );
  });

  it("clears selected tags and toggles match mode without native selects", () => {
    const backend = makeTag();
    const onChange = vi.fn();

    render(
      <TagFilter
        data-testid="tag-filter"
        onChange={onChange}
        selectedTags={[backend]}
        spaceId={spaceId}
        value={{ tagIds: [tagId], tagMatch: "ANY" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "tags.filter.clear" }));
    expect(onChange).toHaveBeenCalledWith({ tagIds: [], tagMatch: "ANY" }, []);

    fireEvent.click(
      screen.getByRole("button", { name: "tags.filter.match.ALL" }),
    );
    expect(onChange).toHaveBeenCalledWith(
      { tagIds: [tagId], tagMatch: "ALL" },
      [backend],
    );
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });
});
