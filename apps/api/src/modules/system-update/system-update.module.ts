import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthModule } from "../auth/auth.module";
import {
  createSystemUpdateClient,
  SYSTEM_UPDATE_CLIENT,
} from "./system-update.client";
import { SystemUpdateController } from "./system-update.controller";
import { SystemUpdateOperatorGuard } from "./system-update-operator.guard";
import { SystemUpdateOperatorService } from "./system-update-operator.service";
import { SystemUpdateService } from "./system-update.service";

@Module({
  controllers: [SystemUpdateController],
  exports: [SystemUpdateService],
  imports: [AuthModule],
  providers: [
    SystemUpdateOperatorGuard,
    SystemUpdateOperatorService,
    SystemUpdateService,
    {
      provide: SYSTEM_UPDATE_CLIENT,
      inject: [ConfigService],
      useFactory: createSystemUpdateClient,
    },
  ],
})
export class SystemUpdateModule {}
