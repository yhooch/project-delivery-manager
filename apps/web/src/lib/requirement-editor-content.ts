export type RequirementContentEditorValue = {
  contentJson: Record<string, unknown>;
  contentMarkdownCache?: string;
  contentText: string;
};

export const ATTACHMENT_IMAGE_SRC_PREFIX = "attachment://";

export type AttachmentImageDisplayUrls = Readonly<Record<string, string>>;

export function createContentEditorValue(input: {
  contentJson?: Record<string, unknown>;
  contentMarkdownCache?: string;
  contentText?: string;
}): RequirementContentEditorValue {
  const contentText =
    input.contentText ??
    input.contentMarkdownCache ??
    extractTextFromTiptapJson(input.contentJson) ??
    "";
  const contentJson = sanitizeTiptapDocument(
    input.contentJson ?? createTiptapDocumentFromText(contentText),
  );

  return {
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
    contentJson: sanitized,
    contentMarkdownCache: contentText,
    contentText,
  };
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

export function sanitizeTiptapDocument(value: unknown): Record<string, unknown> {
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
    const displayUrl = attachmentId ? imageDisplayUrls[attachmentId] : undefined;
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

function collectAttachmentImageIdsFromValue(
  value: unknown,
  ids: Set<string>,
) {
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
  return ["displayUrl", "downloadUrl", "imageUrl", "previewUrl", "resolvedUrl"]
    .includes(key);
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
