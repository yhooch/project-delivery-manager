import type { RealtimeSseMessage } from "@project-delivery/shared";

import { formatRealtimeSseMessage } from "./realtime-sse.formatter";

export const REALTIME_SSE_HEARTBEAT_INTERVAL_MS = 25_000;

export type RealtimeSseResponse = {
  destroyed?: boolean;
  end: () => void;
  flushHeaders?: () => void;
  getHeader?: (name: string) => number | string | string[] | undefined;
  on?: (event: "close" | "error", listener: () => void) => unknown;
  setHeader: (name: string, value: string) => void;
  writableEnded?: boolean;
  write: (chunk: string) => boolean;
};

export function prepareRealtimeSseResponse(response: RealtimeSseResponse): void {
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();
}

export function writeRealtimeSseMessage(
  response: RealtimeSseResponse,
  message: RealtimeSseMessage,
): boolean {
  if (response.destroyed || response.writableEnded) {
    return false;
  }

  return response.write(formatRealtimeSseMessage(message));
}

export function isRealtimeSseResponse(response: {
  getHeader?: (name: string) => number | string | string[] | undefined;
}): boolean {
  const contentType = response.getHeader?.("Content-Type");

  return headerIncludes(contentType, "text/event-stream");
}

function headerIncludes(
  value: number | string | string[] | undefined,
  expected: string,
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => headerIncludes(entry, expected));
  }

  return (
    typeof value === "string" &&
    value.toLowerCase().includes(expected.toLowerCase())
  );
}
