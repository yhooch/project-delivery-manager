import {
  RealtimeSseEventNameSchema,
  RealtimeSseHeartbeatMessageSchema,
  RealtimeSseRealtimeMessageSchema,
  RealtimeSseResyncMessageSchema,
  type RealtimeSseEventName,
  type RealtimeSseHeartbeatMessage,
  type RealtimeSseRealtimeMessage,
  type RealtimeSseResyncMessage,
} from "@project-delivery/shared";

import { createApiUrl } from "../api-client";

export type RealtimeClientMessage =
  | { event: "realtime"; message: RealtimeSseRealtimeMessage }
  | { event: "heartbeat"; message: RealtimeSseHeartbeatMessage }
  | { event: "realtime-resync"; message: RealtimeSseResyncMessage };

export type RealtimeEventSourceLike = {
  addEventListener: (
    type: RealtimeSseEventName | "error",
    listener: (event: Event | MessageEvent<string>) => void,
  ) => void;
  close: () => void;
};

export type RealtimeEventSourceFactory = (
  url: string,
  init: EventSourceInit,
) => RealtimeEventSourceLike;

export type RealtimeEventSourceClient = {
  close: () => void;
  url: string;
};

export type CreateRealtimeEventSourceClientOptions = {
  eventSourceFactory?: RealtimeEventSourceFactory;
  lastEventId?: string | null;
  onError?: (event: Event) => void;
  onMessage: (message: RealtimeClientMessage) => void;
};

export function createRealtimeEventSourceClient({
  eventSourceFactory,
  lastEventId,
  onError,
  onMessage,
}: CreateRealtimeEventSourceClientOptions): RealtimeEventSourceClient | null {
  const sourceFactory =
    eventSourceFactory ?? getDefaultRealtimeEventSourceFactory();

  if (!sourceFactory) {
    return null;
  }

  const url = createRealtimeEventsUrl(lastEventId);
  const source = sourceFactory(url, { withCredentials: true });

  source.addEventListener("realtime", (event) => {
    const message = parseRealtimeSseMessage("realtime", event);

    if (message) {
      onMessage(message);
    }
  });
  source.addEventListener("heartbeat", (event) => {
    const message = parseRealtimeSseMessage("heartbeat", event);

    if (message) {
      onMessage(message);
    }
  });
  source.addEventListener("realtime-resync", (event) => {
    const message = parseRealtimeSseMessage("realtime-resync", event);

    if (message) {
      onMessage(message);
    }
  });

  if (onError) {
    source.addEventListener("error", onError);
  }

  return {
    close: () => source.close(),
    url,
  };
}

export function createRealtimeEventsUrl(lastEventId?: string | null): string {
  return createApiUrl("/realtime/events", {
    lastEventId: lastEventId || undefined,
  });
}

export function parseRealtimeSseMessage(
  eventName: string,
  event: Event | MessageEvent<string>,
): RealtimeClientMessage | null {
  const eventNameResult = RealtimeSseEventNameSchema.safeParse(eventName);

  if (!eventNameResult.success || !isMessageEvent(event)) {
    return null;
  }

  const data = parseJson(event.data);

  if (data === null) {
    return null;
  }

  if (eventNameResult.data === "realtime") {
    const id = event.lastEventId || getSequenceCursor(data);

    if (!id) {
      return null;
    }

    const result = RealtimeSseRealtimeMessageSchema.safeParse({
      data,
      event: "realtime",
      id,
    });

    return result.success
      ? { event: "realtime", message: result.data }
      : null;
  }

  if (eventNameResult.data === "heartbeat") {
    const result = RealtimeSseHeartbeatMessageSchema.safeParse({
      data,
      event: "heartbeat",
    });

    return result.success
      ? { event: "heartbeat", message: result.data }
      : null;
  }

  const result = RealtimeSseResyncMessageSchema.safeParse({
    data,
    event: "realtime-resync",
  });

  return result.success
    ? { event: "realtime-resync", message: result.data }
    : null;
}

function getDefaultRealtimeEventSourceFactory():
  | RealtimeEventSourceFactory
  | undefined {
  if (typeof EventSource === "undefined") {
    return undefined;
  }

  return (url, init) => new EventSource(url, init);
}

function isMessageEvent(event: Event): event is MessageEvent<string> {
  return typeof (event as MessageEvent<string>).data === "string";
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function getSequenceCursor(data: unknown): string | null {
  if (
    typeof data !== "object" ||
    data === null ||
    !("sequence" in data) ||
    typeof data.sequence !== "number" ||
    !Number.isSafeInteger(data.sequence) ||
    data.sequence <= 0
  ) {
    return null;
  }

  return String(data.sequence);
}
