import type { IntakeItem, TagDto } from "@project-delivery/shared";

type PrismaIntakeItemRecord = {
  acceptedAt: Date | null;
  assigneeId: string | null;
  convertedAt: Date | null;
  description: string | null;
  id: string;
  organizationId: string;
  priority: IntakeItem["priority"] | null;
  reporterId: string;
  requirementId: string | null;
  sourceObject: unknown;
  sourceType: IntakeItem["sourceType"];
  spaceId: string;
  status: IntakeItem["status"];
  title: string;
  updatedAt: Date;
  versionId: string | null;
};

export function toIntakeItem(
  record: PrismaIntakeItemRecord,
  tags: TagDto[] = [],
): IntakeItem {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    versionId: record.versionId ?? undefined,
    requirementId: record.requirementId ?? undefined,
    title: record.title,
    description: record.description ?? undefined,
    sourceType: record.sourceType,
    sourceObject: toSourceObject(record.sourceObject),
    status: record.status,
    priority: record.priority ?? undefined,
    reporterId: record.reporterId,
    assigneeId: record.assigneeId ?? undefined,
    tags,
    acceptedAt: record.acceptedAt?.toISOString(),
    convertedAt: record.convertedAt?.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toSourceObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
