import { describe, expect, it } from "vitest";

import {
  formatDisplayCode,
  isObjectDisplayCodeLike,
  normalizeObjectDisplayCodeQuery,
  resolveRequirementDisplayCode,
  resolveWorkItemDisplayCode,
} from "./display-code";

describe("formatDisplayCode", () => {
  it("formats visible object codes with a stable short id suffix", () => {
    expect(formatDisplayCode("TASK", "01ARZ3NDEKTSV4RRFFQ69G5FA1")).toBe(
      "TASK-9G5FA1",
    );
  });
});

describe("resolveDisplayCode", () => {
  it("prefers backend displayCode over migration fallback", () => {
    expect(
      resolveWorkItemDisplayCode({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        type: "TASK",
        displayCode: "TASK-42",
      }),
    ).toBe("TASK-42");
  });

  it("keeps the short-id fallback for migration data", () => {
    expect(
      resolveWorkItemDisplayCode({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
        type: "BUG",
      }),
    ).toBe("BUG-9G5FA1");
  });

  it("uses a draft label for unnumbered draft requirements", () => {
    expect(
      resolveRequirementDisplayCode(
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
          status: "DRAFT",
        },
        { draftLabel: "Draft" },
      ),
    ).toBe("Draft");
  });
});

describe("object display code query helpers", () => {
  it("normalizes full business codes", () => {
    expect(normalizeObjectDisplayCodeQuery(" task-42 ")).toBe("TASK-42");
  });

  it("distinguishes code-like invalid values from ordinary keywords", () => {
    expect(isObjectDisplayCodeLike("REQ-")).toBe(true);
    expect(normalizeObjectDisplayCodeQuery("REQ-")).toBeNull();
    expect(isObjectDisplayCodeLike("roadmap")).toBe(false);
  });
});
