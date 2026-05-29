import { describe, expect, it } from "vitest";

import {
  CreateRequirementDraftRequestSchema,
  RequirementSchema,
  UpdateRequirementRequestSchema,
} from "./requirement.ts";

describe("requirement schemas", () => {
  it("accepts omitted create draft request bodies", () => {
    expect(CreateRequirementDraftRequestSchema.parse(undefined)).toEqual({});
  });

  it("accepts an optional content format for draft creation", () => {
    expect(
      CreateRequirementDraftRequestSchema.parse({
        contentFormat: "MARKDOWN",
      }),
    ).toEqual({
      contentFormat: "MARKDOWN",
    });

    expect(() =>
      CreateRequirementDraftRequestSchema.parse({
        contentFormat: "HTML",
      }),
    ).toThrow();
  });

  it("accepts valid Tiptap documents and rejects malformed content", () => {
    expect(
      UpdateRequirementRequestSchema.parse({
        baseRevision: 1,
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
        baseRevision: 1,
        title: "Invalid",
        contentJson: { foo: "bar" },
      }),
    ).toThrow();
  });

  it("accepts Markdown as a requirement content source", () => {
    expect(
      RequirementSchema.parse({
        id: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
        title: "Markdown requirement",
        contentFormat: "MARKDOWN",
        contentMarkdown: "# Scope\n\nShip the MCP contract.",
        contentText: "Scope\n\nShip the MCP contract.",
        status: "ACTIVE",
        tags: [],
        relatedWorkItems: {
          taskCount: 0,
          bugCount: 0,
          tasks: [],
          bugs: [],
        },
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      }),
    ).toMatchObject({
      kind: "REQUIREMENT",
      status: "ACTIVE",
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Scope\n\nShip the MCP contract.",
    });

    expect(
      UpdateRequirementRequestSchema.parse({
        baseRevision: 1,
        title: "Markdown requirement",
        contentFormat: "MARKDOWN",
        contentMarkdown: "# Scope",
      }),
    ).toMatchObject({
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Scope",
    });

    expect(() =>
      UpdateRequirementRequestSchema.parse({
        baseRevision: 1,
        title: "Mixed content",
        contentFormat: "MARKDOWN",
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "# Scope",
      }),
    ).toThrow();

    expect(() =>
      UpdateRequirementRequestSchema.parse({
        baseRevision: 1,
        title: "Wrong cache",
        contentFormat: "MARKDOWN",
        contentMarkdown: "# Scope",
        contentMarkdownCache: "# Cached export",
      }),
    ).toThrow();
  });

  it("rejects base64 image data anywhere in requirement content", () => {
    expect(() =>
      UpdateRequirementRequestSchema.parse({
        baseRevision: 1,
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
        baseRevision: 1,
        title: "Text cache",
        contentJson: { type: "doc", content: [] },
        contentText: "before data:image/png;name=inline;base64,AAAA after",
      }),
    ).toThrow();

    expect(() =>
      UpdateRequirementRequestSchema.parse({
        baseRevision: 1,
        title: "Markdown cache",
        contentJson: { type: "doc", content: [] },
        contentMarkdownCache: "![inline](data:image/jpeg;base64,AAAA)",
      }),
    ).toThrow();

    expect(() =>
      UpdateRequirementRequestSchema.parse({
        baseRevision: 1,
        title: "Markdown source",
        contentFormat: "MARKDOWN",
        contentMarkdown: "![inline](data:image/gif;base64,AAAA)",
      }),
    ).toThrow();
  });
});
