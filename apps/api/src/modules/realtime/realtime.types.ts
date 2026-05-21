import type {
  RealtimeEvent,
  RealtimeResyncReason,
  RealtimeSequence,
  RealtimeSequenceCursor,
} from "@project-delivery/shared";

export type PublishRealtimeEventInput = Omit<
  RealtimeEvent,
  "id" | "occurredAt" | "sequence"
>;

export type RealtimeEventListener = (
  event: RealtimeEvent,
) => Promise<void> | void;

export type RealtimeEventFilter = (event: RealtimeEvent) => boolean;

export type SubscribeRealtimeConnectionInput = {
  filter?: RealtimeEventFilter;
  id?: string;
  listener: RealtimeEventListener;
  metadata?: Record<string, unknown>;
};

export type RealtimeConnection = {
  connectedAt: string;
  filter?: RealtimeEventFilter;
  id: string;
  listener: RealtimeEventListener;
  metadata?: Record<string, unknown>;
};

export type RealtimeConnectionHandle = {
  id: string;
  unsubscribe: () => void;
};

export type RealtimeReplayCursor = RealtimeSequence | RealtimeSequenceCursor;

export type RealtimeReplayResult =
  | {
      currentSequence: number;
      events: RealtimeEvent[];
      ok: true;
    }
  | {
      currentSequence: number;
      ok: false;
      reason: RealtimeResyncReason;
    };
