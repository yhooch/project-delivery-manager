import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { TargetModule } from "../target/target.module";
import { PrismaTimelineRepository } from "./prisma-timeline.repository";
import { TimelineController } from "./timeline.controller";
import { TIMELINE_REPOSITORY } from "./timeline.repository";
import { TimelineService } from "./timeline.service";

@Module({
  controllers: [TimelineController],
  exports: [TIMELINE_REPOSITORY, TimelineService],
  imports: [AuthModule, PrismaModule, TargetModule],
  providers: [
    TimelineService,
    {
      provide: TIMELINE_REPOSITORY,
      useClass: PrismaTimelineRepository,
    },
  ],
})
export class TimelineModule {}
