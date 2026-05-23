import {
  MARKDOWN_ATTACHMENT_IMAGE_SRC_PREFIX,
  createMarkdownEditorValue,
} from "./requirement-markdown-content";

export type RequirementTiptapContentEditorValue = {
  contentFormat: "TIPTAP_JSON";
  contentJson: Record<string, unknown>;
  contentMarkdownCache?: string;
  contentText: string;
};

export type RequirementMarkdownContentEditorValue = {
  contentFormat: "MARKDOWN";
  contentJson?: never;
  contentMarkdown: string;
  contentMarkdownCache?: never;
  contentText: string;
};

export type RequirementContentFormat = "TIPTAP_JSON" | "MARKDOWN";

export type RequirementContentEditorValue =
  | RequirementTiptapContentEditorValue
  | RequirementMarkdownContentEditorValue;

export const ATTACHMENT_IMAGE_SRC_PREFIX = MARKDOWN_ATTACHMENT_IMAGE_SRC_PREFIX;

export type AttachmentImageDisplayUrls = Readonly<Record<string, string>>;

export type RequirementContentFormatConversionResult =
  | {
      ok: true;
      value: RequirementContentEditorValue;
    }
  | {
      ok: false;
      reason: "MARKDOWN_TO_TIPTAP_NON_EMPTY";
    };

export function createContentEditorValue(input: {
  contentFormat?: RequirementContentFormat;
  contentJson?: Record<string, unknown>;
  contentMarkdown?: string;
  contentMarkdownCache?: string;
  contentText?: string;
}): RequirementContentEditorValue {
  if (
    input.contentFormat === "MARKDOWN" ||
    (input.contentMarkdown !== undefined && input.contentJson === undefined)
  ) {
    return createEditorValueFromMarkdown(
      input.contentMarkdown ?? input.contentText ?? "",
    );
  }

  const contentText =
    input.contentText ??
    input.contentMarkdownCache ??
    extractTextFromTiptapJson(input.contentJson) ??
    "";
  const contentJson = sanitizeTiptapDocument(
    input.contentJson ?? createTiptapDocumentFromText(contentText),
  );

  return {
    contentFormat: "TIPTAP_JSON",
    contentJson,
    contentMarkdownCache: input.contentMarkdownCache ?? contentText,
    contentText,
  };
}

export function createEditorValueFromTiptapJson(
  contentJson: Record<string, unknown>,
): RequirementContentEditorValue {
  const sanitized = sanitizeTiptapDocument(contentJson);
  const contentText = extractTextFromTiptapJson(sanitized) ?? "";

  return {
    contentFormat: "TIPTAP_JSON",
    contentJson: sanitized,
    contentMarkdownCache: serializeTiptapJsonToSafeMarkdown(sanitized),
    contentText,
  };
}

export function createEditorValueFromMarkdown(
  contentMarkdown: string,
): RequirementContentEditorValue {
  return createMarkdownEditorValue(contentMarkdown);
}

export function convertRequirementContentEditorValueFormat(
  value: RequirementContentEditorValue,
  targetFormat: RequirementContentFormat,
): RequirementContentFormatConversionResult {
  if (value.contentFormat === targetFormat) {
    return {
      ok: true,
      value,
    };
  }

  if (targetFormat === "MARKDOWN") {
    return {
      ok: true,
      value: createEditorValueFromMarkdown(
        serializeTiptapJsonToMarkdown(value.contentJson),
      ),
    };
  }

  if (isRequirementContentEditorValueEmpty(value)) {
    return {
      ok: true,
      value: createEditorValueFromTiptapJson(createTiptapDocumentFromText("")),
    };
  }

  return {
    ok: false,
    reason: "MARKDOWN_TO_TIPTAP_NON_EMPTY",
  };
}

export function isRequirementContentEditorValueEmpty(
  value: RequirementContentEditorValue,
): boolean {
  if (value.contentFormat === "MARKDOWN") {
    return value.contentMarkdown.trim().length === 0;
  }

  return serializeTiptapJsonToMarkdown(value.contentJson).trim().length === 0;
}

export function createTiptapDocumentFromText(
  text: string,
): Record<string, unknown> {
  const lines = text.split(/\n{2,}/u);
  const content = lines.map((line) => {
    const trimmed = line.trim();

    return trimmed.length > 0
      ? {
          content: [
            {
              text: trimmed,
              type: "text",
            },
          ],
          type: "paragraph",
        }
      : {
          type: "paragraph",
        };
  });

  return {
    content: content.length > 0 ? content : [{ type: "paragraph" }],
    type: "doc",
  };
}

