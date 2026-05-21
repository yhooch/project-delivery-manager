import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { ObjectCodeModule } from "../object-code/object-code.module";
import { OrganizationModule } from "../organization/organization.module";
import { SpaceModule } from "../space/space.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { PrismaWorkItemRepository } from "./prisma-workitem.repository";
import { WorkItemController } from "./workitem.controller";
import { WORK_ITEM_REPOSITORY } from "./workitem.repository";
import { WorkItemService } from "./workitem.service";

@Module({
  controllers: [WorkItemController],
  exports: [WORK_ITEM_REPOSITORY, WorkItemService],
  imports: [
    AuthModule,
    AuditModule,
    ObjectCodeModule,
    OrganizationModule,
    PrismaModule,
    SpaceModule,
    WorkflowModule,
  ],
  providers: [
    WorkItemService,
    {
      provide: WORK_ITEM_REPOSITORY,
      useClass: PrismaWorkItemRepository,
    },
  ],
})
export class WorkItemModule {}
