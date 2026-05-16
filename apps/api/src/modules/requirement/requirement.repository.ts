import type { Requirement } from "@project-delivery/shared";

import type {
  ArchiveRequirementInput,
  CreateRequirementDraftInput,
  DeleteRequirementDraftInput,
  RequirementVersionCascadeImpact,
  RequirementListInput,
  RequirementListResult,
  SaveRequirementInput,
} from "./requirement.types";

export const REQUIREMENT_REPOSITORY = Symbol("REQUIREMENT_REPOSITORY");

export type RequirementRepository = {
  createDraft(input: CreateRequirementDraftInput): Promise<Requirement>;
  findById(requirementId: string): Promise<Requirement | undefined>;
  isParticipant(
    spaceId: string,
    requirementId: string,
    userId: string,
  ): Promise<boolean>;
  listBySpaceId(
    spaceId: string,
    input: RequirementListInput,
  ): Promise<RequirementListResult>;
  countVersionCascadeImpact(input: {
    requirementId: string;
    nextVersionId: string | null;
  }): Promise<RequirementVersionCascadeImpact>;
  save(input: SaveRequirementInput): Promise<Requirement | undefined>;
  archive(input: ArchiveRequirementInput): Promise<Requirement | undefined>;
  deleteDraft(input: DeleteRequirementDraftInput): Promise<boolean>;
};
