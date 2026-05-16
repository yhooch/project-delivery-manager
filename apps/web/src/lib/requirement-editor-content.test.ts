import { describe, expect, it } from "vitest";

import {
  containsBase64Image,
  createContentEditorValue,
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
            src: minioDownloadUrl,
          },
          type: "image",
        },
      ],
      type: "doc",
    });
  });

  it("creates editor values with text cache from Tiptap JSON", () => {
    const value = createEditorValueFromTiptapJson({
      content: [
        {
          content: [{ text: "First paragraph", type: "text" }],
          type: "paragraph",
        },
        {
          content: [{ text: "Second paragraph", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    });

    expect(value).toEqual({
      contentJson: {
        content: [
          {
            content: [{ text: "First paragraph", type: "text" }],
            type: "paragraph",
          },
          {
            content: [{ text: "Second paragraph", type: "text" }],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      contentMarkdownCache: "First paragraph\n\nSecond paragraph",
      contentText: "First paragraph\n\nSecond paragraph",
    });
  });

  it("keeps the textarea-era fallback compatible", () => {
    expect(
      createContentEditorValue({
        contentText: "Legacy text",
      }),
    ).toEqual({
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
});
