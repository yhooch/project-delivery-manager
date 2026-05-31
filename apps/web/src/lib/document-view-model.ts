import type { ObjectCodeLookupResult } from "@project-delivery/shared";

import type {
  DocumentActorType,
  DocumentFilterKey,
  DocumentLinkSummary,
  DocumentLinkWriteTargetType,
  DocumentSourceType,
  DocumentStatus,
  DocumentSummary,
} from "./document-service";

export function getDocumentStatusVariant(status: DocumentStatus) {
  return status === "ARCHIVED" ? "default" : "success";
}

export function getDocumentSourceKey(sourceType: DocumentSourceType): string {
  return `source.${sourceType}`;
}

export function getDocumentActorKey(actorType: DocumentActorType): string {
  return actorType === "MCP_CLIENT" ? "actor.mcpClient" : "actor.user";
}

export function getDocumentFilterKeys(): DocumentFilterKey[] {
  return ["all", "createdByMe", "archived"];
}

export function isDocumentArchived(document: Pick<DocumentSummary, "status">) {
  return document.status === "ARCHIVED";
}

export function isRequirementDocument(
  document: Pick<DocumentSummary, "kind">,
): boolean {
  return document.kind === "REQUIREMENT";
}

export function canRenderDocumentMarkdownContent(
  document: Pick<DocumentSummary, "contentFormat" | "kind">,
): boolean {
  return document.contentFormat === "MARKDOWN";
}

export function getDocumentDisplayCode(
  document: Pick<DocumentSummary, "displayCode" | "kind" | "sequence">,
): string | null {
  const displayCode = document.displayCode?.trim();
  if (displayCode) {
    return displayCode;
  }

  if (
    document.kind === "REQUIREMENT" &&
    typeof document.sequence === "number"
  ) {
    return `REQ-${document.sequence}`;
  }

  return null;
}

export function formatDocumentRelativeTimestamp(
  value: string,
  locale: string,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

export function getDocumentLinkDisplayCode(link: DocumentLinkSummary): string {
  if (link.displayCode?.trim()) {
    return link.displayCode.trim();
  }

  if (link.targetType === "DOCUMENT") {
    return "DOC";
  }

  return link.targetId.slice(-6).toUpperCase();
}

export function getDocumentLinkHref(link: DocumentLinkSummary): string {
  const id = encodeURIComponent(link.targetId);

  if (link.targetType === "DOCUMENT") {
    if (isRequirementDocumentLink(link)) {
      return `/requirements/${id}`;
    }

    return `/documents/${id}`;
  }
  if (link.targetType === "INTAKE_ITEM") {
    return `/intake-items?id=${id}`;
  }
  if (link.targetType === "VERSION") {
    return `/versions?versionId=${id}`;
  }
  if (link.workItemType === "BUG") {
    return `/bugs?bugId=${id}`;
  }

  return `/work-items?workItemId=${id}`;
}

export function isRequirementDocumentLink(
  link: Pick<DocumentLinkSummary, "displayCode" | "targetType">,
): boolean {
  return (
    link.targetType === "DOCUMENT" &&
    link.displayCode?.trim().startsWith("REQ-") === true
  );
}

export function getObjectCodeLookupHref(
  result: ObjectCodeLookupResult,
): string {
  const id = encodeURIComponent(result.id);

  if (result.type === "REQUIREMENT") {
    return result.kind === "REQUIREMENT" &&
      result.codeStatus !== "CANCELLED" &&
      result.codeStatus !== "DELETED"
      ? `/requirements/${id}`
      : `/documents/${id}`;
  }
  if (result.type === "INTAKE_ITEM") {
    return `/intake-items?id=${id}`;
  }
  if (result.workItemType === "BUG") {
    return `/bugs?bugId=${id}`;
  }

  return `/work-items?workItemId=${id}`;
}

export function getLookupTargetType(
  result: ObjectCodeLookupResult,
): DocumentLinkWriteTargetType {
  if (result.type === "REQUIREMENT") {
    return "DOCUMENT";
  }
  if (result.type === "INTAKE_ITEM") {
    return "INTAKE_ITEM";
  }

  return "WORK_ITEM";
}
