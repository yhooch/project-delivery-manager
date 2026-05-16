export type VersionedTraceOption = {
  versionId?: string | null;
};

export function filterTraceOptionsByVersion<T extends VersionedTraceOption>(
  options: T[],
  versionId: string,
): T[] {
  if (!versionId) {
    return options;
  }

  return options.filter((option) => option.versionId === versionId);
}

export function isTraceOptionCompatibleWithVersion(
  option: VersionedTraceOption | undefined,
  versionId: string,
): boolean {
  if (!option) {
    return true;
  }

  if (!versionId) {
    return !option.versionId;
  }

  return option.versionId === versionId;
}
