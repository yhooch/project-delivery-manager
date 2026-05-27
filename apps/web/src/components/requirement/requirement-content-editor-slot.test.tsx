import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAttachmentDownloadUrlMock, uploadRequirementImageMock } =
  vi.hoisted(() => ({
    createAttachmentDownloadUrlMock: vi.fn(),
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
    createAttachmentDownloadUrl: createAttachmentDownloadUrlMock,
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
    contentFormat: "TIPTAP_JSON" as const,
    contentJson,
    contentMarkdownCache: "",
    contentText: "",
  };
}

function renderEditor(props: Partial<RequirementContentEditorSlotProps> = {}) {
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

function imageNodes(contentJson: Record<string, unknown>) {
  return (contentJson.content as Array<Record<string, unknown>>).filter(
    (node) => node.type === "image",
  );
}

beforeEach(() => {
  createAttachmentDownloadUrlMock.mockReset();
  createAttachmentDownloadUrlMock.mockImplementation(
    (attachmentId: string) => `/api/v1/attachments/${attachmentId}/download`,
  );
  uploadRequirementImageMock.mockReset();
  if (!document.elementFromPoint) {
    document.elementFromPoint = () =>
      screen.queryByLabelText("requirements.editor.ariaLabel");
  }
  const textPrototype = Text.prototype as Text & {
    getBoundingClientRect?: () => DOMRect;
    getClientRects?: () => DOMRectList;
  };
  const elementPrototype = Element.prototype as Element & {
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
  if (!elementPrototype.getClientRects) {
    elementPrototype.getClientRects = () =>
      ({
        item: () => null,
        length: 0,
        [Symbol.iterator]: function* () {},
      }) as DOMRectList;
  }
  if (!elementPrototype.getBoundingClientRect) {
    elementPrototype.getBoundingClientRect = () => new DOMRect();
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
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    const { onChange } = renderEditor();

    await screen.findByText("Example link");
    selectEditorText("Example link");

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.editor.toolbar.link" }),
    );
    const dialog = await screen.findByRole("dialog");
    const linkInput = within(dialog).getByRole("textbox", {
      name: "requirements.editor.linkPrompt",
    });
    expect(linkInput).toHaveAttribute(
      "placeholder",
      "requirements.editor.linkPlaceholder",
    );

    fireEvent.change(linkInput, {
      target: { value: " https://example.com/new " },
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "requirements.editor.toolbar.link",
      }),
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
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("unsets the selected link when the link dialog is submitted empty", async () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.editor.toolbar.link" }),
    );
    const dialog = await screen.findByRole("dialog");
    const linkInput = within(dialog).getByRole("textbox", {
      name: "requirements.editor.linkPrompt",
    });

    fireEvent.change(linkInput, {
      target: { value: "   " },
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "requirements.editor.toolbar.link",
      }),
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
  it("resolves stable attachment image refs to temporary URLs for editing", async () => {
    createAttachmentDownloadUrlMock.mockReturnValueOnce(
      "https://cdn.example/resolved.png",
    );

    renderEditor({
      value: makeValue({
        content: [
          {
            attrs: {
              alt: "resolved.png",
              attachmentId: "ATTACHMENT_01",
              src: "attachment://ATTACHMENT_01",
            },
            type: "image",
          },
        ],
        type: "doc",
      }),
    });

    await waitFor(() =>
      expect(createAttachmentDownloadUrlMock).toHaveBeenCalledWith(
        "ATTACHMENT_01",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "resolved.png" }).getAttribute("src"),
      ).toBe("https://cdn.example/resolved.png"),
    );
  });

  it("uploads dropped images, previews the download URL, and persists the stable attachment reference", async () => {
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
    const persistedJson = latestContentJson(onChange);

    expect(JSON.stringify(persistedJson)).not.toContain("data:");
    expect(JSON.stringify(persistedJson)).not.toContain(
      "https://cdn.example/dropped.png",
    );
    expect(imageNodes(persistedJson!)).toEqual([
      expect.objectContaining({
        attrs: expect.objectContaining({
          attachmentId: "ATTACHMENT_01",
          fileKey: "requirements/REQ_01/dropped.png",
          src: "attachment://ATTACHMENT_01",
        }),
        type: "image",
      }),
    ]);
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

  it("does not upload non-image clipboard files", async () => {
    const textFile = new File(["plain text"], "notes.txt", {
      type: "text/plain",
    });

    renderEditor({
      canUploadImages: true,
      requirementId: "REQ_01",
    });

    fireEvent.paste(
      await screen.findByLabelText("requirements.editor.ariaLabel"),
      {
        clipboardData: makeDropDataTransfer([textFile]),
      },
    );

    expect(uploadRequirementImageMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText("requirements.editor.uploadErrors.UPLOAD_FAILED"),
    ).not.toBeInTheDocument();
  });
});

describe("RequirementContentEditorSlot markdown mode", () => {
  it("shows the current format and converts rich text to Markdown safely", () => {
    const { onChange } = renderEditor({
      value: makeValue({
        content: [
          {
            content: [{ text: "Scope", type: "text" }],
            type: "paragraph",
          },
          {
            attrs: {
              alt: "attached.png",
              attachmentId: "ATTACHMENT_01",
              src: "https://cdn.example/temp.png",
            },
            type: "image",
          },
          {
            attrs: {
              alt: "remote.png",
              src: "https://example.com/remote.png",
            },
            type: "image",
          },
        ],
        type: "doc",
      }),
    });

    const richTextFormat = screen.getByRole("button", {
      name: "requirements.editor.contentFormat.richText",
    });
    const markdownFormat = screen.getByRole("button", {
      name: "requirements.editor.contentFormat.markdown",
    });
    const formatGroup = screen.getByRole("group", {
      name: [
        "requirements.editor.contentFormat.richText",
        "requirements.editor.contentFormat.markdown",
      ].join(" / "),
    });

    expect(richTextFormat).toHaveAttribute("aria-pressed", "true");
    expect(formatGroup).toContainElement(richTextFormat);
    expect(formatGroup.parentElement).toHaveClass("ml-auto");
    onChange.mockClear();

    fireEvent.click(markdownFormat);

    expect(onChange).toHaveBeenCalledWith({
      contentFormat: "MARKDOWN",
      contentMarkdown: [
        "Scope",
        "",
        "![attached.png](attachment://ATTACHMENT_01)",
        "",
        "[image: remote.png]",
      ].join("\n"),
      contentText: "Scope\n\nattached.png\n\n[image: remote.png]",
    });
    expect(JSON.stringify(onChange.mock.calls)).not.toContain(
      "https://example.com",
    );
    expect(JSON.stringify(onChange.mock.calls)).not.toContain(
      "https://cdn.example",
    );
  });

  it("edits Markdown source and emits Markdown editor values", () => {
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "# Scope",
          contentText: "Scope",
        }}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: "requirements.editor.ariaLabel",
    });
    fireEvent.change(editor, {
      target: { value: "# Scope\n\n- Ship Markdown safely." },
    });

    expect(onChange).toHaveBeenCalledWith({
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Scope\n\n- Ship Markdown safely.",
      contentText: "Scope\n\nShip Markdown safely.",
    });
  });

  it("shows compact Markdown commands and toggles between edit and preview", () => {
    render(
      <RequirementContentEditorSlot
        onChange={vi.fn()}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "## Scope",
          contentText: "Scope",
        }}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "requirements.editor.toolbar.heading",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "requirements.editor.toolbar.insertTable",
      }),
    ).toBeEnabled();
    const sourceButton = screen.getByRole("button", {
      name: "requirements.editor.markdownViewMode.edit",
    });
    const previewButton = screen.getByRole("button", {
      name: "requirements.editor.markdownViewMode.preview",
    });

    expect(sourceButton).toHaveAttribute("aria-pressed", "true");
    expect(sourceButton).toHaveClass("bg-muted", "text-foreground");
    expect(sourceButton).not.toHaveClass(
      "bg-primary",
      "text-primary-foreground",
    );
    expect(sourceButton).toHaveTextContent(
      "requirements.editor.markdownViewMode.edit",
    );
    expect(sourceButton.querySelector("svg")).toBeNull();
    expect(previewButton).toHaveTextContent(
      "requirements.editor.markdownViewMode.preview",
    );
    expect(previewButton.querySelector("svg")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "requirements.editor.contentFormat.markdown",
      }),
    ).toHaveClass("bg-primary", "text-primary-foreground");

    fireEvent.click(previewButton);

    expect(previewButton).toHaveClass("bg-muted", "text-foreground");
    expect(previewButton).not.toHaveClass(
      "bg-primary",
      "text-primary-foreground",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "Scope" })).toBeVisible();

    fireEvent.click(sourceButton);

    expect(
      screen.getByRole("textbox", {
        name: "requirements.editor.ariaLabel",
      }),
    ).toBeVisible();
  });

  it("applies Markdown toolbar commands to the textarea selection", () => {
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "Scope",
          contentText: "Scope",
        }}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: "requirements.editor.ariaLabel",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(0, 5);
    fireEvent.select(editor);
    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.editor.toolbar.bold",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      contentFormat: "MARKDOWN",
      contentMarkdown: "**Scope**",
      contentText: "Scope",
    });
  });

  it("uses localized Markdown placeholders from messages", () => {
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "",
          contentText: "",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.editor.toolbar.bold",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      contentFormat: "MARKDOWN",
      contentMarkdown:
        "**requirements.editor.markdownCommands.boldPlaceholder**",
      contentText: "requirements.editor.markdownCommands.boldPlaceholder",
    });
  });

  it("uses the localized Markdown table template from messages", () => {
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "",
          contentText: "",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.editor.toolbar.insertTable",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      contentFormat: "MARKDOWN",
      contentMarkdown: [
        "| requirements.editor.markdownCommands.table.column1 | requirements.editor.markdownCommands.table.column2 | requirements.editor.markdownCommands.table.column3 |",
        "| --- | --- | --- |",
        "| requirements.editor.markdownCommands.table.cell | requirements.editor.markdownCommands.table.cell | requirements.editor.markdownCommands.table.cell |",
      ].join("\n"),
      contentText: [
        "| requirements.editor.markdownCommands.table.column1 | requirements.editor.markdownCommands.table.column2 | requirements.editor.markdownCommands.table.column3 |",
        "| --- | --- | --- |",
        "| requirements.editor.markdownCommands.table.cell | requirements.editor.markdownCommands.table.cell | requirements.editor.markdownCommands.table.cell |",
      ].join("\n"),
    });
  });

  it("inserts Markdown links through the dialog without window.prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "Spec",
          contentText: "Spec",
        }}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: "requirements.editor.ariaLabel",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(0, 4);
    fireEvent.select(editor);
    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.editor.toolbar.link",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialog).getByRole("textbox", {
        name: "requirements.editor.linkPrompt",
      }),
      {
        target: { value: "https://example.com/spec" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "requirements.editor.toolbar.link",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      contentFormat: "MARKDOWN",
      contentMarkdown: "[Spec](https://example.com/spec)",
      contentText: "Spec",
    });
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("uploads pasted Markdown images and inserts stable attachment markdown", async () => {
    const onAttachmentUploaded = vi.fn();
    const onChange = vi.fn();
    const imageFile = new File(["image-bytes"], "diagram.png", {
      type: "image/png",
    });

    uploadRequirementImageMock.mockResolvedValueOnce({
      attachment: {
        fileKey: "requirements/REQ_01/diagram.png",
        fileName: "diagram.png",
        id: "ATTACHMENT_01",
        mimeType: "image/png",
        previewUrl: "https://cdn.example/diagram-preview.png",
        size: imageFile.size,
      },
      imageUrl: "https://cdn.example/diagram.png",
    });

    render(
      <RequirementContentEditorSlot
        canUploadImages
        onAttachmentUploaded={onAttachmentUploaded}
        onChange={onChange}
        requirementId="REQ_01"
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "Before",
          contentText: "Before",
        }}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: "requirements.editor.ariaLabel",
    }) as HTMLTextAreaElement;
    editor.setSelectionRange(6, 6);
    fireEvent.select(editor);
    fireEvent.paste(editor, {
      clipboardData: makeDropDataTransfer([imageFile]),
    });

    await waitFor(() =>
      expect(uploadRequirementImageMock).toHaveBeenCalledWith({
        existingAttachmentCount: 0,
        file: imageFile,
        requirementId: "REQ_01",
      }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        contentFormat: "MARKDOWN",
        contentMarkdown: "Before\n\n![diagram.png](attachment://ATTACHMENT_01)",
        contentText: "Before\n\ndiagram.png",
      }),
    );
    expect(onAttachmentUploaded).toHaveBeenCalledWith({
      fileKey: "requirements/REQ_01/diagram.png",
      fileName: "diagram.png",
      id: "ATTACHMENT_01",
      mimeType: "image/png",
      previewUrl: "https://cdn.example/diagram-preview.png",
      size: imageFile.size,
    });
  });

  it("ignores non-image Markdown paste files", () => {
    const textFile = new File(["plain text"], "notes.txt", {
      type: "text/plain",
    });

    render(
      <RequirementContentEditorSlot
        canUploadImages
        onChange={vi.fn()}
        requirementId="REQ_01"
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "Before",
          contentText: "Before",
        }}
      />,
    );

    fireEvent.paste(
      screen.getByRole("textbox", {
        name: "requirements.editor.ariaLabel",
      }),
      {
        clipboardData: makeDropDataTransfer([textFile]),
      },
    );

    expect(uploadRequirementImageMock).not.toHaveBeenCalled();
  });

  it("asks for confirmation before converting non-empty Markdown to rich text", async () => {
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "# Scope",
          contentText: "Scope",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.editor.contentFormat.richText",
      }),
    );

    expect(onChange).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent(
      "requirements.editor.markdownConvertDialog.title",
    );
    expect(dialog).toHaveTextContent(
      "requirements.editor.markdownConvertDialog.description",
    );
  });

  it("keeps Markdown when Markdown to rich text conversion is cancelled", async () => {
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "# Scope",
          contentText: "Scope",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.editor.contentFormat.richText",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "requirements.editor.markdownConvertDialog.cancel",
      }),
    );

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("converts non-empty Markdown to rich text after confirmation", async () => {
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: [
            "# Scope",
            "",
            "Use **bold** and [link](https://example.com/spec)",
          ].join("\n"),
          contentText: "Scope\n\nUse bold and link",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.editor.contentFormat.richText",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "requirements.editor.markdownConvertDialog.confirm",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      contentFormat: "TIPTAP_JSON",
      contentJson: {
        content: [
          {
            attrs: { level: 1 },
            content: [{ text: "Scope", type: "text" }],
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
              { text: " and ", type: "text" },
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
        ],
        type: "doc",
      },
      contentMarkdownCache:
        "# Scope\n\nUse **bold** and [link](https://example.com/spec)",
      contentText: "Scope\n\nUse\n\nbold\n\nand\n\nlink",
    });
  });

  it("switches empty Markdown to rich text", () => {
    const onChange = vi.fn();

    render(
      <RequirementContentEditorSlot
        onChange={onChange}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "  ",
          contentText: "",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "requirements.editor.contentFormat.richText",
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      contentFormat: "TIPTAP_JSON",
      contentJson: {
        content: [{ type: "paragraph" }],
        type: "doc",
      },
      contentMarkdownCache: "",
      contentText: "",
    });
  });

  it("renders Markdown preview with React text nodes when disabled", () => {
    render(
      <RequirementContentEditorSlot
        disabled
        onChange={vi.fn()}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: [
            "## Overview",
            "",
            "> <script>alert(1)</script>",
            "",
            "![remote](https://example.com/remote.png)",
          ].join("\n"),
          contentText: "Overview",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(screen.getByText("<script>alert(1)</script>")).toBeVisible();
    expect(screen.getByText("[image: remote]")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "requirements.editor.markdownViewMode.edit",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "requirements.editor.markdownViewMode.preview",
      }),
    ).toBeNull();
  });

  it("resolves Markdown attachment preview images to temporary URLs", async () => {
    createAttachmentDownloadUrlMock.mockReturnValueOnce(
      "https://cdn.example/attached.png",
    );

    render(
      <RequirementContentEditorSlot
        disabled
        onChange={vi.fn()}
        value={{
          contentFormat: "MARKDOWN",
          contentMarkdown: "![attached](attachment://ATTACHMENT_01)",
          contentText: "attached",
        }}
      />,
    );

    await waitFor(() =>
      expect(createAttachmentDownloadUrlMock).toHaveBeenCalledWith(
        "ATTACHMENT_01",
      ),
    );
    expect(
      await screen.findByRole("img", { name: "attached" }),
    ).toHaveAttribute("src", "https://cdn.example/attached.png");
  });
});
