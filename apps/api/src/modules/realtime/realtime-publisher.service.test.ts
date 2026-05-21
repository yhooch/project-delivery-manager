import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

import { RealtimeConnectionRegistryService } from "./realtime-connection-registry.service";
import { REALTIME_REPLAY_OPTIONS } from "./realtime.config";
import { RealtimeHubService } from "./realtime-hub.service";
import { RealtimePublisherService } from "./realtime-publisher.service";
import { RealtimeReplayBufferService } from "./realtime-replay-buffer.service";
import {
  REALTIME_ACTOR_ID,
  REALTIME_ORGANIZATION_ID,
  REALTIME_SPACE_ID,
  REALTIME_TARGET_ID,
} from "./realtime-test.fixtures";
import type { PublishRealtimeEventInput } from "./realtime.types";

describe("RealtimePublisherService", () => {
  it("generates event identity, sequence, timestamp and publishes to hub and replay buffer", () => {
    const { buffer, hub, publisher } = createSubject();
    const listener = vi.fn();
    hub.subscribe({ listener });

    const first = publisher.publish(createPublishInput());
    const second = publisher.publish(
      createPublishInput({ operation: "STATUS_CHANGED" }),
    );

    expect(first).toMatchObject({
      actorId: REALTIME_ACTOR_ID,
      operation: "UPDATED",
      sequence: 1,
    });
    expect(first.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(Number.isFinite(Date.parse(first.occurredAt))).toBe(true);
    expect(second.sequence).toBe(2);
    expect(listener).toHaveBeenNthCalledWith(1, first);
    expect(listener).toHaveBeenNthCalledWith(2, second);

    const replay = buffer.replayAfter(buffer.createCursor(1));
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.events).toEqual([second]);
    }
  });

  it("rejects payload hints that are not allowed by shared realtime schema", () => {
    const { buffer, hub, publisher } = createSubject();
    const listener = vi.fn();
    hub.subscribe({ listener });

    expect(() =>
      publisher.publish(
        createPublishInput({
          hints: {
            title: "业务标题不允许进入实时事件",
          },
        }),
      ),
    ).toThrow(/business content/u);

    expect(publisher.currentSequence).toBe(0);
    expect(buffer.snapshot()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("resolves its realtime dependencies through a Nest testing module", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: REALTIME_REPLAY_OPTIONS,
          useValue: {
            maxEvents: 1000,
            ttlSeconds: 300,
          },
        },
        RealtimeConnectionRegistryService,
        RealtimeHubService,
        RealtimePublisherService,
        RealtimeReplayBufferService,
      ],
    }).compile();

    try {
      const buffer = moduleRef.get(RealtimeReplayBufferService);
      const hub = moduleRef.get(RealtimeHubService);
      const publisher = moduleRef.get(RealtimePublisherService);
      const listener = vi.fn();

      hub.subscribe({ listener });
      const event = publisher.publish(createPublishInput());

      expect(buffer.snapshot()).toEqual([event]);
      expect(listener).toHaveBeenCalledWith(event);
    } finally {
      await moduleRef.close();
    }
  });
});

function createSubject() {
  const registry = new RealtimeConnectionRegistryService();
  const hub = new RealtimeHubService(registry);
  const buffer = new RealtimeReplayBufferService({
    maxEvents: 1000,
    ttlSeconds: 300,
  });
  const publisher = new RealtimePublisherService(hub, buffer);

  return { buffer, hub, publisher };
}

function createPublishInput(
  overrides: Partial<PublishRealtimeEventInput> = {},
): PublishRealtimeEventInput {
  return {
    actorId: REALTIME_ACTOR_ID,
    hints: {
      changedFields: ["statusId"],
      workItemId: REALTIME_TARGET_ID,
      workItemType: "TASK",
    },
    invalidates: ["work-item-list"],
    operation: "UPDATED",
    organizationId: REALTIME_ORGANIZATION_ID,
    spaceId: REALTIME_SPACE_ID,
    target: {
      id: REALTIME_TARGET_ID,
      type: "WORK_ITEM",
    },
    ...overrides,
  };
}
