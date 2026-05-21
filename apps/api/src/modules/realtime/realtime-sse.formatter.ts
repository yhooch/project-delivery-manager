import {
  RealtimeSseMessageSchema,
  type RealtimeEvent,
  type RealtimeHeartbeat,
  type RealtimeResyncEvent,
  type RealtimeResyncReason,
  type RealtimeResyncScope,
  type RealtimeSseMessage,
  type RealtimeSseRealtimeMessage,
} from "@project-delivery/shared";

export function createRealtimeSseMessage(
  event: RealtimeEvent,
): RealtimeSseRealtimeMessage {
  return {
    data: event,
    event: "realtime",
    id: String(event.sequence),
  };
}

export function createHeartbeatSseMessage(
  now: Date = new Date(),
): { data: RealtimeHeartbeat; event: "heartbeat" } {
  return {
    data: {
      occurredAt: now.toISOString(),
    },
    event: "heartbeat",
  };
}

export function createResyncSseMessage(
  reason: RealtimeResyncReason,
  scope?: RealtimeResyncScope,
  now: Date = new Date(),
): { data: RealtimeResyncEvent; event: "realtime-resync" } {
  return {
    data: {
      invalidates: [],
      occurredAt: now.toISOString(),
      reason,
      ...(scope ? { scope } : {}),
    },
    event: "realtime-resync",
  };
}

export function formatRealtimeSseMessage(message: RealtimeSseMessage): string {
  const parsed = RealtimeSseMessageSchema.parse(message);
  const lines = [`event: ${parsed.event}`];

  if ("id" in parsed) {
    lines.push(`id: ${parsed.id}`);
  }

  for (const line of JSON.stringify(parsed.data).split(/\r?\n/u)) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
}
