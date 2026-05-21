import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { ObjectCodeModule } from "../object-code/object-code.module";
import { OrganizationModule } from "../organization/organization.module";
import { SpaceModule } from "../space/space.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { BugController } from "./bug.controller";
import { BUG_REPOSITORY } from "./bug.repository";
import { BugService } from "./bug.service";
import { PrismaBugRepository } from "./prisma-bug.repository";

@Module({
  controllers: [BugController],
  exports: [BUG_REPOSITORY, BugService],
  imports: [
    AuthModule,
    ObjectCodeModule,
    OrganizationModule,
    PrismaModule,
    SpaceModule,
    WorkflowModule,
  ],
  providers: [
    BugService,
    {
      provide: BUG_REPOSITORY,
      useClass: PrismaBugRepository,
    },
  ],
})
export class BugModule {}
