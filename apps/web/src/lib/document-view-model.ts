import type { ObjectCodeLookupResult } from "@project-delivery/shared";

import type {
  DocumentActorType,
  DocumentFilterKey,
  DocumentLinkSummary,
  DocumentLinkTargetType,
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
  return ["all", "createdByMe", "mcpCreated", "recentMcpEdited", "archived"];
}

export function isDocumentArchived(document: Pick<DocumentSummary, "status">) {
  return document.status === "ARCHIVED";
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
    return `/documents/${id}`;
  }
  if (link.targetType === "REQUIREMENT") {
    return `/requirements/${id}`;
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

export function getObjectCodeLookupHref(result: ObjectCodeLookupResult): string {
  const id = encodeURIComponent(result.id);

  if (result.type === "REQUIREMENT") {
    return `/requirements/${id}`;
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
): DocumentLinkTargetType {
  if (result.type === "REQUIREMENT") {
    return "REQUIREMENT";
  }
  if (result.type === "INTAKE_ITEM") {
    return "INTAKE_ITEM";
  }

  return "WORK_ITEM";
}
