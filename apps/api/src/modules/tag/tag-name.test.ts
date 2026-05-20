import { describe, expect, it } from "vitest";

import {
  colorKeyForNormalizedName,
  normalizeTagNameInput,
  normalizeTagSearchQuery,
} from "./tag-name";

describe("tag name helpers", () => {
  it("normalizes shortcut input into storage and lookup names", () => {
    expect(normalizeTagNameInput("  #  Release   Blocker  ")).toEqual({
      displayName: "#Release Blocker",
      name: "Release Blocker",
      normalizedName: "release blocker",
    });
  });

  it("normalizes search queries with the same rule as create input", () => {
    expect(normalizeTagSearchQuery(" #Release   Blocker ")).toBe(
      "release blocker",
    );
    expect(normalizeTagSearchQuery("   ")).toBeUndefined();
    expect(normalizeTagSearchQuery("!!!")).toBe("!!!");
  });

  it("assigns deterministic controlled color keys", () => {
    expect(colorKeyForNormalizedName("release blocker")).toBe(
      colorKeyForNormalizedName("release blocker"),
    );
    expect(colorKeyForNormalizedName("release blocker")).toMatch(
      /^[a-z][a-z0-9_-]*$/u,
    );
  });
});
