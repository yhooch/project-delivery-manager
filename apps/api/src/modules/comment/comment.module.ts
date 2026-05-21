import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { TargetModule } from "../target/target.module";
import { CommentController } from "./comment.controller";
import { COMMENT_REPOSITORY } from "./comment.repository";
import { CommentService } from "./comment.service";
import { PrismaCommentRepository } from "./prisma-comment.repository";

@Module({
  controllers: [CommentController],
  exports: [COMMENT_REPOSITORY, CommentService],
  imports: [AuthModule, AuditModule, PrismaModule, RealtimeModule, TargetModule],
  providers: [
    CommentService,
    {
      provide: COMMENT_REPOSITORY,
      useClass: PrismaCommentRepository,
    },
  ],
})
export class CommentModule {}
