import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { OrganizationModule } from "../organization/organization.module";
import { SpaceModule } from "../space/space.module";
import { ObjectCodeAllocator } from "./object-code.allocator";
import { ObjectCodeController } from "./object-code.controller";
import {
  OBJECT_CODE_REPOSITORY,
  PrismaObjectCodeRepository,
} from "./object-code.repository";
import { ObjectCodeService } from "./object-code.service";

@Module({
  controllers: [ObjectCodeController],
  exports: [ObjectCodeAllocator, ObjectCodeService],
  imports: [AuthModule, OrganizationModule, PrismaModule, SpaceModule],
  providers: [
    ObjectCodeAllocator,
    ObjectCodeService,
    {
      provide: OBJECT_CODE_REPOSITORY,
      useClass: PrismaObjectCodeRepository,
    },
  ],
})
export class ObjectCodeModule {}
