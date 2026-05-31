import type { TagDto } from "@project-delivery/shared";

import type {
  DocumentDetail,
  DocumentLinkSummary,
  DocumentSourceType,
} from "./document-service";
import { extractFirstHeading } from "./document-markdown";
import { isRequirementDocumentLink } from "./document-view-model";
import { getTagIds } from "./tag-ui";

export type DocumentEditForm = {
  baseRevision: number;
  contentMarkdown: string;
  contentText: string;
  linkedDocuments: DocumentLinkSummary[];
  linkedResourceCodes: string;
  selectedTags: TagDto[];
  title: string;
};

export type DocumentPasteForm = {
  contentMarkdown: string;
  sourceType: "PASTE_MARKDOWN" | "PASTE_TEXT";
  title: string;
};

export function createDocumentEditForm(
  document: DocumentDetail,
): DocumentEditForm {
  return {
    baseRevision: document.revision,
    contentMarkdown: document.contentMarkdown,
    contentText:
      document.contentMarkdownCache ?? document.contentText ?? document.contentMarkdown,
    linkedDocuments:
      document.links?.filter(
        (link) =>
          link.targetType === "DOCUMENT" && !isRequirementDocumentLink(link),
      ) ?? [],
    linkedResourceCodes:
      document.links
        ?.filter(
          (link) =>
            link.targetType !== "DOCUMENT" || isRequirementDocumentLink(link),
        )
        .map(formatDocumentLinkCode)
        .join(", ") ?? "",
    selectedTags: document.tags ?? [],
    title: document.title,
  };
}

export function createDocumentPasteForm(
  contentMarkdown = "",
): DocumentPasteForm {
  const title = extractFirstHeading(contentMarkdown) ?? "";

  return {
    contentMarkdown,
    sourceType: "PASTE_MARKDOWN",
    title,
  };
}

export function normalizeDocumentTitle(
  title: string,
  fallbackMarkdown?: string,
): string {
  const trimmed = title.trim();
  if (trimmed) {
    return trimmed;
  }

  return extractFirstHeading(fallbackMarkdown ?? "") ?? "Untitled document";
}

export function splitLinkedResourceCodes(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,，;；]+/u)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

export function getDocumentTagIds(tags: readonly TagDto[]): string[] {
  return getTagIds(tags);
}

export function getImportKind(file: File): "markdown" | "docx" | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return "markdown";
  }
  if (name.endsWith(".docx")) {
    return "docx";
  }
  return null;
}

export function isPlainPasteSource(sourceType: DocumentSourceType): boolean {
  return sourceType === "PASTE_TEXT" || sourceType === "PASTE_MARKDOWN";
}

function formatDocumentLinkCode(link: DocumentLinkSummary): string {
  if (link.displayCode?.trim()) {
    return link.displayCode.trim();
  }

  if (link.targetType === "DOCUMENT") {
    return link.title;
  }

  return link.targetId;
}
