import { describe, expect, it } from "vitest";

import { formatDisplayCode } from "./display-code";

describe("formatDisplayCode", () => {
  it("formats visible object codes with a stable short id suffix", () => {
    expect(formatDisplayCode("TASK", "01ARZ3NDEKTSV4RRFFQ69G5FA1")).toBe(
      "TASK-9G5FA1",
    );
  });
});
