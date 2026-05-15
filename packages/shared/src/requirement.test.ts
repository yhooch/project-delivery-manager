import { describe, expect, it } from "vitest";

import { UpdateRequirementRequestSchema } from "./requirement.ts";

describe("requirement schemas", () => {
  it("accepts valid Tiptap documents and rejects malformed content", () => {
    expect(
      UpdateRequirementRequestSchema.parse({
        title: "Requirement",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Scope" }],
            },
          ],
        },
      }),
    ).toMatchObject({ title: "Requirement" });

    expect(() =>
      UpdateRequirementRequestSchema.parse({
        title: "Invalid",
        contentJson: { foo: "bar" },
      }),
    ).toThrow();
  });

  it("rejects recursive base64 image data in Tiptap content", () => {
    expect(() =>
      UpdateRequirementRequestSchema.parse({
        title: "Inline image",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "image",
              attrs: {
                src: "data:image/png;base64,AAAA",
              },
            },
          ],
        },
      }),
    ).toThrow();
  });
});
