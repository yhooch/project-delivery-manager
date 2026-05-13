import type {
  Comment,
  CommentTargetType,
  PageResult,
} from "@project-delivery/shared";

export type CommentListInput = {
  organizationId: string;
  page: number;
  pageSize: number;
  spaceId: string;
  targetId: string;
  targetType: CommentTargetType;
};

export type CommentListResult = PageResult<Comment>;

export type CreateCommentInput = {
  authorId: string;
  body: string;
  id: string;
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: CommentTargetType;
  timelineEventId: string;
};
