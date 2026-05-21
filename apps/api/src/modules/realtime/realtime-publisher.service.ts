import { Inject, Injectable } from "@nestjs/common";
import {
  RealtimeEventSchema,
  type RealtimeEvent,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { RealtimeHubService } from "./realtime-hub.service";
import { RealtimeReplayBufferService } from "./realtime-replay-buffer.service";
import type { PublishRealtimeEventInput } from "./realtime.types";

@Injectable()
export class RealtimePublisherService {
  private sequence = 0;

  constructor(
    @Inject(RealtimeHubService)
    private readonly hub: RealtimeHubService,
    @Inject(RealtimeReplayBufferService)
    private readonly replayBuffer: RealtimeReplayBufferService,
  ) {}

  get currentSequence(): number {
    return this.sequence;
  }

  publish(input: PublishRealtimeEventInput): RealtimeEvent {
    const sequence = this.sequence + 1;
    const event = RealtimeEventSchema.parse({
      ...input,
      id: ulid(),
      occurredAt: new Date().toISOString(),
      sequence,
    });

    this.replayBuffer.append(event);
    this.sequence = sequence;
    this.hub.publish(event);

    return event;
  }
}
