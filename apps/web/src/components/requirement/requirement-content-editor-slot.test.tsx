import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { uploadRequirementImageMock } = vi.hoisted(() => ({
  uploadRequirementImageMock: vi.fn(),
}));

vi.mock("../../lib/attachment-service", () => {
  class AttachmentUploadError extends Error {
    readonly code: string;
    readonly retryable: boolean;

    constructor(code: string, retryable = false) {
      super(code);
      this.name = "AttachmentUploadError";
      this.code = code;
      this.retryable = retryable;
    }
  }

  return {
    AttachmentUploadError,
    uploadRequirementImage: uploadRequirementImageMock,
  };
});

import {
  RequirementContentEditorSlot,
  type RequirementContentEditorSlotProps,
} from "./requirement-content-editor-slot";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

function makeValue(contentJson: Record<string, unknown>) {
  return {
    contentJson,
    contentMarkdownCache: "",
    contentText: "",
  };
}

function renderEditor(
  props: Partial<RequirementContentEditorSlotProps> = {},
) {
  const onChange = vi.fn();

  const result = render(
    <RequirementContentEditorSlot
      onChange={onChange}
      value={makeValue({
        content: [
          {
            content: [{ text: "Example link", type: "text" }],
            type: "paragraph",
          },
        ],
        type: "doc",
      })}
      {...props}
    />,
  );

  return { ...result, onChange };
}

function selectEditorText(text: string) {
  const editor = screen.getByLabelText("requirements.editor.ariaLabel");
  editor.focus();
  const textNode = findTextNode(editor, text);

  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, text.length);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function findTextNode(container: Node, text: string): Text {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();

  while (current) {
    if (current.textContent === text) {
      return current as Text;
    }

    current = walker.nextNode();
  }

  throw new Error(`Unable to find text node: ${text}`);
}

function latestContentJson(onChange: ReturnType<typeof vi.fn>) {
  const calls = onChange.mock.calls as Array<
    [
      {
        contentJson: Record<string, unknown>;
      },
    ]
  >;

  return calls.at(-1)?.[0].contentJson;
}

function makeDropDataTransfer(files: File[]) {
  return {
    files,
    getData: () => "",
    items: [],
    types: ["Files"],
  };
}

function firstTextNode(contentJson: Record<string, unknown>) {
  return (
    contentJson.content as Array<{
      content: Array<Record<string, unknown>>;
    }>
  )[0].content[0];
}

