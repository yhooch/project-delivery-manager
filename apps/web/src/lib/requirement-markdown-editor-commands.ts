import { MARKDOWN_ATTACHMENT_IMAGE_SRC_PREFIX } from "./requirement-markdown-content";

export type MarkdownEditorSelection = {
  end: number;
  start: number;
};

export type MarkdownEditorCommand =
  | { type: "blockquote" }
  | { type: "bold" }
  | { type: "bulletList" }
  | { type: "codeBlock" }
  | { type: "heading"; level?: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "italic" }
  | { href: string; type: "link" }
  | { type: "orderedList" }
  | { type: "table" }
  | { type: "taskList" };

export type MarkdownEditorCommandResult = {
  selection: MarkdownEditorSelection;
  value: string;
};

export type MarkdownEditorCommandOptions = {
  boldPlaceholder?: string;
  codeBlockPlaceholder?: string;
  italicPlaceholder?: string;
  linkLabel?: string;
  tableTemplate?: string;
};

export function applyMarkdownEditorCommand(input: {
  command: MarkdownEditorCommand;
  options?: MarkdownEditorCommandOptions;
  selection: MarkdownEditorSelection;
  value: string;
}): MarkdownEditorCommandResult {
  const selection = normalizeSelection(input.selection, input.value.length);
  const options = input.options ?? {};

  switch (input.command.type) {
    case "bold":
      return wrapInline(input.value, selection, "**", options.boldPlaceholder);
    case "italic":
      return wrapInline(input.value, selection, "*", options.italicPlaceholder);
    case "heading":
      return prefixSelectedLines(
        input.value,
        selection,
        `${"#".repeat(input.command.level ?? 2)} `,
      );
    case "bulletList":
      return prefixSelectedLines(input.value, selection, "- ");
    case "orderedList":
      return prefixSelectedLines(input.value, selection, (_line, index) => {
        return `${index + 1}. `;
      });
    case "taskList":
      return prefixSelectedLines(input.value, selection, "- [ ] ");
    case "blockquote":
      return prefixSelectedLines(input.value, selection, "> ");
    case "codeBlock":
      return wrapBlock(
        input.value,
        selection,
        "```\n",
        "\n```",
        options.codeBlockPlaceholder,
      );
    case "link":
      return insertLink(
        input.value,
        selection,
        input.command.href,
        options.linkLabel,
      );
    case "table":
      return replaceSelection(
        input.value,
        selection,
        options.tableTemplate ??
          ["|  |  |  |", "| --- | --- | --- |", "|  |  |  |"].join("\n"),
      );
  }
}

export function insertMarkdownAttachmentImage(input: {
  attachmentId: string;
  fileName: string;
  selection: MarkdownEditorSelection;
  value: string;
}): MarkdownEditorCommandResult {
  const selection = normalizeSelection(input.selection, input.value.length);
  const imageMarkdown = `![${escapeImageAlt(input.fileName)}](${createMarkdownAttachmentImageSrc(
    input.attachmentId,
  )})`;
  const prefix =
    selection.start > 0 && input.value[selection.start - 1] !== "\n"
      ? "\n\n"
      : "";
  const suffix =
    selection.end < input.value.length && input.value[selection.end] !== "\n"
      ? "\n\n"
      : "";

  return replaceSelection(
    input.value,
    selection,
    `${prefix}${imageMarkdown}${suffix}`,
  );
}

export function createMarkdownAttachmentImageSrc(attachmentId: string): string {
  return `${MARKDOWN_ATTACHMENT_IMAGE_SRC_PREFIX}${encodeURIComponent(
    attachmentId,
  )}`;
}

function insertLink(
  value: string,
  selection: MarkdownEditorSelection,
  href: string,
  placeholder?: string,
): MarkdownEditorCommandResult {
  const selected = value.slice(selection.start, selection.end);
  const label = selected.length > 0 ? selected : placeholder ?? "";
  const replacement = `[${label}](${href.trim()})`;
  const start = selection.start + 1;
  const end = start + label.length;

  return {
    selection: { end, start },
    value: replaceRange(value, selection, replacement),
  };
}

function wrapInline(
  value: string,
  selection: MarkdownEditorSelection,
  marker: string,
  placeholder = "",
): MarkdownEditorCommandResult {
  const selected = value.slice(selection.start, selection.end);
  const text = selected.length > 0 ? selected : placeholder;
  const replacement = `${marker}${text}${marker}`;
  const start = selection.start + marker.length;
  const end = start + text.length;

  return {
    selection: { end, start },
    value: replaceRange(value, selection, replacement),
  };
}

function wrapBlock(
  value: string,
  selection: MarkdownEditorSelection,
  before: string,
  after: string,
  placeholder = "",
): MarkdownEditorCommandResult {
  const selected = value.slice(selection.start, selection.end);
  const text = selected.length > 0 ? selected : placeholder;
  const replacement = `${before}${text}${after}`;
  const start = selection.start + before.length;
  const end = start + text.length;

  return {
    selection: { end, start },
    value: replaceRange(value, selection, replacement),
  };
}

function prefixSelectedLines(
  value: string,
  selection: MarkdownEditorSelection,
  prefix: string | ((line: string, index: number) => string),
): MarkdownEditorCommandResult {
  const bounds = getSelectedLineBounds(value, selection);
  const selectedBlock = value.slice(bounds.start, bounds.end);
  const lines = selectedBlock.length > 0 ? selectedBlock.split("\n") : [""];
  const nextLines = lines.map((line, index) => {
    const actualPrefix =
      typeof prefix === "string" ? prefix : prefix(line, index);

    return line.length > 0 ? `${actualPrefix}${line}` : actualPrefix.trimEnd();
  });
  const replacement = nextLines.join("\n");

  return {
    selection: {
      end: bounds.start + replacement.length,
      start: bounds.start,
    },
    value: replaceRange(value, bounds, replacement),
  };
}

function replaceSelection(
  value: string,
  selection: MarkdownEditorSelection,
  replacement: string,
): MarkdownEditorCommandResult {
  return {
    selection: {
      end: selection.start + replacement.length,
      start: selection.start,
    },
    value: replaceRange(value, selection, replacement),
  };
}

function replaceRange(
  value: string,
  selection: MarkdownEditorSelection,
  replacement: string,
) {
  return `${value.slice(0, selection.start)}${replacement}${value.slice(
    selection.end,
  )}`;
}

function getSelectedLineBounds(
  value: string,
  selection: MarkdownEditorSelection,
): MarkdownEditorSelection {
  const start = value.lastIndexOf("\n", Math.max(selection.start - 1, 0)) + 1;
  const selectedEnd =
    selection.end > selection.start && value[selection.end - 1] === "\n"
      ? selection.end - 1
      : selection.end;
  const nextBreak = value.indexOf("\n", selectedEnd);
  const end = nextBreak === -1 ? value.length : nextBreak;

  return { end, start };
}

function normalizeSelection(
  selection: MarkdownEditorSelection,
  valueLength: number,
): MarkdownEditorSelection {
  const start = Math.min(
    Math.max(Math.trunc(selection.start), 0),
    Math.max(valueLength, 0),
  );
  const end = Math.min(
    Math.max(Math.trunc(selection.end), 0),
    Math.max(valueLength, 0),
  );

  return start <= end ? { end, start } : { end: start, start: end };
}

function escapeImageAlt(value: string): string {
  return value.replace(/[\\\]]/gu, "\\$&");
}
