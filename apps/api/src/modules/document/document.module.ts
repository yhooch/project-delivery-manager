import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AttachmentModule } from "../attachment/attachment.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ObjectCodeModule } from "../object-code/object-code.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SpaceModule } from "../space/space.module";
import { TargetModule } from "../target/target.module";
import { DocumentFolderController } from "./document-folder.controller";
import { DOCUMENT_FOLDER_REPOSITORY } from "./document-folder.repository";
import { DocumentFolderService } from "./document-folder.service";
import { DocumentKindTransitionService } from "./document-kind-transition.service";
import { DocumentController } from "./document.controller";
import { DOCUMENT_REPOSITORY } from "./document.repository";
import { DocumentService } from "./document.service";
import { PrismaDocumentFolderRepository } from "./prisma-document-folder.repository";
import { PrismaDocumentRepository } from "./prisma-document.repository";

@Module({
  controllers: [DocumentController, DocumentFolderController],
  exports: [
    DOCUMENT_FOLDER_REPOSITORY,
    DOCUMENT_REPOSITORY,
    DocumentFolderService,
    DocumentKindTransitionService,
    DocumentService,
  ],
  imports: [
    AttachmentModule,
    AuthModule,
    AuditModule,
    ObjectCodeModule,
    PrismaModule,
    RealtimeModule,
    SpaceModule,
    TargetModule,
  ],
  providers: [
    DocumentFolderService,
    DocumentKindTransitionService,
    DocumentService,
    {
      provide: DOCUMENT_FOLDER_REPOSITORY,
      useClass: PrismaDocumentFolderRepository,
    },
    {
      provide: DOCUMENT_REPOSITORY,
      useClass: PrismaDocumentRepository,
    },
  ],
})
export class DocumentModule {}
