import { describe, expect, it } from "vitest";

import {
  applyMarkdownEditorCommand,
  createMarkdownAttachmentImageSrc,
  insertMarkdownAttachmentImage,
} from "./requirement-markdown-editor-commands";

describe("requirement markdown editor commands", () => {
  it("wraps the selected text with inline marks", () => {
    expect(
      applyMarkdownEditorCommand({
        command: { type: "bold" },
        selection: { end: 9, start: 4 },
        value: "Use scope here",
      }),
    ).toEqual({
      selection: { end: 11, start: 6 },
      value: "Use **scope** here",
    });
  });

  it("uses caller-provided localized placeholders for empty inline selections", () => {
    expect(
      applyMarkdownEditorCommand({
        command: { type: "bold" },
        options: { boldPlaceholder: "localized bold" },
        selection: { end: 0, start: 0 },
        value: "",
      }),
    ).toEqual({
      selection: { end: 16, start: 2 },
      value: "**localized bold**",
    });

    expect(
      applyMarkdownEditorCommand({
        command: { href: "https://example.com/spec", type: "link" },
        options: { linkLabel: "localized link" },
        selection: { end: 0, start: 0 },
        value: "",
      }).value,
    ).toBe("[localized link](https://example.com/spec)");
  });

  it("prefixes every selected line for list commands", () => {
    expect(
      applyMarkdownEditorCommand({
        command: { type: "orderedList" },
        selection: { end: "First\nSecond".length, start: 0 },
        value: "First\nSecond",
      }).value,
    ).toBe("1. First\n2. Second");
  });

  it("wraps code blocks around the selected text", () => {
    expect(
      applyMarkdownEditorCommand({
        command: { type: "codeBlock" },
        selection: { end: 14, start: 0 },
        value: "const a = 1;",
      }).value,
    ).toBe("```\nconst a = 1;\n```");
  });

  it("inserts links without using browser prompts", () => {
    expect(
      applyMarkdownEditorCommand({
        command: { href: "https://example.com/spec", type: "link" },
        selection: { end: 4, start: 0 },
        value: "Spec",
      }).value,
    ).toBe("[Spec](https://example.com/spec)");
  });

  it("inserts a compact markdown table", () => {
    expect(
      applyMarkdownEditorCommand({
        command: { type: "table" },
        options: {
          tableTemplate:
            "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Content | Content | Content |",
        },
        selection: { end: 0, start: 0 },
        value: "",
      }).value,
    ).toBe(
      "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Content | Content | Content |",
    );
  });

  it("uses a language-neutral table fallback when no template is provided", () => {
    expect(
      applyMarkdownEditorCommand({
        command: { type: "table" },
        selection: { end: 0, start: 0 },
        value: "",
      }).value,
    ).toBe("|  |  |  |\n| --- | --- | --- |\n|  |  |  |");
  });

  it("creates stable attachment image markdown", () => {
    expect(createMarkdownAttachmentImageSrc("ATTACHMENT 01")).toBe(
      "attachment://ATTACHMENT%2001",
    );
    expect(
      insertMarkdownAttachmentImage({
        attachmentId: "ATTACHMENT_01",
        fileName: "diagram].png",
        selection: { end: 0, start: 0 },
        value: "",
      }).value,
    ).toBe("![diagram\\].png](attachment://ATTACHMENT_01)");
  });
});
