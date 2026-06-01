import { describe, expect, it } from "vitest";

import {
  CreateTagRequestSchema,
  MergeTagsRequestSchema,
  TagDtoSchema,
  TagNameMaxLength,
  normalizeTagNameInput,
  normalizeTagSearchQuery,
} from "./tag.ts";

describe("tag contracts", () => {
  it("normalizes tag input by trimming shortcuts and folding whitespace", () => {
    expect(normalizeTagNameInput("  ##  Release   Blocker  ")).toEqual({
      displayName: "#Release Blocker",
      name: "Release Blocker",
      normalizedName: "release blocker",
    });
    expect(normalizeTagSearchQuery(" #客户A   P0 ")).toBe("客户a p0");
  });

  it("accepts valid create inputs before service-level normalization", () => {
    expect(CreateTagRequestSchema.parse({ name: "#Release Blocker" })).toEqual({
      name: "#Release Blocker",
    });
  });

  it("validates tag merge source and target ids", () => {
    const sourceTagId = "01VRZ3NDEKTSV4RRFFQ69G5FAV";
    const targetTagId = "01WRZ3NDEKTSV4RRFFQ69G5FAW";

    expect(
      MergeTagsRequestSchema.parse({
        sourceTagIds: [sourceTagId],
        targetTagId,
        dryRun: true,
      }),
    ).toEqual({
      sourceTagIds: [sourceTagId],
      targetTagId,
      dryRun: true,
    });
    expect(() =>
      MergeTagsRequestSchema.parse({
        sourceTagIds: [],
        targetTagId,
      }),
    ).toThrow();
    expect(() =>
      MergeTagsRequestSchema.parse({
        sourceTagIds: [sourceTagId, sourceTagId],
        targetTagId,
      }),
    ).toThrow();
    expect(() =>
      MergeTagsRequestSchema.parse({
        sourceTagIds: [targetTagId],
        targetTagId,
      }),
    ).toThrow();
  });

  it("rejects empty, symbol-only, embedded shortcut, and overlong tag names", () => {
    const overlong = `#${"a".repeat(TagNameMaxLength + 1)}`;

    for (const name of ["", "   ", "#", "###", "!!!", "---", "客户#A", overlong]) {
      expect(() => CreateTagRequestSchema.parse({ name })).toThrow();
    }
  });

  it("freezes tag DTO names to the normalized 30 character storage shape", () => {
    const base = {
      id: "01VRZ3NDEKTSV4RRFFQ69G5FAV",
      organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      name: "Release Blocker",
      displayName: "#Release Blocker",
      normalizedName: "release blocker",
      colorKey: "blue",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    };

    expect(TagDtoSchema.parse(base)).toMatchObject({
      name: "Release Blocker",
      displayName: "#Release Blocker",
    });
    expect(() =>
      TagDtoSchema.parse({
        ...base,
        name: "Release  Blocker",
        displayName: "#Release  Blocker",
      }),
    ).toThrow();
    expect(() =>
      TagDtoSchema.parse({
        ...base,
        name: "a".repeat(TagNameMaxLength + 1),
        displayName: `#${"a".repeat(TagNameMaxLength + 1)}`,
      }),
    ).toThrow();
  });
});
