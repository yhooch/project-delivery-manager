import type { Comment } from "@project-delivery/shared";

import type {
  CommentListInput,
  CommentListResult,
  CreateCommentInput,
} from "./comment.types";

export const COMMENT_REPOSITORY = Symbol("COMMENT_REPOSITORY");

export type CommentRepository = {
  create(input: CreateCommentInput): Promise<Comment>;
  listByTarget(input: CommentListInput): Promise<CommentListResult>;
};
