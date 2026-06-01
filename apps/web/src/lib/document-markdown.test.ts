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

  it("tokenizes underscore strong text", () => {
    expect(tokenizeInline("__进入页面__")).toEqual([
      { kind: "strong", text: "进入页面" },
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

  it("parses standalone strong lines as compact subheadings", () => {
    expect(parseMarkdown("# 机场列表\n\n__设备小窗__\n\n正文")).toMatchObject([
      { kind: "heading", text: "机场列表" },
      { kind: "subheading", text: "设备小窗" },
      { kind: "paragraph" },
    ]);
  });

  it("preserves nested list structure from indented markdown", () => {
    expect(
      parseMarkdown("- 飞行记录详情\n\t- 任务详情\n\t- 飞行状态"),
    ).toMatchObject([
      {
        items: [
          {
            children: [
              {
                items: [
                  { tokens: [{ kind: "text", text: "任务详情" }] },
                  { tokens: [{ kind: "text", text: "飞行状态" }] },
                ],
              },
            ],
            tokens: [{ kind: "text", text: "飞行记录详情" }],
          },
        ],
        kind: "list",
        ordered: false,
      },
    ]);
  });
});
