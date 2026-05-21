import type { RealtimeEvent } from "@project-delivery/shared";

import type { RealtimeInvalidationContext } from "./types";

export type RefreshMode = "initial" | "manual" | "realtime";

export type RefreshModeOptions = {
  mode?: RefreshMode;
};

export function resolveRefreshMode(
  options?: RefreshModeOptions,
  fallback: RefreshMode = "manual",
): RefreshMode {
  return options?.mode ?? fallback;
}

export function isRealtimeRefreshMode(mode: RefreshMode): boolean {
  return mode === "realtime";
}

export function shouldClearDataForRefresh(mode: RefreshMode): boolean {
  return !isRealtimeRefreshMode(mode);
}

export function shouldShowBlockingRefreshState(mode: RefreshMode): boolean {
  return !isRealtimeRefreshMode(mode);
}

export function shouldSurfaceRefreshError(mode: RefreshMode): boolean {
  return !isRealtimeRefreshMode(mode);
}

export function realtimeContextIncludesTarget(
  context: RealtimeInvalidationContext,
  target: Pick<RealtimeEvent["target"], "id" | "type">,
): boolean {
  if (context.resyncs.length > 0) {
    return true;
  }

  return context.events.some(
    (event) =>
      (event.target.type === target.type && event.target.id === target.id) ||
      (event.hints?.targetType === target.type &&
        event.hints?.targetId === target.id),
  );
}
