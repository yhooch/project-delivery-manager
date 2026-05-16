import { HttpStatus } from "@nestjs/common";

import { ApiException } from "../../http/api-exception";

export type TraceVersionRef = {
  label: string;
  versionId?: string | null;
};

export type TraceVersionCascadeImpact = {
  intakeItemCount?: number;
  intakeItemIds?: string[];
  workItemCount: number;
  workItemIds?: string[];
  bugCount: number;
  bugIds?: string[];
  relatedBugCount?: number;
  relatedBugIds?: string[];
};

export function resolveRequiredTraceVersion(
  refs: readonly TraceVersionRef[],
): string | undefined {
  const versionRefs = refs.filter((ref) => Boolean(ref.versionId));
  const versionIds = new Set(versionRefs.map((ref) => ref.versionId));

  if (versionIds.size <= 1) {
    return versionRefs[0]?.versionId ?? undefined;
  }

  throwTraceVersionConflict({
    refs: versionRefs,
  });
}

export function resolveTraceVersion(input: {
  currentVersionId?: string;
  requestedVersionId?: string | null;
  refs: readonly TraceVersionRef[];
}): string | null | undefined {
  const requiredVersionId = resolveRequiredTraceVersion(input.refs);

  if (!requiredVersionId) {
    return input.requestedVersionId;
  }

  if (
    input.requestedVersionId !== undefined &&
    input.requestedVersionId !== requiredVersionId
  ) {
    throwTraceVersionConflict({
      requestedVersionId: input.requestedVersionId,
      requiredVersionId,
      refs: input.refs,
    });
  }

  if (input.currentVersionId !== requiredVersionId) {
    return requiredVersionId;
  }

  return input.requestedVersionId === undefined ? undefined : requiredVersionId;
}

export function hasTraceVersionChange(
  currentVersionId: string | undefined,
  nextVersionId: string | null | undefined,
) {
  return (
    nextVersionId !== undefined && (currentVersionId ?? null) !== nextVersionId
  );
}

export function hasTraceVersionCascadeImpact(
  impact: TraceVersionCascadeImpact,
) {
  return (
    (impact.intakeItemCount ?? 0) > 0 ||
    impact.workItemCount > 0 ||
    impact.bugCount > 0 ||
    (impact.relatedBugCount ?? 0) > 0
  );
}

export function assertTraceRefsMatchVersion(input: {
  versionId: string | null;
  refs: readonly TraceVersionRef[];
  details?: Record<string, unknown>;
}) {
  const conflicts = input.refs.filter(
    (ref) => ref.versionId && ref.versionId !== input.versionId,
  );

  if (conflicts.length === 0) {
    return;
  }

  throwTraceCascadeConflict({
    ...input.details,
    conflicts,
    targetVersionId: input.versionId,
  });
}

export function throwTraceVersionConflict(details?: unknown): never {
  throw new ApiException(
    "TRACE_VERSION_CONFLICT",
    "Linked requirement, intake item, task or version use incompatible versions",
    HttpStatus.BAD_REQUEST,
    details,
  );
}

export function throwTraceVersionChangeRequiresCascade(details: {
  targetType: "REQUIREMENT" | "INTAKE_ITEM";
  targetId: string;
  fromVersionId?: string;
  toVersionId: string | null;
  impact: TraceVersionCascadeImpact;
}): never {
  throw new ApiException(
    "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
    "Version change affects linked delivery items; set cascadeVersionChange to true to update them together",
    HttpStatus.CONFLICT,
    details,
  );
}

export function throwTraceCascadeConflict(details?: unknown): never {
  throw new ApiException(
    "TRACE_CASCADE_CONFLICT",
    "Version cascade would conflict with another linked upstream version",
    HttpStatus.CONFLICT,
    details,
  );
}
