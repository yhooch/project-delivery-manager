import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { IdentityModule } from "../identity/identity.module";
import {
  ORGANIZATION_REPOSITORY,
} from "./organization.repository";
import { AppSessionController } from "./app-session.controller";
import { AppSessionService } from "./app-session.service";
import { OrganizationController } from "./organization.controller";
import { OrganizationService } from "./organization.service";
import { PrismaOrganizationRepository } from "./prisma-organization.repository";

@Module({
  controllers: [AppSessionController, OrganizationController],
  exports: [AppSessionService, ORGANIZATION_REPOSITORY],
  imports: [AuditModule, AuthModule, IdentityModule, PrismaModule],
  providers: [
    AppSessionService,
    OrganizationService,
    {
      provide: ORGANIZATION_REPOSITORY,
      useClass: PrismaOrganizationRepository,
    },
  ],
})
export class OrganizationModule {}
