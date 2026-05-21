import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import type {
  RealtimeConnection,
  RealtimeConnectionHandle,
  SubscribeRealtimeConnectionInput,
} from "./realtime.types";

@Injectable()
export class RealtimeConnectionRegistryService {
  private readonly connections = new Map<string, RealtimeConnection>();

  get size(): number {
    return this.connections.size;
  }

  register(
    input: SubscribeRealtimeConnectionInput,
  ): RealtimeConnectionHandle {
    const id = input.id ?? ulid();

    if (this.connections.has(id)) {
      throw new Error(`Realtime connection already exists: ${id}`);
    }

    const connection: RealtimeConnection = {
      connectedAt: new Date().toISOString(),
      id,
      listener: input.listener,
    };

    if (input.filter) {
      connection.filter = input.filter;
    }
    if (input.metadata) {
      connection.metadata = input.metadata;
    }

    this.connections.set(id, connection);

    return {
      id,
      unsubscribe: () => {
        this.unregister(id);
      },
    };
  }

  unregister(id: string): boolean {
    return this.connections.delete(id);
  }

  snapshot(): RealtimeConnection[] {
    return Array.from(this.connections.values());
  }
}
