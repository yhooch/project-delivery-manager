import { describe, expect, it } from "vitest";

import { RealtimeReplayBufferService } from "./realtime-replay-buffer.service";
import { createRealtimeEventFixture } from "./realtime-test.fixtures";

const REPLAY_TEST_NOW = new Date("2026-05-21T12:00:30.000Z");
const REPLAY_STREAM_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAV";
const OTHER_REPLAY_STREAM_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAW";

describe("RealtimeReplayBufferService", () => {
  it("returns events after the Last-Event-ID sequence cursor", () => {
    const buffer = createBuffer();
    const first = createReplayableEventFixture(1);
    const second = createReplayableEventFixture(2);
    const third = createReplayableEventFixture(3);

    buffer.append(first, REPLAY_TEST_NOW);
    buffer.append(second, REPLAY_TEST_NOW);
    buffer.append(third, REPLAY_TEST_NOW);

    const replay = buffer.replayAfter(buffer.createCursor(1), REPLAY_TEST_NOW);

    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.currentSequence).toBe(3);
      expect(replay.events).toEqual([second, third]);
    }

    expect(buffer.replayAfter(buffer.createCursor(3), REPLAY_TEST_NOW)).toEqual(
      {
        currentSequence: 3,
        events: [],
        ok: true,
      },
    );
    expect(buffer.replayAfter(undefined, REPLAY_TEST_NOW)).toEqual({
      currentSequence: 3,
      events: [],
      ok: true,
    });
  });

  it("returns REPLAY_MISS when max buffer size removed a required event", () => {
    const buffer = createBuffer({ maxEvents: 2 });

    buffer.append(createReplayableEventFixture(1), REPLAY_TEST_NOW);
    buffer.append(createReplayableEventFixture(2), REPLAY_TEST_NOW);
    buffer.append(createReplayableEventFixture(3), REPLAY_TEST_NOW);
    buffer.append(createReplayableEventFixture(4), REPLAY_TEST_NOW);

    expect(buffer.replayAfter(buffer.createCursor(1), REPLAY_TEST_NOW)).toEqual(
      {
        currentSequence: 4,
        ok: false,
        reason: "REPLAY_MISS",
      },
    );
  });

  it("returns REPLAY_EXPIRED when TTL removed a required event", () => {
    const now = new Date("2026-05-21T12:00:30.000Z");
    const buffer = createBuffer({ ttlSeconds: 10 });

    buffer.append(
      createRealtimeEventFixture(1, {
        occurredAt: "2026-05-21T12:00:01.000Z",
      }),
      now,
    );
    buffer.append(
      createRealtimeEventFixture(2, {
        occurredAt: "2026-05-21T12:00:05.000Z",
      }),
      now,
    );
    buffer.append(
      createRealtimeEventFixture(3, {
        occurredAt: "2026-05-21T12:00:30.000Z",
      }),
      now,
    );

    expect(buffer.replayAfter(buffer.createCursor(1), now)).toEqual({
      currentSequence: 3,
      ok: false,
      reason: "REPLAY_EXPIRED",
    });
  });

  it("returns REPLAY_EXPIRED when TTL removed the whole replay cache", () => {
    const appendAt = new Date("2026-05-21T12:00:05.000Z");
    const replayAt = new Date("2026-05-21T12:00:30.000Z");
    const buffer = createBuffer({ ttlSeconds: 10 });

    buffer.append(
      createRealtimeEventFixture(1, {
        occurredAt: "2026-05-21T12:00:01.000Z",
      }),
      appendAt,
    );
    buffer.append(
      createRealtimeEventFixture(2, {
        occurredAt: "2026-05-21T12:00:05.000Z",
      }),
      appendAt,
    );

    expect(buffer.replayAfter(buffer.createCursor(1), replayAt)).toEqual({
      currentSequence: 2,
      ok: false,
      reason: "REPLAY_EXPIRED",
    });
  });

  it("returns SEQUENCE_GAP when the next sequence is not available and no eviction explains it", () => {
    const buffer = createBuffer();

    buffer.append(createReplayableEventFixture(1), REPLAY_TEST_NOW);
    buffer.append(createReplayableEventFixture(3), REPLAY_TEST_NOW);

    expect(buffer.replayAfter(buffer.createCursor(1), REPLAY_TEST_NOW)).toEqual(
      {
        currentSequence: 3,
        ok: false,
        reason: "SEQUENCE_GAP",
      },
    );
  });

  it("returns SERVER_RESTART for stale stream cursors, legacy cursors, and cursors beyond current sequence", () => {
    const emptyBuffer = createBuffer();

    expect(emptyBuffer.replayAfter("9", REPLAY_TEST_NOW)).toEqual({
      currentSequence: 0,
      ok: false,
      reason: "SERVER_RESTART",
    });

    const buffer = createBuffer();
    buffer.append(createReplayableEventFixture(1), REPLAY_TEST_NOW);

    expect(buffer.replayAfter(buffer.createCursor(2), REPLAY_TEST_NOW)).toEqual(
      {
        currentSequence: 1,
        ok: false,
        reason: "SERVER_RESTART",
      },
    );
    expect(
      buffer.replayAfter(`${OTHER_REPLAY_STREAM_ID}:1`, REPLAY_TEST_NOW),
    ).toEqual({
      currentSequence: 1,
      ok: false,
      reason: "SERVER_RESTART",
    });
    expect(buffer.replayAfter("1", REPLAY_TEST_NOW)).toEqual({
      currentSequence: 1,
      ok: false,
      reason: "SERVER_RESTART",
    });
  });
});

function createBuffer(
  options: { maxEvents?: number; ttlSeconds?: number } = {},
): RealtimeReplayBufferService {
  return new RealtimeReplayBufferService({
    maxEvents: options.maxEvents ?? 1000,
    streamId: REPLAY_STREAM_ID,
    ttlSeconds: options.ttlSeconds ?? 300,
  });
}

function createReplayableEventFixture(sequence: number) {
  return createRealtimeEventFixture(sequence, {
    occurredAt: REPLAY_TEST_NOW.toISOString(),
  });
}
