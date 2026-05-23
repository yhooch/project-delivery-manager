import { describe, expect, it } from "vitest";

import {
  createMarkdownEditorValue,
  getAttachmentIdFromMarkdownImageSrc,
  isAllowedMarkdownImageTarget,
  parseRequirementMarkdown,
  sanitizeRequirementMarkdown,
} from "./requirement-markdown-content";

describe("requirement markdown content", () => {
  it("keeps Markdown source as safe plain text and derives search text", () => {
    expect(
      createMarkdownEditorValue(
        [
          "# Scope",
          "",
          "- [x] Draft API",
          "- Render **Markdown** safely",
          "",
          "```ts",
          "const value = '<b>raw html remains text</b>';",
          "```",
        ].join("\n"),
      ),
    ).toEqual({
      contentFormat: "MARKDOWN",
      contentMarkdown: [
        "# Scope",
        "",
        "- [x] Draft API",
        "- Render **Markdown** safely",
        "",
        "```ts",
        "const value = '<b>raw html remains text</b>';",
        "```",
      ].join("\n"),
      contentText: [
        "Scope",
        "Draft API\nRender Markdown safely",
        "const value = '<b>raw html remains text</b>';",
      ].join("\n\n"),
    });
  });

  it("removes base64 image data and turns remote markdown images into text", () => {
    const sanitized = sanitizeRequirementMarkdown(
      [
        "![inline](data:image/png;base64,AAAA)",
        "![remote](https://example.com/remote.png)",
        "![attached](attachment://01ARZ3NDEKTSV4RRFFQ69G5FB0)",
      ].join("\n"),
    );

    expect(sanitized).toBe(
      [
        "[image: inline]",
        "[image: remote]",
        "![attached](attachment://01ARZ3NDEKTSV4RRFFQ69G5FB0)",
      ].join("\n"),
    );
    expect(sanitized).not.toContain("data:image");
  });

  it("parses markdown into renderable blocks without raw HTML handling", () => {
    expect(
      parseRequirementMarkdown(
        [
          "## Overview",
          "",
          "> <script>alert(1)</script>",
          "",
          "1. First",
          "2. Second",
          "",
          "![attached](attachment://ATTACHMENT_01)",
          "",
          "---",
        ].join("\n"),
      ),
    ).toEqual([
      { level: 2, text: "Overview", type: "heading" },
      { text: "<script>alert(1)</script>", type: "blockquote" },
      {
        items: [{ text: "First" }, { text: "Second" }],
        ordered: true,
        type: "list",
      },
      {
        alt: "attached",
        src: "attachment://ATTACHMENT_01",
        type: "image",
      },
      { type: "horizontalRule" },
    ]);
  });

  it("only allows attachment markdown image targets", () => {
    expect(isAllowedMarkdownImageTarget("attachment://ATTACHMENT_01")).toBe(
      true,
    );
    expect(isAllowedMarkdownImageTarget("https://example.com/image.png")).toBe(
      false,
    );
  });

  it("decodes attachment image ids from markdown image sources", () => {
    expect(
      getAttachmentIdFromMarkdownImageSrc("attachment://ATTACHMENT%2001"),
    ).toBe("ATTACHMENT 01");
    expect(
      getAttachmentIdFromMarkdownImageSrc("https://example.com/image.png"),
    ).toBeUndefined();
  });
});
