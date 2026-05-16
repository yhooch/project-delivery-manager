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

  if (event.target.type === "WORK_ITEM") {
    const workItemType = getTimelineWorkItemType(event);

    if (workItemType === "BUG") {
      return `/bugs?bugId=${id}`;
    }

    if (workItemType === "TASK") {
      return `/work-items?workItemId=${id}`;
    }

    return options.unknownWorkItemHref ?? null;
  }

  if (event.target.type === "REQUIREMENT") {
    return `/requirements/${id}`;
  }

  if (event.target.type === "INTAKE_ITEM") {
    return `/intake-items?id=${id}`;
  }

  if (event.target.type === "VERSION") {
    return `/versions?versionId=${id}`;
  }

  return null;
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
