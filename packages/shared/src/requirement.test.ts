import { describe, expect, it } from "vitest";

import {
  CreateRequirementDraftRequestSchema,
  UpdateRequirementRequestSchema,
} from "./requirement.ts";

describe("requirement schemas", () => {
  it("accepts omitted create draft request bodies", () => {
    expect(CreateRequirementDraftRequestSchema.parse(undefined)).toEqual({});
  });

  it("accepts valid Tiptap documents and rejects malformed content", () => {
    expect(
      UpdateRequirementRequestSchema.parse({
        cascadeVersionChange: true,
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
        versionId: null,
      }),
    ).toMatchObject({
      cascadeVersionChange: true,
      title: "Requirement",
      versionId: null,
    });

    expect(() =>
      UpdateRequirementRequestSchema.parse({
        title: "Invalid",
        contentJson: { foo: "bar" },
      }),
    ).toThrow();
  });

  it("rejects base64 image data anywhere in requirement content", () => {
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

    expect(() =>
      UpdateRequirementRequestSchema.parse({
        title: "Text cache",
        contentJson: { type: "doc", content: [] },
        contentText: "before data:image/png;name=inline;base64,AAAA after",
      }),
    ).toThrow();

    expect(() =>
      UpdateRequirementRequestSchema.parse({
        title: "Markdown cache",
        contentJson: { type: "doc", content: [] },
        contentMarkdownCache: "![inline](data:image/jpeg;base64,AAAA)",
      }),
    ).toThrow();
  });
});
