import { describe, expect, it } from "vitest";

import { UpdateSpaceRequestSchema } from "./space.ts";

describe("space contracts", () => {
  it("allows explicitly clearing optional space fields", () => {
    expect(
      UpdateSpaceRequestSchema.parse({
        description: null,
        ownerId: null,
      }),
    ).toEqual({
      description: null,
      ownerId: null,
    });
  });
});
