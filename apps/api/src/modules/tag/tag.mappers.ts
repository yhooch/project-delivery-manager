import type { TagDto } from "@project-delivery/shared";

type PrismaTagRecord = {
  colorKey: string;
  createdAt: Date;
  id: string;
  name: string;
  normalizedName: string;
  organizationId: string;
  spaceId: string;
  updatedAt: Date;
};

type TagUsageFields = {
  usageCount?: number;
};

export function toTagDto(
  record: PrismaTagRecord,
  usage?: TagUsageFields,
): TagDto {
  return removeUndefined({
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    name: record.name,
    displayName: `#${record.name}`,
    normalizedName: record.normalizedName,
    colorKey: record.colorKey,
    usageCount: usage?.usageCount,
    isOrphan:
      usage?.usageCount === undefined ? undefined : usage.usageCount === 0,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
