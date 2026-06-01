import type {
  GetTagAssignmentsQuery,
  ListTagFilterOptionsQuery,
  ListTagsQuery,
  MergeTagsRequest,
  MergeTagsResponse,
  PageResult,
  ReplaceTagAssignmentsRequest,
  TagDto,
  TagTargetType,
} from "@project-delivery/shared";

export type TagListInput = ListTagsQuery & {
  normalizedQuery?: string;
  organizationId: string;
  spaceId: string;
};

export type TagFilterOptionsInput = ListTagFilterOptionsQuery & {
  now: Date;
  organizationId: string;
  spaceId: string;
  staleThresholdDays: number;
};

export type CreateTagInput = {
  colorKey: string;
  createdById: string;
  id: string;
  name: string;
  normalizedName: string;
  organizationId: string;
  spaceId: string;
};

export type SoftDeleteTagInput = {
  tagId: string;
  updatedById: string;
};

export type SoftDeleteTagResult =
  | {
      status: "deleted";
      deletedAt: Date;
      tag: TagDto;
    }
  | {
      status: "in_use";
    }
  | {
      status: "not_found";
    };

export type MergeTagsInput = Pick<
  MergeTagsRequest,
  "sourceTagIds" | "targetTagId" | "dryRun"
> & {
  organizationId: string;
  spaceId: string;
  updatedById: string;
};

export type MergeTagsResult = MergeTagsResponse;

export type TagListResult = PageResult<TagDto>;

export type TagAssignmentTargetInput = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: TagTargetType;
};

export type ReplaceTagAssignmentsInput = TagAssignmentTargetInput &
  Pick<ReplaceTagAssignmentsRequest, "tagIds"> & {
    assignedById: string;
  };

export type ListTagsByTargetsInput = Omit<
  TagAssignmentTargetInput,
  "targetId"
> & {
  targetIds: string[];
};

export type GetTagAssignmentsInput = GetTagAssignmentsQuery;
