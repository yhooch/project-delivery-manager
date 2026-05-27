import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AttachmentModule } from "../attachment/attachment.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SpaceModule } from "../space/space.module";
import { TargetModule } from "../target/target.module";
import { DocumentController } from "./document.controller";
import { DOCUMENT_REPOSITORY } from "./document.repository";
import { DocumentService } from "./document.service";
import { PrismaDocumentRepository } from "./prisma-document.repository";

@Module({
  controllers: [DocumentController],
  exports: [DOCUMENT_REPOSITORY, DocumentService],
  imports: [
    AttachmentModule,
    AuthModule,
    AuditModule,
    PrismaModule,
    RealtimeModule,
    SpaceModule,
    TargetModule,
  ],
  providers: [
    DocumentService,
    {
      provide: DOCUMENT_REPOSITORY,
      useClass: PrismaDocumentRepository,
    },
  ],
})
export class DocumentModule {}
