import type { Version, VersionStatus } from "@project-delivery/shared";

type PrismaVersionRecord = {
  blockedCount: number;
  bugCount: number;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  ownerId: string | null;
  releaseDate: Date | null;
  requirementCount: number;
  spaceId: string;
  startDate: Date | null;
  status: VersionStatus;
  target: string | null;
  targetDate: Date | null;
  taskCount: number;
};

export function toVersion(
  record: PrismaVersionRecord,
  overrides?: { requirementCount?: number },
): Version {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    name: record.name,
    target: record.target ?? undefined,
    description: record.description ?? undefined,
    ownerId: record.ownerId ?? undefined,
    status: record.status,
    startDate: record.startDate?.toISOString(),
    targetDate: record.targetDate?.toISOString(),
    releaseDate: record.releaseDate?.toISOString(),
    stats: {
      requirementCount:
        overrides?.requirementCount ?? record.requirementCount,
      taskCount: record.taskCount,
      bugCount: record.bugCount,
      blockedCount: record.blockedCount,
    },
  };
}
