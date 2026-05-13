import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { IdentityModule } from "../identity/identity.module";
import { OrganizationModule } from "../organization/organization.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { PrismaSpaceRepository } from "./prisma-space.repository";
import { SpaceController } from "./space.controller";
import { SPACE_REPOSITORY } from "./space.repository";
import { SpaceService } from "./space.service";

@Module({
  controllers: [SpaceController],
  exports: [SPACE_REPOSITORY],
  imports: [
    AuthModule,
    IdentityModule,
    OrganizationModule,
    PrismaModule,
    WorkflowModule,
  ],
  providers: [
    SpaceService,
    {
      provide: SPACE_REPOSITORY,
      useClass: PrismaSpaceRepository,
    },
  ],
})
export class SpaceModule {}
