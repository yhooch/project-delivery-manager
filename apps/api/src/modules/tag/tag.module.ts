import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { SpaceModule } from "../space/space.module";
import { TargetModule } from "../target/target.module";
import { PrismaTagRepository } from "./prisma-tag.repository";
import { TagAssignmentService } from "./tag-assignment.service";
import { TagController } from "./tag.controller";
import { TAG_REPOSITORY } from "./tag.repository";
import { TagService } from "./tag.service";

@Module({
  controllers: [TagController],
  exports: [TAG_REPOSITORY, TagAssignmentService, TagService],
  imports: [AuthModule, AuditModule, PrismaModule, SpaceModule, TargetModule],
  providers: [
    TagAssignmentService,
    TagService,
    {
      provide: TAG_REPOSITORY,
      useClass: PrismaTagRepository,
    },
  ],
})
export class TagModule {}
