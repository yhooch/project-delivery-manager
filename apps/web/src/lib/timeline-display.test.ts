import { describe, expect, it, vi } from "vitest";

import { getTimelineEventLabel } from "./timeline-display";

describe("timeline display", () => {
  it("uses the localized label for known timeline event types", () => {
    expect(getTimelineEventLabel("CREATED", (key) => `timeline.${key}`)).toBe(
      "timeline.CREATED",
    );
  });

  it("throws missing translation in non-production", () => {
    expect(() =>
      getTimelineEventLabel("ACTION_EXECUTED", () => {
        throw new Error("missing translation");
      }),
    ).toThrow("missing translation");
  });

  it("falls back to the event type in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      getTimelineEventLabel("ACTION_EXECUTED", () => {
        throw new Error("missing translation");
      }),
    ).toBe("ACTION_EXECUTED");
    vi.unstubAllEnvs();
  });
});
