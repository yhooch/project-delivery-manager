import type {
  CanonicalTargetType,
  LegacyTargetTypeInput,
  RealtimeInvalidationKey,
  RealtimePayloadHints,
} from "@project-delivery/shared";

export type DocumentRequirementKind = "REQUIREMENT";

export type CanonicalTargetForDocumentRequirement = {
  canonicalTargetType: CanonicalTargetType;
  targetKind?: DocumentRequirementKind;
};

const RECENT_ACTIVITY_INVALIDATES = [
  "workbench",
  "space-overview",
] as const satisfies readonly RealtimeInvalidationKey[];

export function canonicalizeTargetForDocumentRequirement(
  targetType: LegacyTargetTypeInput,
  targetKind?: DocumentRequirementKind,
): CanonicalTargetForDocumentRequirement {
  if (targetType === "REQUIREMENT" || targetKind === "REQUIREMENT") {
    return {
      canonicalTargetType: "DOCUMENT",
      targetKind: "REQUIREMENT",
    };
  }

  return {
    canonicalTargetType: targetType,
  };
}

export function normalizeLegacyRequirementTarget<
  TInput extends {
    targetId: string;
    targetType: LegacyTargetTypeInput;
    targetKind?: DocumentRequirementKind;
  },
>(input: TInput): TInput & CanonicalTargetForDocumentRequirement {
  return {
    ...input,
    ...canonicalizeTargetForDocumentRequirement(
      input.targetType,
      input.targetKind,
    ),
  };
}

export function legacyRequirementRealtimeHints(input: {
  spaceId: string;
  targetId: string;
  targetType: LegacyTargetTypeInput;
  targetKind?: DocumentRequirementKind;
  workItemType?: RealtimePayloadHints["workItemType"];
}): RealtimePayloadHints {
  const normalized = normalizeLegacyRequirementTarget(input);

  return {
    targetType: normalized.canonicalTargetType,
    targetId: input.targetId,
    spaceId: input.spaceId,
    ...(normalized.targetKind
      ? {
          canonicalTargetType: normalized.canonicalTargetType,
          requirementId: input.targetId,
          targetKind: normalized.targetKind,
        }
      : {}),
    ...(input.workItemType ? { workItemType: input.workItemType } : {}),
  };
}

export function withDocumentRequirementInvalidates(
  targetType: LegacyTargetTypeInput,
  invalidates: RealtimeInvalidationKey[],
  documentRequirementInvalidates: RealtimeInvalidationKey[],
  targetKind?: DocumentRequirementKind,
): RealtimeInvalidationKey[] {
  if (targetType !== "REQUIREMENT" && targetKind !== "REQUIREMENT") {
    return invalidates;
  }

  return [...new Set([...invalidates, ...documentRequirementInvalidates])];
}

export function withRecentActivityInvalidates(
  invalidates: RealtimeInvalidationKey[],
): RealtimeInvalidationKey[] {
  return [
    ...new Set<RealtimeInvalidationKey>([
      ...invalidates,
      ...RECENT_ACTIVITY_INVALIDATES,
    ]),
  ];
}

export function withDocumentRecentActivityInvalidates(
  targetType: LegacyTargetTypeInput,
  invalidates: RealtimeInvalidationKey[],
  targetKind?: DocumentRequirementKind,
): RealtimeInvalidationKey[] {
  const normalized = canonicalizeTargetForDocumentRequirement(
    targetType,
    targetKind,
  );

  if (normalized.canonicalTargetType !== "DOCUMENT") {
    return invalidates;
  }

  return withRecentActivityInvalidates(invalidates);
}