export function sanitizeTiptapDocument(
  value: unknown,
): Record<string, unknown> {
  const sanitized = sanitizeTiptapValue(value);

  if (!isRecord(sanitized) || sanitized.type !== "doc") {
    return createTiptapDocumentFromText("");
  }

  return sanitized;
}

export function createTiptapDocumentForEditing(
  value: unknown,
  imageDisplayUrls: AttachmentImageDisplayUrls = {},
): Record<string, unknown> {
  return hydrateAttachmentImageSources(
    sanitizeTiptapDocument(value),
    imageDisplayUrls,
  ) as Record<string, unknown>;
}

export function createAttachmentImageSource(attachmentId: string): string {
  return `${ATTACHMENT_IMAGE_SRC_PREFIX}${encodeURIComponent(attachmentId)}`;
}

export function collectAttachmentImageIds(value: unknown): string[] {
  const ids = new Set<string>();

  collectAttachmentImageIdsFromValue(value, ids);

  return Array.from(ids);
}

export function extractTextFromTiptapJson(value: unknown): string | undefined {
  const chunks: string[] = [];

  collectText(value, chunks);

  return chunks.length > 0 ? chunks.join("\n\n") : undefined;
}

export function containsBase64Image(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsBase64Image(item));
  }

  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "image" && isRecord(value.attrs)) {
    return isBase64ImageSource(value.attrs.src);
  }

  return containsBase64Image(value.content);
}

export function serializeTiptapJsonToMarkdown(value: unknown): string {
  return serializeBlock(value, 0).trim();
}

function serializeTiptapJsonToSafeMarkdown(value: unknown): string {
  return createMarkdownEditorValue(serializeTiptapJsonToMarkdown(value))
    .contentMarkdown;
}

function serializeBlock(value: unknown, indent: number): string {
  if (!isRecord(value)) {
    return "";
  }

  switch (value.type) {
    case "doc":
      return serializeBlocks(value.content, indent);
    case "paragraph":
      return serializeInlineContent(value.content);
    case "heading": {
      const level = isRecord(value.attrs)
        ? clampHeadingLevel(value.attrs.level)
        : 1;
      const text = serializeInlineContent(value.content);
      return `${"#".repeat(level)}${text ? ` ${text}` : ""}`;
    }
    case "bulletList":
      return serializeList(value, false, indent);
    case "orderedList":
      return serializeList(value, true, indent);
    case "taskList":
      return serializeTaskList(value, indent);
    case "codeBlock":
      return serializeCodeBlock(value);
    case "blockquote":
      return serializeBlockquote(value, indent);
    case "horizontalRule":
      return `${" ".repeat(indent)}---`;
    case "image":
      return serializeImage(value);
    case "hardBreak":
      return "  \n";
    default:
      return serializeBlocks(value.content, indent);
  }
}

function serializeBlocks(value: unknown, indent: number): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => serializeBlock(item, indent))
    .filter((item) => item.length > 0)
    .join("\n\n");
}

function serializeInlineContent(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value.map((item) => serializeInlineNode(item)).join("");
}

function serializeInlineNode(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }

  if (value.type === "text" && typeof value.text === "string") {
    return serializeMarkedText(value.text, value.marks);
  }

  if (value.type === "hardBreak") {
    return "  \n";
  }

  if (value.type === "image") {
    return serializeImage(value);
  }

  return serializeInlineContent(value.content);
}

function serializeMarkedText(text: string, marks: unknown): string {
  const markList = Array.isArray(marks) ? marks.filter(isRecord) : [];
  const hasCode = markList.some((mark) => mark.type === "code");
  let result = hasCode ? serializeInlineCode(text) : escapeMarkdownText(text);

  const link = markList.find((mark) => mark.type === "link");
  if (link && isRecord(link.attrs) && typeof link.attrs.href === "string") {
    result = `[${result}](${escapeMarkdownUrl(link.attrs.href)})`;
  }

  if (markList.some((mark) => mark.type === "bold")) {
    result = `**${result}**`;
  }

  if (markList.some((mark) => mark.type === "italic")) {
    result = `*${result}*`;
  }

  return result;
}

