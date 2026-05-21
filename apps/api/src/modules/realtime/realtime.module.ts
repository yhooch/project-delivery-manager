import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { RequireSessionGuard } from "../auth/session.guard";
import {
  REALTIME_REPLAY_OPTIONS,
  resolveRealtimeReplayOptions,
} from "./realtime.config";
import { RealtimeConnectionRegistryService } from "./realtime-connection-registry.service";
import { RealtimeHubService } from "./realtime-hub.service";
import { RealtimePermissionService } from "./realtime-permission.service";
import { RealtimePublisherService } from "./realtime-publisher.service";
import { RealtimeReplayBufferService } from "./realtime-replay-buffer.service";
import { RealtimeSseController } from "./realtime-sse.controller";

@Module({
  controllers: [RealtimeSseController],
  exports: [
    RealtimeConnectionRegistryService,
    RealtimeHubService,
    RealtimePermissionService,
    RealtimePublisherService,
    RealtimeReplayBufferService,
  ],
  imports: [PrismaModule],
  providers: [
    {
      provide: REALTIME_REPLAY_OPTIONS,
      useFactory: resolveRealtimeReplayOptions,
    },
    RealtimeConnectionRegistryService,
    RealtimeHubService,
    RealtimePermissionService,
    RealtimePublisherService,
    RealtimeReplayBufferService,
    RequireSessionGuard,
  ],
})
export class RealtimeModule {}
