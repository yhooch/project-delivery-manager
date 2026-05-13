import type { Comment, PageResult } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createComment,
  listComments,
  type CommentApiTransport,
} from "./comment-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const targetId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const commentId = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const authorId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";

function createCommentFixture(overrides: Partial<Comment> = {}): Comment {
  return {
    author: {
      id: authorId,
      name: "Ada",
      username: "ada",
    },
    body: "Looks good.",
    createdAt: "2026-05-13T10:00:00.000Z",
    id: commentId,
    organizationId,
    spaceId,
    targetId,
    targetType: "WORK_ITEM",
    ...overrides,
  };
}

function createPage(items: Comment[]): PageResult<Comment> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function createApi(
  overrides: Partial<Record<keyof CommentApiTransport, unknown>>,
): CommentApiTransport {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as CommentApiTransport;
}

describe("comment service", () => {
  it("lists comments by target while requiring a space context", async () => {
    const page = createPage([createCommentFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listComments(
        {
          organizationId,
          page: 1,
          pageSize: 20,
          spaceId,
          targetId,
          targetType: "WORK_ITEM",
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith("/comments", {
      query: {
        page: 1,
        pageSize: 20,
        targetId,
        targetType: "WORK_ITEM",
      },
    });
  });

  it("creates comments through the shared request schema", async () => {
    const comment = createCommentFixture();
    const api = createApi({
      post: vi.fn(async () => ({ data: comment })),
    });

    await expect(
      createComment(
        {
          body: "Looks good.",
          organizationId,
          spaceId,
          targetId,
          targetType: "WORK_ITEM",
        },
        api,
      ),
    ).resolves.toEqual(comment);

    expect(api.post).toHaveBeenCalledWith("/comments", {
      body: "Looks good.",
      targetId,
      targetType: "WORK_ITEM",
    });
  });
});
