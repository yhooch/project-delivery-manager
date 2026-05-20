import type { TagDto } from "@project-delivery/shared";

import type {
  CreateTagInput,
  ListTagsByTargetsInput,
  ReplaceTagAssignmentsInput,
  SoftDeleteTagInput,
  SoftDeleteTagResult,
  TagAssignmentTargetInput,
  TagListInput,
  TagListResult,
} from "./tag.types";

export const TAG_REPOSITORY = Symbol("TAG_REPOSITORY");

export type TagRepository = {
  create(input: CreateTagInput): Promise<TagDto>;
  findActiveById(tagId: string): Promise<TagDto | undefined>;
  findActiveByNormalizedName(
    spaceId: string,
    normalizedName: string,
  ): Promise<TagDto | undefined>;
  listTagsByTarget(input: TagAssignmentTargetInput): Promise<TagDto[]>;
  listTagsByTargets(
    input: ListTagsByTargetsInput,
  ): Promise<Map<string, TagDto[]>>;
  listBySpace(input: TagListInput): Promise<TagListResult>;
  replaceAssignments(input: ReplaceTagAssignmentsInput): Promise<TagDto[]>;
  softDeleteOrphan(input: SoftDeleteTagInput): Promise<SoftDeleteTagResult>;
};
