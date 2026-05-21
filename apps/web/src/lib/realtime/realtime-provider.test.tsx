import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeEvent,
  RealtimeInvalidationKey,
  RealtimeSseEventName,
} from "@project-delivery/shared";

import {
  RealtimeProvider,
  createRealtimeEventsUrl,
  parseRealtimeSseMessage,
  useRealtimeInvalidation,
  type RealtimeEventSourceFactory,
  type RealtimeEventSourceLike,
  type RealtimeInvalidationCallback,
} from "./index";

const eventId = "01VRZ3NDEKTSV4RRFFQ69G5FAV";
const eventId2 = "01VRZ3NDEKTSV4RRFFQ69G5FAW";
const oldStreamId = "01VRZ3NDEKTSV4RRFFQ69G5FAY";
const newStreamId = "01VRZ3NDEKTSV4RRFFQ69G5FAZ";
const actorId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const organizationId = "01BRZ3NDEKTSV4RRFFQ69G5FAA";
const otherOrganizationId = "01CRZ3NDEKTSV4RRFFQ69G5FAB";
const spaceId = "01DRZ3NDEKTSV4RRFFQ69G5FAC";
const otherSpaceId = "01ERZ3NDEKTSV4RRFFQ69G5FAD";
const workItemId = "01GRZ3NDEKTSV4RRFFQ69G5FAG";
const occurredAt = "2026-05-21T10:30:00.000Z";

class FakeRealtimeEventSource implements RealtimeEventSourceLike {
  readonly close = vi.fn();
  readonly init: EventSourceInit;
  readonly listeners = new Map<
    RealtimeSseEventName | "error",
    Array<(event: Event | MessageEvent<string>) => void>
  >();
  readonly url: string;

  constructor(url: string, init: EventSourceInit) {
    this.url = url;
    this.init = init;
  }

  addEventListener(
    type: RealtimeSseEventName | "error",
    listener: (event: Event | MessageEvent<string>) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: RealtimeSseEventName, data: unknown, lastEventId = ""): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({
        data: JSON.stringify(data),
        lastEventId,
      } as MessageEvent<string>);
    }
  }
}

function createEventSourceFactory() {
  const sources: FakeRealtimeEventSource[] = [];
  const factory = vi.fn<RealtimeEventSourceFactory>((url, init) => {
    const source = new FakeRealtimeEventSource(url, init);
    sources.push(source);

    return source;
  });

  return { factory, sources };
}

