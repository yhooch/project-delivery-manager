import { describe, expect, it } from "vitest";

import { formatDisplayCode, parseObjectCode } from "./object-code.types";

describe("object code types", () => {
  it("parses display codes case-insensitively", () => {
    expect(parseObjectCode("req-12")).toEqual({
      objectType: "REQUIREMENT",
      prefix: "REQ",
      sequence: 12,
    });
    expect(parseObjectCode("INTAKE-7")).toMatchObject({
      objectType: "INTAKE_ITEM",
      sequence: 7,
    });
  });

  it("rejects malformed or overflowing display codes", () => {
    expect(parseObjectCode("REQ-0")).toBeUndefined();
    expect(parseObjectCode("REQ-01")).toBeUndefined();
    expect(parseObjectCode("WORK-1")).toBeUndefined();
    expect(parseObjectCode("TASK-2147483648")).toBeUndefined();
  });

  it("formats display codes with canonical prefixes", () => {
    expect(formatDisplayCode("REQUIREMENT", 3)).toBe("REQ-3");
    expect(formatDisplayCode("INTAKE_ITEM", 4)).toBe("INTAKE-4");
    expect(formatDisplayCode("TASK", 5)).toBe("TASK-5");
    expect(formatDisplayCode("BUG", 6)).toBe("BUG-6");
  });
});
