import type { Prisma } from "../../generated/prisma/client";

export type RequirementReferenceScope = {
  organizationId: string;
  requirementId: string;
  spaceId: string;
};

export type ReferenceableRequirementDocument = {
  id: string;
  organizationId: string;
  sequence: number;
  spaceId: string;
  versionId: string | null;
};

export const referenceableRequirementDocumentSelect = {
  id: true,
  organizationId: true,
  sequence: true,
  spaceId: true,
  versionId: true,
} satisfies Prisma.DocumentSelect;

export function referenceableRequirementDocumentWhere(
  input: RequirementReferenceScope,
): Prisma.DocumentWhereInput {
  return {
    deletedAt: null,
    id: input.requirementId,
    kind: "REQUIREMENT",
    organizationId: input.organizationId,
    sequence: {
      not: null,
    },
    spaceId: input.spaceId,
    status: "ACTIVE",
  };
}

export function isReferenceableRequirementDocument(input: {
  sequence?: number | null;
  status?: string | null;
}): boolean {
  return input.status === "ACTIVE" && input.sequence != null;
}
