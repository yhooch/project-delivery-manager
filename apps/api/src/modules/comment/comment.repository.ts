import type { Comment } from "@project-delivery/shared";

import type {
  CommentListInput,
  CommentListResult,
  CreateCommentInput,
  DeleteCommentInput,
  UpdateCommentInput,
} from "./comment.types";

export const COMMENT_REPOSITORY = Symbol("COMMENT_REPOSITORY");

export type CommentRepository = {
  create(input: CreateCommentInput): Promise<Comment>;
  delete(input: DeleteCommentInput): Promise<Comment | undefined>;
  findById(commentId: string): Promise<Comment | undefined>;
  listByTarget(input: CommentListInput): Promise<CommentListResult>;
  update(input: UpdateCommentInput): Promise<Comment | undefined>;
};
