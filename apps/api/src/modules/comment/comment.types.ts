import type {
  Comment,
  CommentTargetType,
  PageResult,
  WorkItemType,
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
  targetWorkItemType?: WorkItemType;
  timelineEventId: string;
};

export type UpdateCommentInput = {
  body: string;
  commentId: string;
  updatedById: string;
};

export type DeleteCommentInput = {
  commentId: string;
  deletedById: string;
};
