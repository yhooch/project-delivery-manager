import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function readMessages(locale: "en-US" | "zh-CN") {
  return JSON.parse(
    readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
  ) as unknown;
}

describe("message catalog parity", () => {
  it("keeps zh-CN and en-US keys aligned", () => {
    const zhKeys = new Set(flattenKeys(readMessages("zh-CN")));
    const enKeys = new Set(flattenKeys(readMessages("en-US")));

    expect([...zhKeys].filter((key) => !enKeys.has(key)).sort()).toEqual([]);
    expect([...enKeys].filter((key) => !zhKeys.has(key)).sort()).toEqual([]);
  });
});
