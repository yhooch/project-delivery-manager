export const MARKDOWN_ATTACHMENT_IMAGE_SRC_PREFIX = "attachment://";

export type RequirementMarkdownBlock =
  | {
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
      type: "heading";
    }
  | {
      text: string;
      type: "paragraph";
    }
  | {
      text: string;
      type: "blockquote";
    }
  | {
      language?: string;
      text: string;
      type: "code";
    }
  | {
      ordered: boolean;
      items: RequirementMarkdownListItem[];
      type: "list";
    }
  | {
      alt: string;
      src: string;
      type: "image";
    }
  | {
      type: "horizontalRule";
    };

export type RequirementMarkdownListItem = {
  checked?: boolean;
  text: string;
};

const BASE64_IMAGE_DATA_PATTERN =
  /data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64(?:,[a-z0-9+/=]+)?/giu;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]\n]*)\]\(([^)\n]*)\)/gu;

export function createMarkdownEditorValue(markdown: string) {
  const contentMarkdown = sanitizeRequirementMarkdown(markdown);

  return {
    contentFormat: "MARKDOWN" as const,
    contentMarkdown,
    contentText: extractTextFromMarkdown(contentMarkdown),
  };
}

export function sanitizeRequirementMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/gu, "\n")
    .replace(BASE64_IMAGE_DATA_PATTERN, "")
    .replace(MARKDOWN_IMAGE_PATTERN, (_match, alt: string, rawTarget: string) =>
      sanitizeMarkdownImage(alt, rawTarget),
    )
    .trimEnd();
}

export function parseRequirementMarkdown(
  markdown: string,
): RequirementMarkdownBlock[] {
  const lines = sanitizeRequirementMarkdown(markdown).split("\n");
  const blocks: RequirementMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    const codeFence = trimmed.match(/^```([A-Za-z0-9_-]*)\s*$/u);
    if (codeFence) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && lines[index]?.trim() !== "```") {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({
        language: codeFence[1] || undefined,
        text: codeLines.join("\n"),
        type: "code",
      });
      continue;
    }

    const image = parseStandaloneMarkdownImage(trimmed);
    if (image) {
      blocks.push(image);
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      blocks.push({
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: stripInlineMarkdown(heading[2] ?? ""),
        type: "heading",
      });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/u.test(trimmed)) {
      blocks.push({ type: "horizontalRule" });
      index += 1;
      continue;
    }

    if (isBlockquoteLine(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length && isBlockquoteLine(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^\s{0,3}>\s?/u, ""));
        index += 1;
      }

      blocks.push({
        text: stripInlineMarkdown(quoteLines.join("\n")),
        type: "blockquote",
      });
      continue;
    }

    const list = parseList(lines, index);
    if (list) {
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];

    while (
      index < lines.length &&
      (lines[index] ?? "").trim().length > 0 &&
      !startsSpecialBlock(lines[index] ?? "")
    ) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }

    blocks.push({
      text: stripInlineMarkdown(paragraphLines.join("\n")),
      type: "paragraph",
    });
  }

  return blocks;
}

export function extractTextFromMarkdown(markdown: string): string {
  return parseRequirementMarkdown(markdown)
    .map((block) => {
      switch (block.type) {
        case "code":
        case "paragraph":
        case "blockquote":
        case "heading":
          return block.text.trim();
        case "image":
          return block.alt.trim();
        case "list":
          return block.items.map((item) => item.text.trim()).join("\n");
        case "horizontalRule":
          return "";
      }
    })
    .filter((text) => text.length > 0)
    .join("\n\n");
}

export function isAllowedMarkdownImageTarget(target: string): boolean {
  return /^attachment:\/\/[A-Za-z0-9._~%-]+$/u.test(
    normalizeMarkdownLinkTarget(target),
  );
}

function sanitizeMarkdownImage(alt: string, rawTarget: string): string {
  const target = normalizeMarkdownLinkTarget(rawTarget);
  const safeAlt = sanitizeMarkdownImageAlt(alt);

  if (isAllowedMarkdownImageTarget(target)) {
    return `![${safeAlt}](${target})`;
  }

  return safeAlt.length > 0 ? `[image: ${safeAlt}]` : "";
}

function parseStandaloneMarkdownImage(
  line: string,
): Extract<RequirementMarkdownBlock, { type: "image" }> | undefined {
  const match = line.match(/^!\[([^\]\n]*)\]\(([^)\n]*)\)$/u);

  if (!match) {
    return undefined;
  }

  const src = normalizeMarkdownLinkTarget(match[2] ?? "");

  if (!isAllowedMarkdownImageTarget(src)) {
    return undefined;
  }

  return {
    alt: sanitizeMarkdownImageAlt(match[1] ?? ""),
    src,
    type: "image",
  };
}

function parseList(
  lines: string[],
  startIndex: number,
):
  | {
      block: Extract<RequirementMarkdownBlock, { type: "list" }>;
      nextIndex: number;
    }
  | undefined {
  const first = parseListItem(lines[startIndex] ?? "");

  if (!first) {
    return undefined;
  }

  const items: RequirementMarkdownListItem[] = [first.item];
  let index = startIndex + 1;

  while (index < lines.length) {
    const parsed = parseListItem(lines[index] ?? "");

    if (!parsed || parsed.ordered !== first.ordered) {
      break;
    }

    items.push(parsed.item);
    index += 1;
  }

  return {
    block: {
      items,
      ordered: first.ordered,
      type: "list",
    },
    nextIndex: index,
  };
}

function parseListItem(
  line: string,
): { item: RequirementMarkdownListItem; ordered: boolean } | undefined {
  const match = line.match(/^\s*(?:(\d+)[.)]|[-*+])\s+(.+)$/u);

  if (!match) {
    return undefined;
  }

  const rawText = match[2] ?? "";
  const task = rawText.match(/^\[([ xX])\]\s+(.+)$/u);

  return {
    item: {
      ...(task ? { checked: task[1].toLowerCase() === "x" } : {}),
      text: stripInlineMarkdown(task ? (task[2] ?? "") : rawText),
    },
    ordered: Boolean(match[1]),
  };
}

function startsSpecialBlock(line: string): boolean {
  const trimmed = line.trim();

  return (
    /^```/u.test(trimmed) ||
    /^#{1,6}\s+/u.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})$/u.test(trimmed) ||
    isBlockquoteLine(line) ||
    parseListItem(line) !== undefined ||
    parseStandaloneMarkdownImage(trimmed) !== undefined
  );
}

function isBlockquoteLine(line: string): boolean {
  return /^\s{0,3}>\s?/u.test(line);
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(BASE64_IMAGE_DATA_PATTERN, "")
    .replace(MARKDOWN_IMAGE_PATTERN, "$1")
    .replace(/\[([^\]\n]+)\]\([^\n)]*\)/gu, "$1")
    .replace(/(`+)(.*?)\1/gu, "$2")
    .replace(/(\*\*|__)(.*?)\1/gu, "$2")
    .replace(/(\*|_)(.*?)\1/gu, "$2")
    .trim();
}

function sanitizeMarkdownImageAlt(alt: string): string {
  return alt.replace(/[\\\]\n\r]/gu, "").trim();
}

function normalizeMarkdownLinkTarget(raw: string): string {
  const target = raw.trim().split(/\s+/u)[0] ?? "";

  return target.replace(/^<|>$/gu, "");
}