function serializeInlineCode(text: string): string {
  const longestRun = Math.max(
    0,
    ...Array.from(text.matchAll(/`+/gu), (match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);

  return `${fence}${text}${fence}`;
}

function serializeList(
  value: Record<string, unknown>,
  ordered: boolean,
  indent: number,
): string {
  const items = Array.isArray(value.content) ? value.content : [];
  const start =
    ordered && isRecord(value.attrs) && typeof value.attrs.start === "number"
      ? value.attrs.start
      : 1;

  return items
    .map((item, index) =>
      serializeListItem(item, ordered ? `${start + index}. ` : "- ", indent),
    )
    .filter((item) => item.length > 0)
    .join("\n");
}

function serializeListItem(
  value: unknown,
  marker: string,
  indent: number,
): string {
  if (!isRecord(value)) {
    return "";
  }

  const blocks = Array.isArray(value.content) ? value.content : [];

  return serializeListItemBlocks(blocks, marker, indent);
}

function serializeTaskList(
  value: Record<string, unknown>,
  indent: number,
): string {
  const items = Array.isArray(value.content) ? value.content : [];

  return items
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }

      const checked = isRecord(item.attrs) && item.attrs.checked === true;
      const blocks = Array.isArray(item.content) ? item.content : [];

      return serializeListItemBlocks(
        blocks,
        checked ? "- [x] " : "- [ ] ",
        indent,
      );
    })
    .filter((item) => item.length > 0)
    .join("\n");
}

function serializeListItemBlocks(
  blocks: unknown[],
  marker: string,
  indent: number,
): string {
  const padding = " ".repeat(indent);
  const markerPrefix = `${padding}${marker}`;
  const continuationPadding = " ".repeat(indent + marker.length);
  const lines: string[] = [];

  if (blocks.length === 0) {
    return markerPrefix.trimEnd();
  }

  blocks.forEach((block) => {
    if (!isRecord(block)) {
      return;
    }

    if (block.type === "paragraph") {
      const text = serializeInlineContent(block.content);

      if (lines.length === 0) {
        lines.push(`${markerPrefix}${text}`);
      } else {
        lines.push(`${continuationPadding}${text}`.trimEnd());
      }
      return;
    }

    if (
      block.type === "bulletList" ||
      block.type === "orderedList" ||
      block.type === "taskList"
    ) {
      lines.push(serializeBlock(block, indent + 2));
      return;
    }

    const serialized = serializeBlock(block, indent + marker.length);
    if (serialized.length > 0) {
      if (lines.length === 0) {
        lines.push(markerPrefix.trimEnd());
      }
      lines.push(indentMarkdownBlock(serialized, continuationPadding));
    }
  });

  return lines.filter((line) => line.length > 0).join("\n");
}

function serializeCodeBlock(value: Record<string, unknown>): string {
  const code = collectRawText(value.content);
  const language =
    isRecord(value.attrs) && typeof value.attrs.language === "string"
      ? value.attrs.language.trim()
      : "";
  const longestRun = Math.max(
    2,
    ...Array.from(code.matchAll(/`+/gu), (match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);

  return `${fence}${language}\n${code}\n${fence}`;
}

function serializeBlockquote(
  value: Record<string, unknown>,
  indent: number,
): string {
  const content = serializeBlocks(value.content, indent);
  const padding = " ".repeat(indent);

  return content
    .split("\n")
    .map((line) => `${padding}>${line ? ` ${line}` : ""}`)
    .join("\n");
}

function serializeImage(value: Record<string, unknown>): string {
  const attrs = isRecord(value.attrs) ? value.attrs : {};
  const attachmentId = getAttachmentIdFromImageAttrs(attrs);
  const alt =
    getStringAttr(attrs, "alt") ??
    getStringAttr(attrs, "title") ??
    getStringAttr(attrs, "fileName") ??
    attachmentId ??
    "attachment";

  if (!attachmentId) {
    return `[image: ${escapeMarkdownText(alt)}]`;
  }

  const src = createAttachmentImageSource(attachmentId);

  return `![${escapeImageAlt(alt)}](${escapeMarkdownUrl(src)})`;
}

function collectRawText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => collectRawText(item)).join("");
  }

  if (!isRecord(value)) {
    return "";
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  if (value.type === "hardBreak") {
    return "\n";
  }

  return collectRawText(value.content);
}

function indentMarkdownBlock(markdown: string, padding: string): string {
  return markdown
    .split("\n")
    .map((line) => (line.length > 0 ? `${padding}${line}` : padding.trimEnd()))
    .join("\n");
}

function clampHeadingLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 6);
}

function getStringAttr(
  attrs: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = attrs[key];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]]/gu, "\\$&");
}

function escapeImageAlt(text: string): string {
  return text.replace(/[\\\]]/gu, "\\$&");
}

function escapeMarkdownUrl(url: string): string {
  return url.trim().replace(/\s/gu, "%20").replace(/\)/gu, "%29");
}

function sanitizeTiptapValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeTiptapValue(item))
      .filter((item) => item !== undefined);
  }

  if (!isRecord(value)) {
    return value;
  }

  if (value.type === "image" && isRecord(value.attrs)) {
    const attrs = sanitizeImageAttrs(value.attrs);

    if (!attrs) {
      return undefined;
    }

    const result: Record<string, unknown> = {};

    Object.entries(value).forEach(([key, item]) => {
      if (key === "attrs") {
        result.attrs = attrs;
        return;
      }

      const sanitized = sanitizeTiptapValue(item);

      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    });

    return result;
  }

  const result: Record<string, unknown> = {};

  Object.entries(value).forEach(([key, item]) => {
    const sanitized = sanitizeTiptapValue(item);

    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  });

  return result;
}

function collectText(value: unknown, chunks: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, chunks));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.text === "string" && value.text.trim().length > 0) {
    chunks.push(value.text.trim());
  }

  collectText(value.content, chunks);
}

function hydrateAttachmentImageSources(
  value: unknown,
  imageDisplayUrls: AttachmentImageDisplayUrls,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      hydrateAttachmentImageSources(item, imageDisplayUrls),
    );
  }

  if (!isRecord(value)) {
    return value;
  }

  if (value.type === "image" && isRecord(value.attrs)) {
    const attachmentId = getAttachmentIdFromImageAttrs(value.attrs);
    const displayUrl = attachmentId
      ? imageDisplayUrls[attachmentId]
      : undefined;
    const result = hydrateRecord(value, imageDisplayUrls);

    if (displayUrl && isRecord(result.attrs)) {
      result.attrs = {
        ...result.attrs,
        src: displayUrl,
      };
    }

    return result;
  }

  return hydrateRecord(value, imageDisplayUrls);
}

function hydrateRecord(
  value: Record<string, unknown>,
  imageDisplayUrls: AttachmentImageDisplayUrls,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  Object.entries(value).forEach(([key, item]) => {
    result[key] = hydrateAttachmentImageSources(item, imageDisplayUrls);
  });

  return result;
}

function collectAttachmentImageIdsFromValue(value: unknown, ids: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAttachmentImageIdsFromValue(item, ids));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (value.type === "image" && isRecord(value.attrs)) {
    const attachmentId = getAttachmentIdFromImageAttrs(value.attrs);

    if (attachmentId) {
      ids.add(attachmentId);
    }
  }

  collectAttachmentImageIdsFromValue(value.content, ids);
}

function sanitizeImageAttrs(
  attrs: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const src = attrs.src;

  if (isBase64ImageSource(src)) {
    return undefined;
  }

  const attachmentId = getAttachmentIdFromImageAttrs(attrs);

  if (!attachmentId && isTransientAttachmentImageSource(src)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  Object.entries(attrs).forEach(([key, item]) => {
    if (isTransientImageAttr(key)) {
      return;
    }

    const sanitized = sanitizeTiptapValue(item);

    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  });

  if (attachmentId) {
    result.attachmentId = attachmentId;
    result.src = createAttachmentImageSource(attachmentId);
  }

  return result;
}

function getAttachmentIdFromImageAttrs(
  attrs: Record<string, unknown>,
): string | undefined {
  if (
    typeof attrs.attachmentId === "string" &&
    attrs.attachmentId.trim().length > 0
  ) {
    return attrs.attachmentId.trim();
  }

  if (typeof attrs.src !== "string") {
    return undefined;
  }

  if (!attrs.src.startsWith(ATTACHMENT_IMAGE_SRC_PREFIX)) {
    return undefined;
  }

  const encoded = attrs.src.slice(ATTACHMENT_IMAGE_SRC_PREFIX.length);

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function isTransientImageAttr(key: string): boolean {
  return [
    "displayUrl",
    "downloadUrl",
    "imageUrl",
    "previewUrl",
    "resolvedUrl",
  ].includes(key);
}

function isBase64ImageSource(value: unknown): boolean {
  return typeof value === "string" && /^data:image\//iu.test(value);
}

function isTransientAttachmentImageSource(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  if (value.startsWith(ATTACHMENT_IMAGE_SRC_PREFIX)) {
    return false;
  }

  try {
    const url = new URL(value);
    const paramNames = Array.from(url.searchParams.keys()).map((key) =>
      key.toLowerCase(),
    );

    return (
      url.pathname.includes("/download-url") ||
      paramNames.some((key) =>
        [
          "awsaccesskeyid",
          "expires",
          "signature",
          "x-amz-algorithm",
          "x-amz-credential",
          "x-amz-expires",
          "x-amz-signature",
          "x-amz-security-token",
        ].includes(key),
      )
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
