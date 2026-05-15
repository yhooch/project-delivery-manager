import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CommentQuerySchema,
  CreateCommentRequestSchema,
  type Comment,
  type CommentTargetType,
  type PageResult,
} from "@project-delivery/shared";
import type { z } from "zod";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { getRequestMetadata } from "../auth/request-metadata";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { CommentService } from "./comment.service";

type CreateCommentRequestBody = z.infer<typeof CreateCommentRequestSchema>;

@Controller("comments")
@UseGuards(RequireSessionGuard)
export class CommentController {
  constructor(
    @Inject(CommentService)
    private readonly comments: CommentService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(CommentQuerySchema))
    query: {
      page: number;
      pageSize: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      targetId: string;
      targetType: CommentTargetType;
    },
    @Req() request: RequestWithContext,
  ): Promise<PageResult<Comment>> {
    const session = this.currentUser.requireSession(request);

    return this.comments.list(session.userId, query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async create(
    @Body(new ZodValidationPipe(CreateCommentRequestSchema))
    body: CreateCommentRequestBody,
    @Req() request: RequestWithContext,
  ): Promise<Comment> {
    const session = this.currentUser.requireSession(request);

    return this.comments.create(session.userId, body, getRequestMetadata(request));
  }
}
