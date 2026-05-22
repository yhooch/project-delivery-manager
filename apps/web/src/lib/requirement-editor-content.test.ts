import { describe, expect, it } from "vitest";

import {
  containsBase64Image,
  collectAttachmentImageIds,
  createContentEditorValue,
  createTiptapDocumentForEditing,
  createEditorValueFromMarkdown,
  createEditorValueFromTiptapJson,
  sanitizeTiptapDocument,
} from "./requirement-editor-content";

const minioDownloadUrl =
  "http://127.0.0.1:9000/project-attachments/file.png?X-Amz-Signature=test";

describe("requirement editor content", () => {
  it("removes base64 image nodes before content is saved", () => {
    const contentJson = {
      content: [
        {
          content: [{ text: "Scope", type: "text" }],
          type: "paragraph",
        },
        {
          attrs: {
            src: "data:image/png;base64,AAAA",
          },
          type: "image",
        },
        {
          attrs: {
            attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
            downloadUrl: minioDownloadUrl,
            src: minioDownloadUrl,
          },
          type: "image",
        },
      ],
      type: "doc",
    };

    const sanitized = sanitizeTiptapDocument(contentJson);

    expect(containsBase64Image(sanitized)).toBe(false);
    expect(sanitized).toEqual({
      content: [
        {
          content: [{ text: "Scope", type: "text" }],
          type: "paragraph",
        },
        {
          attrs: {
            attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
            src: "attachment://01ARZ3NDEKTSV4RRFFQ69G5FB0",
          },
          type: "image",
        },
      ],
      type: "doc",
    });
  });

  it("normalizes uploaded image nodes to stable attachment references", () => {
    const sanitized = sanitizeTiptapDocument({
      content: [
        {
          attrs: {
            alt: "wireframe.png",
            attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
            fileKey: "attachments/requirement/REQ/wireframe.png",
            imageUrl: minioDownloadUrl,
            src: minioDownloadUrl,
            title: "wireframe.png",
          },
          type: "image",
        },
      ],
      type: "doc",
    });

    expect(sanitized).toEqual({
      content: [
        {
          attrs: {
            alt: "wireframe.png",
            attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
            fileKey: "attachments/requirement/REQ/wireframe.png",
            src: "attachment://01ARZ3NDEKTSV4RRFFQ69G5FB0",
            title: "wireframe.png",
          },
          type: "image",
        },
      ],
      type: "doc",
    });
    expect(JSON.stringify(sanitized)).not.toContain("X-Amz-Signature");
  });

  it("hydrates stable attachment image sources for editing only", () => {
    const contentJson = {
      content: [
        {
          attrs: {
            attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
            src: "attachment://01ARZ3NDEKTSV4RRFFQ69G5FB0",
          },
          type: "image",
        },
      ],
      type: "doc",
    };

    expect(collectAttachmentImageIds(contentJson)).toEqual([
      "01ARZ3NDEKTSV4RRFFQ69G5FB0",
    ]);
    expect(
      createTiptapDocumentForEditing(contentJson, {
        "01ARZ3NDEKTSV4RRFFQ69G5FB0": minioDownloadUrl,
      }),
    ).toEqual({
      content: [
        {
          attrs: {
            attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
            src: minioDownloadUrl,
          },
          type: "image",
        },
      ],
      type: "doc",
    });
  });

  it("creates editor values with markdown cache from Tiptap JSON", () => {
    const value = createEditorValueFromTiptapJson({
      content: [
        {
          attrs: { level: 2 },
          content: [{ text: "Overview", type: "text" }],
          type: "heading",
        },
        {
          content: [
            { text: "Use ", type: "text" },
            {
              marks: [{ type: "bold" }],
              text: "bold",
              type: "text",
            },
            { text: ", ", type: "text" },
            {
              marks: [{ type: "italic" }],
              text: "italic",
              type: "text",
            },
            { text: ", ", type: "text" },
            {
              marks: [{ type: "code" }],
              text: "code",
              type: "text",
            },
            { text: ", ", type: "text" },
            {
              marks: [
                {
                  attrs: { href: "https://example.com/spec" },
                  type: "link",
                },
              ],
              text: "link",
              type: "text",
            },
          ],
          type: "paragraph",
        },
        {
          content: [
            {
              content: [
                {
                  content: [{ text: "Bullet A", type: "text" }],
                  type: "paragraph",
                },
              ],
              type: "listItem",
            },
            {
              content: [
                {
                  content: [{ text: "Bullet B", type: "text" }],
                  type: "paragraph",
                },
              ],
              type: "listItem",
            },
          ],
          type: "bulletList",
        },
        {
          attrs: { start: 3 },
          content: [
            {
              content: [
                {
                  content: [{ text: "Ordered", type: "text" }],
                  type: "paragraph",
                },
              ],
              type: "listItem",
            },
          ],
          type: "orderedList",
        },
        {
          content: [
            {
              attrs: { checked: true },
              content: [
                {
                  content: [{ text: "Done", type: "text" }],
                  type: "paragraph",
                },
              ],
              type: "taskItem",
            },
            {
              attrs: { checked: false },
              content: [
                {
                  content: [{ text: "Todo", type: "text" }],
                  type: "paragraph",
                },
              ],
              type: "taskItem",
            },
          ],
          type: "taskList",
        },
        {
          content: [
            {
              content: [{ text: "Quote", type: "text" }],
              type: "paragraph",
            },
          ],
          type: "blockquote",
        },
        {
          attrs: { language: "ts" },
          content: [{ text: "const x = 1;", type: "text" }],
          type: "codeBlock",
        },
        { type: "horizontalRule" },
        {
          attrs: {
            alt: "diagram.png",
            attachmentId: "ATTACHMENT_01",
            src: "attachment://ATTACHMENT_01",
          },
          type: "image",
        },
        {
          content: [
            { text: "Line one", type: "text" },
            { type: "hardBreak" },
            { text: "Line two", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });

    expect(value.contentMarkdownCache).toBe(
      [
        "## Overview",
        "Use **bold**, *italic*, `code`, [link](https://example.com/spec)",
        "- Bullet A\n- Bullet B",
        "3. Ordered",
        "- [x] Done\n- [ ] Todo",
        "> Quote",
        "```ts\nconst x = 1;\n```",
        "---",
        "![diagram.png](attachment://ATTACHMENT_01)",
        "Line one  \nLine two",
      ].join("\n\n"),
    );
    expect(value.contentFormat).toBe("TIPTAP_JSON");
    expect(value.contentText).toContain("Overview");
    expect(value.contentText).toContain("bold");
    expect(value.contentText).not.toContain("**bold**");
  });

  it("keeps the textarea-era fallback compatible", () => {
    expect(
      createContentEditorValue({
        contentText: "Legacy text",
      }),
    ).toEqual({
      contentFormat: "TIPTAP_JSON",
      contentJson: {
        content: [
          {
            content: [{ text: "Legacy text", type: "text" }],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      contentMarkdownCache: "Legacy text",
      contentText: "Legacy text",
    });
  });

  it("creates Markdown editor values from Markdown source", () => {
    expect(
      createEditorValueFromMarkdown("# Scope\n\n- Ship Markdown safely."),
    ).toEqual({
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Scope\n\n- Ship Markdown safely.",
      contentText: "Scope\n\nShip Markdown safely.",
    });
  });
});
