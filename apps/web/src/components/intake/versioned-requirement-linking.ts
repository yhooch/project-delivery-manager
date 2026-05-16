export type VersionedRequirementOption = {
  versionId?: string | null;
};

export function filterRequirementsByVersion<
  T extends VersionedRequirementOption,
>(requirements: T[], versionId: string): T[] {
  if (!versionId) {
    return requirements;
  }

  return requirements.filter(
    (requirement) => requirement.versionId === versionId,
  );
}

export function isRequirementCompatibleWithVersion(
  requirement: VersionedRequirementOption | undefined,
  versionId: string,
): boolean {
  if (!requirement) {
    return true;
  }

  if (!versionId) {
    return !requirement.versionId;
  }

  return requirement.versionId === versionId;
}