function realtimeEventFixture(
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent {
  return {
    id: eventId,
    sequence: 42,
    occurredAt,
    actorId,
    organizationId,
    spaceId,
    target: {
      type: "WORK_ITEM",
      id: workItemId,
    },
    operation: "STATUS_CHANGED",
    invalidates: ["work-item-list"],
    hints: {
      targetId: workItemId,
      spaceId,
      workItemType: "TASK",
    },
    ...overrides,
  };
}

function Subscriber({
  keys,
  onInvalidate,
}: {
  keys: readonly RealtimeInvalidationKey[];
  onInvalidate: RealtimeInvalidationCallback;
}) {
  useRealtimeInvalidation(keys, onInvalidate);

  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("realtime frontend provider", () => {
  it("parses SSE JSON payloads with shared realtime schemas and ignores invalid messages", () => {
    const realtimeMessage = parseRealtimeSseMessage("realtime", {
      data: JSON.stringify(realtimeEventFixture()),
      lastEventId: "42",
    } as MessageEvent<string>);

    expect(realtimeMessage?.event).toBe("realtime");
    expect(
      realtimeMessage?.event === "realtime"
        ? realtimeMessage.message.data.invalidates
        : [],
    ).toEqual(["work-item-list"]);

    expect(
      parseRealtimeSseMessage("heartbeat", {
        data: JSON.stringify({ occurredAt }),
        lastEventId: "",
      } as MessageEvent<string>)?.event,
    ).toBe("heartbeat");

    expect(
      parseRealtimeSseMessage("realtime", {
        data: JSON.stringify(
          realtimeEventFixture({
            invalidates: ["unknown-key" as RealtimeInvalidationKey],
          }),
        ),
        lastEventId: "42",
      } as MessageEvent<string>),
    ).toBeNull();
    expect(
      parseRealtimeSseMessage("unknown", {
        data: "{}",
        lastEventId: "",
      } as MessageEvent<string>),
    ).toBeNull();
  });

  it("builds realtime events URLs with the last event cursor", () => {
    expect(createRealtimeEventsUrl(null)).toBe("/api/v1/realtime/events");
    expect(createRealtimeEventsUrl("42")).toBe(
      "/api/v1/realtime/events?lastEventId=42",
    );
  });

  it("connects only with organization context and reconnects when scope changes", () => {
    const { factory, sources } = createEventSourceFactory();
    const { rerender, unmount } = render(
      <RealtimeProvider eventSourceFactory={factory} organizationId={null}>
        <div />
      </RealtimeProvider>,
    );

    expect(factory).not.toHaveBeenCalled();

    rerender(
      <RealtimeProvider
        eventSourceFactory={factory}
        organizationId={organizationId}
        spaceId={spaceId}
      >
        <div />
      </RealtimeProvider>,
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenLastCalledWith("/api/v1/realtime/events", {
      withCredentials: true,
    });

    rerender(
      <RealtimeProvider
        eventSourceFactory={factory}
        organizationId={organizationId}
        spaceId="01ERZ3NDEKTSV4RRFFQ69G5FAD"
      >
        <div />
      </RealtimeProvider>,
    );

    expect(sources[0]?.close).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(2);

    unmount();

    expect(sources[1]?.close).toHaveBeenCalledTimes(1);
  });

  it("debounces, dedupes, and dispatches only matching invalidation keys", () => {
    const { factory, sources } = createEventSourceFactory();
    const listInvalidate = vi.fn<RealtimeInvalidationCallback>();
    const timelineInvalidate = vi.fn<RealtimeInvalidationCallback>();

    render(
      <RealtimeProvider
        debounceMs={25}
        eventSourceFactory={factory}
        organizationId={organizationId}
        spaceId={spaceId}
      >
        <Subscriber
          keys={["work-item-list", "comments"]}
          onInvalidate={listInvalidate}
        />
        <Subscriber keys={["timeline"]} onInvalidate={timelineInvalidate} />
      </RealtimeProvider>,
    );

    act(() => {
      sources[0]?.emit("heartbeat", { occurredAt });
      sources[0]?.emit("realtime", realtimeEventFixture(), "42");
      sources[0]?.emit(
        "realtime",
        realtimeEventFixture({
          id: eventId2,
          invalidates: ["timeline"],
          sequence: 43,
        }),
        "43",
      );
      sources[0]?.emit("realtime", realtimeEventFixture(), "42");
    });

    expect(listInvalidate).not.toHaveBeenCalled();
    expect(timelineInvalidate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(25);
    });

    expect(listInvalidate).toHaveBeenCalledTimes(1);
    expect(listInvalidate.mock.calls[0]?.[0]).toMatchObject({
      mode: "realtime",
      keys: ["work-item-list"],
      lastEventId: "43",
    });
    expect(listInvalidate.mock.calls[0]?.[0].events).toHaveLength(1);

    expect(timelineInvalidate).toHaveBeenCalledTimes(1);
    expect(timelineInvalidate.mock.calls[0]?.[0]).toMatchObject({
      keys: ["timeline"],
      lastEventId: "43",
    });
    expect(timelineInvalidate.mock.calls[0]?.[0].events).toHaveLength(1);
  });

  it("ignores realtime events and scoped resyncs outside the provider scope", () => {
    const { factory, sources } = createEventSourceFactory();
    const listInvalidate = vi.fn<RealtimeInvalidationCallback>();

    render(
      <RealtimeProvider
        debounceMs={25}
        eventSourceFactory={factory}
        organizationId={organizationId}
        spaceId={spaceId}
      >
        <Subscriber keys={["work-item-list"]} onInvalidate={listInvalidate} />
      </RealtimeProvider>,
    );

    act(() => {
      sources[0]?.emit(
        "realtime",
        realtimeEventFixture({
          id: eventId2,
          sequence: 43,
          spaceId: otherSpaceId,
        }),
        "43",
      );
      sources[0]?.emit(
        "realtime",
        realtimeEventFixture({
          id: "01VRZ3NDEKTSV4RRFFQ69G5FAX",
          organizationId: otherOrganizationId,
          sequence: 44,
        }),
        "44",
      );
      sources[0]?.emit("realtime-resync", {
        reason: "SEQUENCE_GAP",
        occurredAt,
        invalidates: [],
        scope: {
          organizationId,
          spaceId: otherSpaceId,
        },
      });
      vi.advanceTimersByTime(25);
    });

    expect(listInvalidate).not.toHaveBeenCalled();

    act(() => {
      sources[0]?.emit("realtime", realtimeEventFixture(), "42");
      vi.advanceTimersByTime(25);
    });

    expect(listInvalidate).toHaveBeenCalledTimes(1);
    expect(listInvalidate.mock.calls[0]?.[0].events).toHaveLength(1);
    expect(listInvalidate.mock.calls[0]?.[0].events[0]).toMatchObject({
      organizationId,
      spaceId,
    });
  });

  it("dispatches empty resync invalidations to all registered keys", () => {
    const { factory, sources } = createEventSourceFactory();
    const listInvalidate = vi.fn<RealtimeInvalidationCallback>();
    const timelineInvalidate = vi.fn<RealtimeInvalidationCallback>();

    render(
      <RealtimeProvider
        debounceMs={25}
        eventSourceFactory={factory}
        organizationId={organizationId}
        spaceId={spaceId}
      >
        <Subscriber
          keys={["work-item-list", "comments"]}
          onInvalidate={listInvalidate}
        />
        <Subscriber keys={["timeline"]} onInvalidate={timelineInvalidate} />
      </RealtimeProvider>,
    );

    act(() => {
      sources[0]?.emit("realtime-resync", {
        reason: "SEQUENCE_GAP",
        occurredAt,
        invalidates: [],
        scope: {
          organizationId,
          spaceId,
        },
      });
      vi.advanceTimersByTime(25);
    });

    expect(listInvalidate).toHaveBeenCalledTimes(1);
    expect(listInvalidate.mock.calls[0]?.[0]).toMatchObject({
      keys: ["work-item-list", "comments"],
      resyncs: [
        {
          reason: "SEQUENCE_GAP",
          invalidates: [],
        },
      ],
    });
    expect(timelineInvalidate).toHaveBeenCalledTimes(1);
    expect(timelineInvalidate.mock.calls[0]?.[0].keys).toEqual(["timeline"]);
  });

  it("clears sequence dedupe when a resync is received", () => {
    const { factory, sources } = createEventSourceFactory();
    const listInvalidate = vi.fn<RealtimeInvalidationCallback>();

    render(
      <RealtimeProvider
        debounceMs={25}
        eventSourceFactory={factory}
        organizationId={organizationId}
        spaceId={spaceId}
      >
        <Subscriber keys={["work-item-list"]} onInvalidate={listInvalidate} />
      </RealtimeProvider>,
    );

    act(() => {
      sources[0]?.emit(
        "realtime",
        realtimeEventFixture({ sequence: 1 }),
        `${oldStreamId}:1`,
      );
      vi.advanceTimersByTime(25);
    });

    expect(listInvalidate).toHaveBeenCalledTimes(1);

    act(() => {
      sources[0]?.emit("realtime-resync", {
        reason: "SERVER_RESTART",
        occurredAt,
        invalidates: [],
        scope: {
          organizationId,
          spaceId,
        },
      });
      sources[0]?.emit(
        "realtime",
        realtimeEventFixture({
          id: eventId2,
          sequence: 1,
        }),
        `${newStreamId}:1`,
      );
      vi.advanceTimersByTime(25);
    });

    expect(listInvalidate).toHaveBeenCalledTimes(2);
    expect(listInvalidate.mock.calls[1]?.[0]).toMatchObject({
      events: [expect.objectContaining({ id: eventId2, sequence: 1 })],
      resyncs: [expect.objectContaining({ reason: "SERVER_RESTART" })],
    });
  });
});
