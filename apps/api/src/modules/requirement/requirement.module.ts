import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { ObjectCodeModule } from "../object-code/object-code.module";
import { OrganizationModule } from "../organization/organization.module";
import { RealtimeModule } from "../realtime/realtime.module";
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
    AuditModule,
    ObjectCodeModule,
    OrganizationModule,
    PrismaModule,
    RealtimeModule,
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
