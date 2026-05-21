import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  RealtimeEventSchema,
  RealtimeSequenceCursorSchema,
  RealtimeSequenceSchema,
  type RealtimeEvent,
  type RealtimeResyncReason,
} from "@project-delivery/shared";

import {
  REALTIME_REPLAY_DEFAULT_MAX_EVENTS,
  REALTIME_REPLAY_DEFAULT_TTL_SECONDS,
  REALTIME_REPLAY_OPTIONS,
  type RealtimeReplayOptions,
} from "./realtime.config";
import type {
  RealtimeReplayCursor,
  RealtimeReplayResult,
} from "./realtime.types";

@Injectable()
export class RealtimeReplayBufferService {
  private readonly events: RealtimeEvent[] = [];
  private readonly maxEvents: number;
  private readonly ttlMs: number;
  private evictedThroughSequence = 0;
  private expiredThroughSequence = 0;
  private latestSequence = 0;

  constructor(
    @Optional()
    @Inject(REALTIME_REPLAY_OPTIONS)
    options?: Partial<RealtimeReplayOptions>,
  ) {
    this.maxEvents = normalizePositiveInteger(
      options?.maxEvents,
      REALTIME_REPLAY_DEFAULT_MAX_EVENTS,
    );
    this.ttlMs =
      normalizePositiveInteger(
        options?.ttlSeconds,
        REALTIME_REPLAY_DEFAULT_TTL_SECONDS,
      ) * 1000;
  }

  get currentSequence(): number {
    return this.latestSequence;
  }

  append(event: RealtimeEvent, now: Date = new Date()): RealtimeEvent {
    const parsedEvent = RealtimeEventSchema.parse(event);

    if (parsedEvent.sequence <= this.latestSequence) {
      throw new Error(
        `Realtime sequence must increase: current=${this.latestSequence} received=${parsedEvent.sequence}`,
      );
    }

    this.latestSequence = parsedEvent.sequence;
    this.events.push(parsedEvent);
    this.prune(now);

    return parsedEvent;
  }

  replayAfter(
    cursor?: RealtimeReplayCursor,
    now: Date = new Date(),
  ): RealtimeReplayResult {
    this.prune(now);

    if (cursor === undefined) {
      return this.success([]);
    }

    const cursorSequence = this.parseCursor(cursor);

    if (cursorSequence > BigInt(this.latestSequence)) {
      return this.resync("SERVER_RESTART");
    }

    const lastSeenSequence = Number(cursorSequence);

    if (lastSeenSequence === this.latestSequence) {
      return this.success([]);
    }

    const expectedNextSequence = lastSeenSequence + 1;

    if (this.events.length === 0) {
      return this.resync(
        this.resolveUnavailableReason(expectedNextSequence),
      );
    }

    const firstReplayIndex = this.events.findIndex(
      (event) => event.sequence > lastSeenSequence,
    );

    if (firstReplayIndex === -1) {
      return this.success([]);
    }

    const firstReplayEvent = this.events[firstReplayIndex];

    if (firstReplayEvent.sequence !== expectedNextSequence) {
      return this.resync(
        this.resolveUnavailableReason(expectedNextSequence),
      );
    }

    const replayEvents = this.events.slice(firstReplayIndex);
    const gapReason = this.resolveReplayGap(replayEvents);

    if (gapReason) {
      return this.resync(gapReason);
    }

    return this.success(replayEvents);
  }

  snapshot(): RealtimeEvent[] {
    this.prune();
    return [...this.events];
  }

  private parseCursor(cursor: RealtimeReplayCursor): bigint {
    if (typeof cursor === "string") {
      return BigInt(RealtimeSequenceCursorSchema.parse(cursor));
    }

    return BigInt(RealtimeSequenceSchema.parse(cursor));
  }

  private prune(now: Date = new Date()): void {
    const cutoffMs = now.getTime() - this.ttlMs;
    let expiredThrough = 0;

    while (
      this.events.length > 0 &&
      getEventTimestampMs(this.events[0]) < cutoffMs
    ) {
      expiredThrough = this.events.shift()?.sequence ?? expiredThrough;
    }

    if (expiredThrough > 0) {
      this.expiredThroughSequence = Math.max(
        this.expiredThroughSequence,
        expiredThrough,
      );
    }

    let evictedThrough = 0;

    while (this.events.length > this.maxEvents) {
      evictedThrough = this.events.shift()?.sequence ?? evictedThrough;
    }

    if (evictedThrough > 0) {
      this.evictedThroughSequence = Math.max(
        this.evictedThroughSequence,
        evictedThrough,
      );
    }
  }

  private resolveUnavailableReason(
    expectedSequence: number,
  ): RealtimeResyncReason {
    if (expectedSequence <= this.expiredThroughSequence) {
      return "REPLAY_EXPIRED";
    }

    if (expectedSequence <= this.evictedThroughSequence) {
      return "REPLAY_MISS";
    }

    return "SEQUENCE_GAP";
  }

  private resolveReplayGap(
    replayEvents: RealtimeEvent[],
  ): RealtimeResyncReason | undefined {
    for (let index = 1; index < replayEvents.length; index += 1) {
      if (
        replayEvents[index].sequence !==
        replayEvents[index - 1].sequence + 1
      ) {
        return "SEQUENCE_GAP";
      }
    }

    return undefined;
  }

  private success(events: RealtimeEvent[]): RealtimeReplayResult {
    return {
      currentSequence: this.latestSequence,
      events,
      ok: true,
    };
  }

  private resync(reason: RealtimeResyncReason): RealtimeReplayResult {
    return {
      currentSequence: this.latestSequence,
      ok: false,
      reason,
    };
  }
}

function normalizePositiveInteger(
  value: number | undefined,
  defaultValue: number,
): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : defaultValue;
}

function getEventTimestampMs(event: RealtimeEvent): number {
  const timestamp = Date.parse(event.occurredAt);

  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}
