import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import {
  SESSION_REPOSITORY,
  USER_REPOSITORY,
} from "./identity.repository";
import {
  PrismaSessionRepository,
  PrismaUserRepository,
} from "./prisma-identity.repositories";
import { IdentityUserService } from "./identity-user.service";

@Module({
  exports: [IdentityUserService, USER_REPOSITORY, SESSION_REPOSITORY],
  imports: [PrismaModule],
  providers: [
    IdentityUserService,
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
    {
      provide: SESSION_REPOSITORY,
      useClass: PrismaSessionRepository,
    },
  ],
})
export class IdentityModule {}
