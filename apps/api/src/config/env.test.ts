import { describe, expect, it } from "vitest";

import { validateEnv } from "./env";

describe("environment validation", () => {
  it("normalizes QUERY_LOG_MODE values", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
      QUERY_LOG_MODE: "SLOW",
    });

    expect(env.QUERY_LOG_MODE).toBe("slow");
  });

  it("enables SQL query params by default", () => {
    const env = validateEnv({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
    });

    expect(env.QUERY_LOG_INCLUDE_PARAMS).toBe(true);
  });
});
