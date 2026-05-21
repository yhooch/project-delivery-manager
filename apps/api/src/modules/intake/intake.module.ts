import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { ObjectCodeModule } from "../object-code/object-code.module";
import { OrganizationModule } from "../organization/organization.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { RequirementModule } from "../requirement/requirement.module";
import { SpaceModule } from "../space/space.module";
import { VersionModule } from "../version/version.module";
import { WorkItemModule } from "../workitem/workitem.module";
import { INTAKE_REPOSITORY } from "./intake.repository";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";
import { PrismaIntakeRepository } from "./prisma-intake.repository";

@Module({
  controllers: [IntakeController],
  exports: [INTAKE_REPOSITORY],
  imports: [
    AuthModule,
    AuditModule,
    ObjectCodeModule,
    OrganizationModule,
    PrismaModule,
    RealtimeModule,
    RequirementModule,
    SpaceModule,
    VersionModule,
    WorkItemModule,
  ],
  providers: [
    IntakeService,
    {
      provide: INTAKE_REPOSITORY,
      useClass: PrismaIntakeRepository,
    },
  ],
})
export class IntakeModule {}
