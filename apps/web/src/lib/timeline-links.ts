import type { TimelineEvent, WorkItemType } from "@project-delivery/shared";

type TimelineLinkOptions = {
  unknownWorkItemHref?: string | null;
};

const BUG_ONLY_FIELDS = new Set([
  "actualResult",
  "expectedResult",
  "relatedTaskId",
  "severity",
  "stepsToReproduce",
]);

export function getTimelineEventHref(
  event: TimelineEvent,
  options: TimelineLinkOptions = {},
): string | null {
  const id = encodeURIComponent(event.target.id);
  const focusParams = getTimelineFocusParams(event);
  const scopedParams = {
    spaceId: event.spaceId,
    ...focusParams,
  };

  if (event.target.type === "WORK_ITEM") {
    const workItemType = getTimelineWorkItemType(event);

    if (workItemType === "BUG") {
      return withQuery(`/bugs?bugId=${id}`, scopedParams);
    }

    if (workItemType === "TASK") {
      return withQuery(`/work-items?workItemId=${id}`, scopedParams);
    }

    return options.unknownWorkItemHref ?? null;
  }

  if (event.target.type === "DOCUMENT") {
    if (isRequirementDocumentTimelineEvent(event)) {
      if (focusParams.commentId || focusParams.attachmentId) {
        return withQuery(`/documents/${id}`, scopedParams);
      }

      return withQuery(`/requirements/${id}`, { spaceId: event.spaceId });
    }

    return withQuery(`/documents/${id}`, scopedParams);
  }

  if (event.target.type === "INTAKE_ITEM") {
    return withQuery(`/intake-items?id=${id}`, scopedParams);
  }

  if (event.target.type === "VERSION") {
    return withQuery(`/versions?versionId=${id}`, {
      eventId: event.id,
      panel: "timeline",
      spaceId: event.spaceId,
    });
  }

  return null;
}

function getTimelineFocusParams(
  event: TimelineEvent,
): Record<string, string | undefined> {
  const commentId = readMetadataString(event, "commentId");
  if (event.eventType === "COMMENTED" && commentId) {
    return {
      commentId,
      panel: "comments",
    };
  }

  const attachmentId = readMetadataString(event, "attachmentId");
  if (event.eventType === "ATTACHMENT_ADDED" && attachmentId) {
    return {
      attachmentId,
      panel: "attachments",
    };
  }

  if (
    event.target.type === "WORK_ITEM" ||
    event.target.type === "INTAKE_ITEM"
  ) {
    return {
      eventId: event.id,
      panel: "timeline",
    };
  }

  return {};
}

function readMetadataString(
  event: TimelineEvent,
  key: "attachmentId" | "commentId",
) {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function withQuery(
  href: string,
  params: Record<string, string | undefined>,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  if (!queryString) {
    return href;
  }

  return `${href}${href.includes("?") ? "&" : "?"}${queryString}`;
}

function isRequirementDocumentTimelineEvent(event: TimelineEvent): boolean {
  return (
    event.metadata?.["targetKind"] === "REQUIREMENT" ||
    event.target.displayCode?.startsWith("REQ-") === true
  );
}

export function getTimelineWorkItemType(
  event: Pick<TimelineEvent, "after" | "before" | "metadata">,
): WorkItemType | null {
  return (
    readWorkItemType(event.metadata) ??
    readWorkItemType(event.after) ??
    readWorkItemType(event.before) ??
    inferBugFromTimelineFields(event.after) ??
    inferBugFromTimelineFields(event.before)
  );
}

function readWorkItemType(
  record: Record<string, unknown> | undefined,
): WorkItemType | null {
  if (!record) {
    return null;
  }

  for (const key of ["workItemType", "targetWorkItemType"]) {
    const value = toWorkItemType(record[key]);
    if (value) {
      return value;
    }
  }

  const operation = record.operation;
  if (operation === "createBug" || operation === "updateBug") {
    return "BUG";
  }
  if (operation === "createWorkItem" || operation === "updateWorkItem") {
    return "TASK";
  }

  return (
    readNestedWorkItemType(record.workItem) ??
    readNestedWorkItemType(record.target)
  );
}

function readNestedWorkItemType(value: unknown): WorkItemType | null {
  if (!isRecord(value)) {
    return null;
  }

  return (
    toWorkItemType(value.type) ??
    toWorkItemType(value.workItemType) ??
    toWorkItemType(value.targetWorkItemType)
  );
}

function inferBugFromTimelineFields(
  record: Record<string, unknown> | undefined,
): WorkItemType | null {
  if (!record) {
    return null;
  }

  return Object.keys(record).some((key) => BUG_ONLY_FIELDS.has(key))
    ? "BUG"
    : null;
}

function toWorkItemType(value: unknown): WorkItemType | null {
  return value === "BUG" || value === "TASK" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
