import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  RealtimeEventSchema,
  type RealtimeEvent,
} from "@project-delivery/shared";

import { RealtimeConnectionRegistryService } from "./realtime-connection-registry.service";
import type {
  RealtimeConnectionHandle,
  SubscribeRealtimeConnectionInput,
} from "./realtime.types";

@Injectable()
export class RealtimeHubService {
  private readonly logger = new Logger(RealtimeHubService.name);

  constructor(
    @Inject(RealtimeConnectionRegistryService)
    private readonly connections: RealtimeConnectionRegistryService,
  ) {}

  subscribe(
    input: SubscribeRealtimeConnectionInput,
  ): RealtimeConnectionHandle {
    return this.connections.register(input);
  }

  unsubscribe(connectionId: string): boolean {
    return this.connections.unregister(connectionId);
  }

  publish(event: RealtimeEvent): void {
    const parsedEvent = RealtimeEventSchema.parse(event);

    for (const connection of this.connections.snapshot()) {
      try {
        if (connection.filter && !connection.filter(parsedEvent)) {
          continue;
        }

        const delivery = connection.listener(parsedEvent);

        if (delivery instanceof Promise) {
          void delivery.catch((error: unknown) => {
            this.logDeliveryFailure(connection.id, error);
          });
        }
      } catch (error) {
        this.logDeliveryFailure(connection.id, error);
      }
    }
  }

  private logDeliveryFailure(connectionId: string, error: unknown): void {
    this.logger.warn(
      `Realtime listener delivery failed: connectionId=${connectionId} error=${formatError(error)}`,
    );
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
