export type MarkdownInlineToken =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; text: string }
  | { kind: "objectCode"; code: string }
  | { alt: string; href: string; kind: "imageLink"; remote: boolean };

export type MarkdownListItem = {
  children: MarkdownListBlock[];
  tokens: MarkdownInlineToken[];
};

export type MarkdownListBlock = {
  items: MarkdownListItem[];
  kind: "list";
  ordered: boolean;
};

export type MarkdownBlock =
  | { id: string; inlines: MarkdownInlineToken[]; kind: "heading"; level: number; text: string }
  | { inlines: MarkdownInlineToken[]; kind: "paragraph" }
  | { inlines: MarkdownInlineToken[]; kind: "subheading"; text: string }
  | { kind: "code"; code: string; language?: string }
  | { inlines: MarkdownInlineToken[]; kind: "quote" }
  | MarkdownListBlock
  | {
      header: MarkdownInlineToken[][];
      kind: "table";
      rows: MarkdownInlineToken[][][];
    }
  | { kind: "rule" };

export type MarkdownHeading = {
  id: string;
  level: number;
  text: string;
};

export function extractFirstHeading(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^#\s+(.+)$/u.exec(line.trim());
    if (match?.[1]?.trim()) {
      return stripInlineMarkdown(match[1]).trim();
    }
  }

  return null;
}

export function markdownToPlainText(markdown: string): string {
  const blocks = parseMarkdown(markdown);

  return blocks
    .map((block) => {
      if (block.kind === "code") {
        return block.code;
      }
      if (block.kind === "heading") {
        return block.text;
      }
      if (block.kind === "list") {
        return listItemsToText(block.items);
      }
      if (block.kind === "table") {
        return [block.header, ...block.rows]
          .map((row) => row.map(tokensToText).join(" "))
          .join("\n");
      }
      if (
        block.kind === "paragraph" ||
        block.kind === "quote" ||
        block.kind === "subheading"
      ) {
        return tokensToText(block.inlines);
      }
      return "";
    })
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  const usedHeadingIds = new Map<string, number>();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const fence = /^```(\S*)\s*$/u.exec(trimmed);
    if (fence) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/u.test(lines[i]?.trim() ?? "")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push({
        kind: "code",
        code: codeLines.join("\n"),
        language: fence[1] || undefined,
      });
      continue;
    }

    if (/^(?:---|\*\*\*|___)$/u.test(trimmed)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(trimmed);
    if (heading?.[1] && heading[2]) {
      const text = stripInlineMarkdown(heading[2]).trim();
      blocks.push({
        id: createUniqueHeadingId(text, usedHeadingIds),
        inlines: tokenizeInline(heading[2]),
        kind: "heading",
        level: heading[1].length,
        text,
      });
      i += 1;
      continue;
    }

    if (/^>\s?/u.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/u.test((lines[i] ?? "").trim())) {
        quoteLines.push((lines[i] ?? "").trim().replace(/^>\s?/u, ""));
        i += 1;
      }
      blocks.push({
        inlines: tokenizeInline(quoteLines.join(" ")),
        kind: "quote",
      });
      continue;
    }

    const standaloneStrong = parseStandaloneStrongLine(trimmed);
    if (standaloneStrong) {
      blocks.push({
        inlines: tokenizeInline(standaloneStrong),
        kind: "subheading",
        text: stripInlineMarkdown(standaloneStrong).trim(),
      });
      i += 1;
      continue;
    }

    const list = parseList(lines, i);
    if (list) {
      blocks.push(list.block);
      i = list.nextIndex;
      continue;
    }

    if (isTableRow(trimmed)) {
      const rowLines: string[] = [];
      while (i < lines.length && isTableRow((lines[i] ?? "").trim())) {
        const next = (lines[i] ?? "").trim();
        if (!/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/u.test(next)) {
          rowLines.push(next);
        }
        i += 1;
      }
      if (rowLines.length > 0) {
        const [headerLine, ...bodyLines] = rowLines;
        blocks.push({
          header: splitTableRow(headerLine ?? "").map(tokenizeInline),
          kind: "table",
          rows: bodyLines.map((rowLine) =>
            splitTableRow(rowLine).map(tokenizeInline),
          ),
        });
      }
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && shouldContinueParagraph(lines[i] ?? "")) {
      paragraphLines.push((lines[i] ?? "").trim());
      i += 1;
    }
    blocks.push({
      inlines: tokenizeInline(paragraphLines.join(" ")),
      kind: "paragraph",
    });
  }

  return blocks;
}

export function getMarkdownHeadings(markdown: string): MarkdownHeading[] {
  return parseMarkdown(markdown).flatMap((block) =>
    block.kind === "heading"
      ? [{ id: block.id, level: block.level, text: block.text }]
      : [],
  );
}

export function tokenizeInline(input: string): MarkdownInlineToken[] {
  const tokens: MarkdownInlineToken[] = [];
  let cursor = 0;
  const pattern =
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|`([^`]+)`|(?:\*\*([^*]+)\*\*|__([^_]+)__)|\b(?:REQ|INTAKE|TASK|BUG)-[1-9]\d*\b/giu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input))) {
    if (match.index > cursor) {
      tokens.push({ kind: "text", text: input.slice(cursor, match.index) });
    }

    const raw = match[0];
    if (match[1] !== undefined && match[2]) {
      tokens.push({
        alt: match[1],
        href: sanitizeHref(match[2]) ?? "#",
        kind: "imageLink",
        remote: isRemoteUrl(match[2]),
      });
    } else if (match[3] !== undefined && match[4]) {
      const href = sanitizeHref(match[4]);
      tokens.push(
        href
          ? { href, kind: "link", text: match[3] }
          : { kind: "text", text: match[3] },
      );
    } else if (match[5] !== undefined) {
      tokens.push({ kind: "code", text: match[5] });
    } else if (match[6] !== undefined || match[7] !== undefined) {
      tokens.push({ kind: "strong", text: match[6] ?? match[7] ?? "" });
    } else if (/^(?:REQ|INTAKE|TASK|BUG)-[1-9]\d*$/iu.test(raw)) {
      tokens.push({ code: raw.toUpperCase(), kind: "objectCode" });
    } else {
      tokens.push({ kind: "text", text: raw });
    }

    cursor = match.index + raw.length;
  }

  if (cursor < input.length) {
    tokens.push({ kind: "text", text: input.slice(cursor) });
  }

  return tokens.filter((token) => token.kind !== "text" || token.text);
}

