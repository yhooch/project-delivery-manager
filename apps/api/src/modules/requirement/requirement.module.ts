import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { OrganizationModule } from "../organization/organization.module";
import { SpaceModule } from "../space/space.module";
import { VersionModule } from "../version/version.module";
import { PrismaRequirementRepository } from "./prisma-requirement.repository";
import { RequirementController } from "./requirement.controller";
import { REQUIREMENT_REPOSITORY } from "./requirement.repository";
import { RequirementService } from "./requirement.service";

@Module({
  controllers: [RequirementController],
  exports: [REQUIREMENT_REPOSITORY],
  imports: [
    AuthModule,
    OrganizationModule,
    PrismaModule,
    SpaceModule,
    VersionModule,
  ],
  providers: [
    RequirementService,
    {
      provide: REQUIREMENT_REPOSITORY,
      useClass: PrismaRequirementRepository,
    },
  ],
})
export class RequirementModule {}
