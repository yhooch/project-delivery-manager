import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { RequirementModule } from "../requirement/requirement.module";
import { SpaceModule } from "../space/space.module";
import { TargetModule } from "../target/target.module";
import { AttachmentController } from "./attachment.controller";
import { ATTACHMENT_REPOSITORY } from "./attachment.repository";
import { AttachmentService } from "./attachment.service";
import { PrismaAttachmentRepository } from "./prisma-attachment.repository";
import { ATTACHMENT_OBJECT_STORAGE } from "./storage/attachment-object-storage";
import { S3AttachmentObjectStorage } from "./storage/s3-attachment-object-storage";

@Module({
  controllers: [AttachmentController],
  exports: [ATTACHMENT_REPOSITORY],
  imports: [
    AuthModule,
    AuditModule,
    PrismaModule,
    RequirementModule,
    SpaceModule,
    TargetModule,
  ],
  providers: [
    AttachmentService,
    {
      provide: ATTACHMENT_REPOSITORY,
      useClass: PrismaAttachmentRepository,
    },
    {
      provide: ATTACHMENT_OBJECT_STORAGE,
      useClass: S3AttachmentObjectStorage,
    },
  ],
})
export class AttachmentModule {}
