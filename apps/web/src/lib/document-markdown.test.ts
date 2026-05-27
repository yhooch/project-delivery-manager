import { describe, expect, it } from "vitest";

import {
  extractFirstHeading,
  markdownToPlainText,
  parseMarkdown,
  sanitizeHref,
  tokenizeInline,
} from "./document-markdown";

describe("document markdown helpers", () => {
  it("extracts the first H1 as the default document title", () => {
    expect(extractFirstHeading("intro\n# **Launch** plan\n## Later")).toBe(
      "Launch plan",
    );
  });

  it("turns markdown into searchable plain text", () => {
    expect(
      markdownToPlainText(
        "# Plan\n\nSee [REQ-12](https://example.com) and TASK-4.\n\n```ts\nconst ok = true;\n```",
      ),
    ).toContain("Plan\nSee REQ-12 and TASK-4.\nconst ok = true;");
  });

  it("tokenizes object codes and downgrades remote images to image link tokens", () => {
    expect(tokenizeInline("Review TASK-42 and ![shot](https://x.test/a.png)"))
      .toEqual([
        { kind: "text", text: "Review " },
        { kind: "objectCode", code: "TASK-42" },
        { kind: "text", text: " and " },
        {
          alt: "shot",
          href: "https://x.test/a.png",
          kind: "imageLink",
          remote: true,
        },
      ]);
  });

  it("rejects unsafe links", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("https://example.com")).toBe("https://example.com");
    expect(sanitizeHref("/attachments/1")).toBe("/attachments/1");
  });

  it("builds stable unique heading ids", () => {
    const headings = parseMarkdown("## Intro\n\n## Intro").filter(
      (block) => block.kind === "heading",
    );

    expect(headings).toMatchObject([
      { id: "intro", text: "Intro" },
      { id: "intro-2", text: "Intro" },
    ]);
  });
});