beforeEach(() => {
  uploadRequirementImageMock.mockReset();
  vi.spyOn(window, "prompt").mockReturnValue(null);
  if (!document.elementFromPoint) {
    document.elementFromPoint = () =>
      screen.queryByLabelText("requirements.editor.ariaLabel");
  }
  const textPrototype = Text.prototype as Text & {
    getBoundingClientRect?: () => DOMRect;
    getClientRects?: () => DOMRectList;
  };

  if (!textPrototype.getClientRects) {
    textPrototype.getClientRects = () =>
      ({
        item: () => null,
        length: 0,
        [Symbol.iterator]: function* () {},
      }) as DOMRectList;
  }
  if (!textPrototype.getBoundingClientRect) {
    textPrototype.getBoundingClientRect = () => new DOMRect();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RequirementContentEditorSlot link extension", () => {
  it("renders the editor with the stable styled surface wrapper", async () => {
    const { container } = renderEditor();

    await screen.findByText("Example link");

    const editorSurface = container.querySelector(".tiptap-editor");

    expect(editorSurface).not.toBeNull();
    expect(editorSurface).toHaveClass("resize-y", "overflow-auto");
    expect(editorSurface?.querySelector(".ProseMirror")).not.toBeNull();
  });

  it("renders initial link marks with external link attributes", async () => {
    renderEditor({
      value: makeValue({
        content: [
          {
            content: [
              {
                marks: [
                  {
                    attrs: { href: "https://example.com/spec" },
                    type: "link",
                  },
                ],
                text: "Example link",
                type: "text",
              },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      }),
    });

    const link = await screen.findByRole("link", { name: "Example link" });

    expect(link).toHaveAttribute("href", "https://example.com/spec");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("sets a selected link through the toolbar and emits link mark attrs", async () => {
    const { onChange } = renderEditor();

    await screen.findByText("Example link");
    selectEditorText("Example link");
    vi.mocked(window.prompt).mockReturnValue(" https://example.com/new ");

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.editor.toolbar.link" }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalled());

    const textNode = firstTextNode(latestContentJson(onChange)!);

    expect(textNode).toMatchObject({
      marks: [
        {
          attrs: {
            href: "https://example.com/new",
            rel: "noreferrer",
            target: "_blank",
          },
          type: "link",
        },
      ],
      text: "Example link",
      type: "text",
    });
  });

  it("unsets the selected link when prompt returns an empty string", async () => {
    const { onChange } = renderEditor({
      value: makeValue({
        content: [
          {
            content: [
              {
                marks: [
                  {
                    attrs: {
                      href: "https://example.com/old",
                      rel: "noreferrer",
                      target: "_blank",
                    },
                    type: "link",
                  },
                ],
                text: "Example link",
                type: "text",
              },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      }),
    });

    await screen.findByRole("link", { name: "Example link" });
    selectEditorText("Example link");
    vi.mocked(window.prompt).mockReturnValue("   ");

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.editor.toolbar.link" }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(firstTextNode(latestContentJson(onChange)!)).toEqual({
      text: "Example link",
      type: "text",
    });
    expect(screen.queryByRole("link", { name: "Example link" })).toBeNull();
  });

  it("does not warn about duplicate link extensions", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderEditor();

    const loggedMessages = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map(String)
      .join("\n");

    expect(loggedMessages).not.toMatch(/duplicate extension names.*link/i);
  });
});

describe("RequirementContentEditorSlot image drop", () => {
  it("uploads dropped images through the attachment chain and inserts the attachment URL", async () => {
    const onAttachmentUploaded = vi.fn();
    const imageFile = new File(["image-bytes"], "dropped.png", {
      type: "image/png",
    });

    uploadRequirementImageMock.mockResolvedValueOnce({
      attachment: {
        fileKey: "requirements/REQ_01/dropped.png",
        fileName: "dropped.png",
        id: "ATTACHMENT_01",
        mimeType: "image/png",
        previewUrl: "https://cdn.example/dropped-preview.png",
        size: imageFile.size,
      },
      imageUrl: "https://cdn.example/dropped.png",
    });

    const { onChange } = renderEditor({
      canUploadImages: true,
      onAttachmentUploaded,
      requirementId: "REQ_01",
    });

    fireEvent.drop(
      await screen.findByLabelText("requirements.editor.ariaLabel"),
      {
        dataTransfer: makeDropDataTransfer([imageFile]),
      },
    );

    await waitFor(() =>
      expect(uploadRequirementImageMock).toHaveBeenCalledWith({
        existingAttachmentCount: 0,
        file: imageFile,
        requirementId: "REQ_01",
      }),
    );
    expect(onAttachmentUploaded).toHaveBeenCalledWith({
      fileKey: "requirements/REQ_01/dropped.png",
      fileName: "dropped.png",
      id: "ATTACHMENT_01",
      mimeType: "image/png",
      previewUrl: "https://cdn.example/dropped-preview.png",
      size: imageFile.size,
    });

    const image = await screen.findByRole("img", { name: "dropped.png" });
    expect(image.getAttribute("src")).toBe("https://cdn.example/dropped.png");

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.stringify(latestContentJson(onChange))).not.toContain("data:");
  });

  it("does not upload dropped images until the editor has a requirement id", async () => {
    const imageFile = new File(["image-bytes"], "draft-only.png", {
      type: "image/png",
    });

    renderEditor({
      canUploadImages: true,
    });

    fireEvent.drop(
      await screen.findByLabelText("requirements.editor.ariaLabel"),
      {
        dataTransfer: makeDropDataTransfer([imageFile]),
      },
    );

    expect(uploadRequirementImageMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "requirements.editor.uploadErrors.DRAFT_REQUIRED",
      ),
    ).toBeInTheDocument();
  });
});
