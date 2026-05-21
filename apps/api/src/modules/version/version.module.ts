import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { OrganizationModule } from "../organization/organization.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SpaceModule } from "../space/space.module";
import { PrismaVersionRepository } from "./prisma-version.repository";
import { VersionController } from "./version.controller";
import { VERSION_REPOSITORY } from "./version.repository";
import { VersionService } from "./version.service";

@Module({
  controllers: [VersionController],
  exports: [VERSION_REPOSITORY],
  imports: [
    AuthModule,
    AuditModule,
    OrganizationModule,
    PrismaModule,
    RealtimeModule,
    SpaceModule,
  ],
  providers: [
    VersionService,
    {
      provide: VERSION_REPOSITORY,
      useClass: PrismaVersionRepository,
    },
  ],
})
export class VersionModule {}
