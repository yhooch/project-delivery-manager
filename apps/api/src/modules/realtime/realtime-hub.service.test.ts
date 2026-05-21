import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { RealtimeConnectionRegistryService } from "./realtime-connection-registry.service";
import { RealtimeHubService } from "./realtime-hub.service";
import {
  REALTIME_SPACE_ID,
  createRealtimeEventFixture,
} from "./realtime-test.fixtures";

describe("RealtimeHubService", () => {
  it("subscribes, filters, and unsubscribes listener connections", () => {
    const registry = new RealtimeConnectionRegistryService();
    const hub = new RealtimeHubService(registry);
    const listener = vi.fn();
    const event = createRealtimeEventFixture(1);
    const otherSpaceEvent = createRealtimeEventFixture(2, {
      spaceId: "01H00000000000000000000005",
    });

    const handle = hub.subscribe({
      filter: (candidate) => candidate.spaceId === REALTIME_SPACE_ID,
      listener,
    });

    hub.publish(otherSpaceEvent);
    hub.publish(event);
    handle.unsubscribe();
    hub.publish(createRealtimeEventFixture(3));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
    expect(registry.size).toBe(0);
  });

  it("continues delivery when one listener fails", () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const registry = new RealtimeConnectionRegistryService();
    const hub = new RealtimeHubService(registry);
    const listener = vi.fn();
    const event = createRealtimeEventFixture(1);

    hub.subscribe({
      id: "throwing-listener",
      listener: () => {
        throw new Error("listener failed");
      },
    });
    hub.subscribe({ id: "healthy-listener", listener });

    hub.publish(event);

    expect(listener).toHaveBeenCalledWith(event);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("connectionId=throwing-listener"),
    );

    warn.mockRestore();
  });
});
