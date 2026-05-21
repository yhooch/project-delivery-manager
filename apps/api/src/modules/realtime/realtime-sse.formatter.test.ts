import { describe, expect, it } from "vitest";

import { createRealtimeEventFixture } from "./realtime-test.fixtures";
import {
  createHeartbeatSseMessage,
  createRealtimeSseMessage,
  createResyncSseMessage,
  formatRealtimeSseMessage,
} from "./realtime-sse.formatter";

describe("realtime SSE formatter", () => {
  it("formats realtime events with event name, sequence id, JSON data and blank terminator", () => {
    const event = createRealtimeEventFixture(7);
    const formatted = formatRealtimeSseMessage(createRealtimeSseMessage(event));

    expect(formatted).toContain("event: realtime\nid: 7\ndata: {");
    expect(formatted).toContain(`"id":"${event.id}"`);
    expect(formatted).toContain('"sequence":7');
    expect(formatted).toContain('"target":{"type":"WORK_ITEM"');
    expect(formatted.endsWith("\n\n")).toBe(true);
  });

  it("formats heartbeat and resync control events without a stream id", () => {
    const heartbeat = createHeartbeatSseMessage(
      new Date("2026-05-21T12:34:56.000Z"),
    );
    const resync = createResyncSseMessage(
      "REPLAY_MISS",
      { organizationId: "01H00000000000000000000002" },
      new Date("2026-05-21T12:35:00.000Z"),
    );

    expect(formatRealtimeSseMessage(heartbeat)).toBe(
      `event: heartbeat\ndata: ${JSON.stringify(heartbeat.data)}\n\n`,
    );

    const formattedResync = formatRealtimeSseMessage(resync);
    expect(formattedResync).toContain("event: realtime-resync\ndata: {");
    expect(formattedResync).toContain('"reason":"REPLAY_MISS"');
    expect(formattedResync).toContain('"invalidates":[]');
    expect(formattedResync).toContain(
      '"scope":{"organizationId":"01H00000000000000000000002"}',
    );
    expect(formattedResync.endsWith("\n\n")).toBe(true);
  });
});
