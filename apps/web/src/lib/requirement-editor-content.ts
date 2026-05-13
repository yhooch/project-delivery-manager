export type RequirementContentEditorValue = {
  contentJson: Record<string, unknown>;
  contentMarkdownCache?: string;
  contentText: string;
};

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
    const src = value.attrs.src;

    if (isBase64ImageSource(src)) {
      return undefined;
    }
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

function isBase64ImageSource(value: unknown): boolean {
  return typeof value === "string" && /^data:image\//iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
