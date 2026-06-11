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

import { TagPicker } from "./tag-picker";
import { ApiClientError } from "../../lib/api-client";

const organizationId = "01VRZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01VRZ3NDEKTSV4RRFFQ69G5F11";
const tagId = "01VRZ3NDEKTSV4RRFFQ69G5FAV";

function makeTag(overrides: Partial<TagDto> = {}): TagDto {
  return {
    id: tagId,
    organizationId,
    spaceId,
    name: "backend",
    displayName: "#backend",
    normalizedName: "backend",
    colorKey: "blue",
    usageCount: 2,
    createdAt: "2026-05-19T10:00:00.000Z",
    updatedAt: "2026-05-19T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("TagPicker", () => {
  it("searches tags and calls onSelect when an option is picked", async () => {
    const tag = makeTag();
    const listTagsAction = vi.fn(async () => ({ items: [tag] }));
    const onSelect = vi.fn();

    render(
      <TagPicker
        data-testid="tag-picker"
        listTagsAction={listTagsAction}
        onSelect={onSelect}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const input = screen.getByTestId("tag-picker-input");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "#back" } });

    expect(await screen.findByText("#backend")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("option", {
        name: "tags.picker.select(name=#backend)",
      }),
    );

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(tag));
    expect(listTagsAction).toHaveBeenLastCalledWith({
      includeUsage: true,
      organizationId,
      page: 1,
      pageSize: 20,
      query: "back",
      spaceId,
    });
  });

  it("creates a tag from # input and selects the created tag", async () => {
    const tag = makeTag({
      id: "01VRZ3NDEKTSV4RRFFQ69G5FCV",
      name: "release",
      displayName: "#release",
      normalizedName: "release",
      colorKey: "green",
    });
    const listTagsAction = vi.fn(async () => ({ items: [] }));
    const createTagAction = vi.fn(async () => tag);
    const onSelect = vi.fn();

    render(
      <TagPicker
        data-testid="tag-picker"
        createTagAction={createTagAction}
        listTagsAction={listTagsAction}
        onSelect={onSelect}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const input = screen.getByTestId("tag-picker-input");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "#release" } });

    fireEvent.click(
      await screen.findByRole("option", {
        name: "tags.picker.create(name=#release)",
      }),
    );

    await waitFor(() =>
      expect(createTagAction).toHaveBeenCalledWith(
        { organizationId, spaceId },
        { name: "release" },
      ),
    );
    expect(onSelect).toHaveBeenCalledWith(tag);
  });

  it("shows backend details when tag search fails", async () => {
    const listTagsAction = vi.fn(async () => {
      throw new ApiClientError(
        {
          code: "FORBIDDEN",
          details: { reason: "Tag search is not allowed." },
          message: "Cannot list tags.",
          requestId: "REQ_TAG_LIST",
        },
        new Response(null, { status: 403 }),
      );
    });

    render(
      <TagPicker
        data-testid="tag-picker"
        listTagsAction={listTagsAction}
        onSelect={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    fireEvent.focus(screen.getByTestId("tag-picker-input"));

    expect(await screen.findByText(/tags\.picker\.error/u)).toHaveTextContent(
      "Cannot list tags.",
    );
    expect(screen.getByText(/tags\.picker\.error/u)).toHaveTextContent(
      "reason: Tag search is not allowed.",
    );
    expect(screen.getByText(/tags\.picker\.error/u)).toHaveTextContent(
      "errors.apiDetails.requestId: REQ_TAG_LIST",
    );
  });

  it("shows backend details when tag creation fails", async () => {
    const listTagsAction = vi.fn(async () => ({ items: [] }));
    const createTagAction = vi.fn(async () => {
      throw new ApiClientError(
        {
          code: "CONFLICT",
          details: { field: "name" },
          message: "Tag already exists.",
          requestId: "REQ_TAG_CREATE",
        },
        new Response(null, { status: 409 }),
      );
    });

    render(
      <TagPicker
        data-testid="tag-picker"
        createTagAction={createTagAction}
        listTagsAction={listTagsAction}
        onSelect={vi.fn()}
        organizationId={organizationId}
        spaceId={spaceId}
      />,
    );

    const input = screen.getByTestId("tag-picker-input");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "#release" } });

    fireEvent.click(
      await screen.findByRole("option", {
        name: "tags.picker.create(name=#release)",
      }),
    );

    expect(
      await screen.findByText(/tags\.picker\.createError/u),
    ).toHaveTextContent("Tag already exists.");
    expect(screen.getByText(/tags\.picker\.createError/u)).toHaveTextContent(
      "field: name",
    );
    expect(screen.getByText(/tags\.picker\.createError/u)).toHaveTextContent(
      "errors.apiDetails.requestId: REQ_TAG_CREATE",
    );
  });

  it("keeps disabled pickers closed", () => {
    render(
      <TagPicker
        data-testid="tag-picker"
        disabled
        listTagsAction={vi.fn(async () => ({ items: [] }))}
        onSelect={vi.fn()}
        spaceId={spaceId}
      />,
    );

    fireEvent.focus(screen.getByTestId("tag-picker-input"));

    expect(screen.queryByTestId("tag-picker-panel")).not.toBeInTheDocument();
  });

  it("can render the result panel above the input with a constrained height", async () => {
    render(
      <TagPicker
        data-testid="tag-picker"
        listTagsAction={vi.fn(async () => ({ items: [] }))}
        onSelect={vi.fn()}
        panelMaxHeightClassName="max-h-40"
        panelPlacement="top"
        spaceId={spaceId}
      />,
    );

    fireEvent.focus(screen.getByTestId("tag-picker-input"));

    const panel = await screen.findByTestId("tag-picker-panel");
    expect(panel).toHaveClass("bottom-full", "mb-1", "max-h-40");
  });
});
