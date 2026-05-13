import {
  CommentQuerySchema,
  CreateCommentRequestSchema,
  CreateCommentResponseSchema,
  ListCommentsResponseSchema,
  type Comment,
  type CommentTargetType,
  type PageResult,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";

export type CommentApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

export type ListCommentsInput = z.input<typeof CommentQuerySchema> & {
  organizationId?: string;
  spaceId: string;
};

export type CreateCommentInput = z.input<typeof CreateCommentRequestSchema> & {
  organizationId?: string;
  spaceId: string;
};

export type CommentTargetIdentity = {
  organizationId?: string;
  spaceId: string;
  targetId: string;
  targetType: CommentTargetType;
};

const defaultApi: CommentApiTransport = apiClient;

export async function listComments(
  input: ListCommentsInput,
  api: CommentApiTransport = defaultApi,
): Promise<PageResult<Comment>> {
  const { organizationId: _organizationId, spaceId: _spaceId, ...filters } =
    input;
  const query = CommentQuerySchema.parse(filters);
  const response = await api.get<unknown>("/comments", {
    query,
  });

  return ListCommentsResponseSchema.parse(response.data);
}

export async function createComment(
  input: CreateCommentInput,
  api: CommentApiTransport = defaultApi,
): Promise<Comment> {
  const { organizationId: _organizationId, spaceId: _spaceId, ...request } =
    input;
  const body = CreateCommentRequestSchema.parse(request);
  const response = await api.post<unknown>("/comments", body);

  return CreateCommentResponseSchema.parse(response.data);
}