export function sanitizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (
    /^(https?:|mailto:)/iu.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#")
  ) {
    return trimmed;
  }

  return null;
}

export function isRemoteUrl(href: string): boolean {
  return /^https?:\/\//iu.test(href);
}

function parseList(
  lines: string[],
  startIndex: number,
): { block: MarkdownBlock; nextIndex: number } | null {
  const first = parseListLine(lines[startIndex] ?? "");

  if (!first) {
    return null;
  }

  return parseListBlock(lines, startIndex, first.indent, first.ordered);
}

function shouldContinueParagraph(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(trimmed) && !/^(#{1,6})\s+|^```|^>\s?|^(\s*)([-*+]|\d+[.)])\s+|^(?:---|\*\*\*|___)$/u.test(trimmed);
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.split("|").length >= 3;
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseStandaloneStrongLine(line: string): string | null {
  const match = /^(?:\*\*([^*]+)\*\*|__([^_]+)__)\s*$/u.exec(line);
  const text = match?.[1] ?? match?.[2];

  return text?.trim() || null;
}

function parseListBlock(
  lines: string[],
  startIndex: number,
  indent: number,
  ordered: boolean,
): { block: MarkdownListBlock; nextIndex: number } {
  const items: MarkdownListItem[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = parseListLine(lines[i] ?? "");

    if (!line || line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      const parent = items.at(-1);

      if (!parent) {
        break;
      }

      const nested = parseListBlock(lines, i, line.indent, line.ordered);
      parent.children.push(nested.block);
      i = nested.nextIndex;
      continue;
    }

    if (line.ordered !== ordered) {
      break;
    }

    items.push({ children: [], tokens: tokenizeInline(line.text) });
    i += 1;
  }

  return {
    block: { items, kind: "list", ordered },
    nextIndex: i,
  };
}

function parseListLine(
  line: string,
): { indent: number; ordered: boolean; text: string } | null {
  const match = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/u.exec(line);

  if (!match?.[2] || !match[3]) {
    return null;
  }

  return {
    indent: countMarkdownIndent(match[1] ?? ""),
    ordered: /\d+[.)]/u.test(match[2]),
    text: match[3],
  };
}

function countMarkdownIndent(value: string): number {
  return value.replace(/\t/gu, "    ").length;
}

function stripInlineMarkdown(input: string): string {
  return input
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[`*_~]/gu, "")
    .replace(/\s+/gu, " ");
}

function tokensToText(tokens: MarkdownInlineToken[]): string {
  return tokens
    .map((token) => {
      if (token.kind === "imageLink") {
        return token.alt || token.href;
      }
      if (token.kind === "objectCode") {
        return token.code;
      }
      return token.text;
    })
    .join("");
}

function listItemsToText(items: MarkdownListItem[]): string {
  return items
    .flatMap((item) => [
      tokensToText(item.tokens),
      ...item.children.map((child) => listItemsToText(child.items)),
    ])
    .filter(Boolean)
    .join("\n");
}

function createUniqueHeadingId(text: string, used: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "section";
  const current = used.get(base) ?? 0;
  used.set(base, current + 1);

  return current === 0 ? base : `${base}-${current + 1}`;
}
