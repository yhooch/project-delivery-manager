import type {
  RealtimeEvent,
  RealtimeInvalidationKey,
  RealtimeResyncEvent,
} from "@project-delivery/shared";

export type RealtimeInvalidationMode = "realtime";

export type RealtimeInvalidationContext = {
  mode: RealtimeInvalidationMode;
  keys: RealtimeInvalidationKey[];
  events: RealtimeEvent[];
  resyncs: RealtimeResyncEvent[];
  lastEventId: string | null;
};

export type RealtimeInvalidationCallback = (
  context: RealtimeInvalidationContext,
) => void | Promise<void>;

export type RealtimeInvalidationRegistry = {
  dispatch: (context: RealtimeInvalidationContext) => void;
  getRegisteredKeys: () => RealtimeInvalidationKey[];
  subscribe: (
    keys: readonly RealtimeInvalidationKey[],
    callback: RealtimeInvalidationCallback,
  ) => () => void;
};
