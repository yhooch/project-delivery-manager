"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type {
  RealtimeEvent,
  RealtimeInvalidationKey,
  RealtimeResyncEvent,
} from "@project-delivery/shared";

import {
  createRealtimeEventSourceClient,
  type RealtimeClientMessage,
  type RealtimeEventSourceFactory,
} from "./event-source-client";
import { createRealtimeInvalidationRegistry } from "./registry";
import type {
  RealtimeInvalidationCallback,
  RealtimeInvalidationContext,
  RealtimeInvalidationRegistry,
} from "./types";

const DEFAULT_DEBOUNCE_MS = 250;
const MAX_DEDUPED_EVENTS = 500;

type RealtimeContextValue = {
  subscribe: (
    keys: readonly RealtimeInvalidationKey[],
    callback: RealtimeInvalidationCallback,
  ) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

type PendingInvalidations = {
  events: RealtimeEvent[];
  resyncs: RealtimeResyncEvent[];
};

export type RealtimeProviderProps = {
  children: ReactNode;
  debounceMs?: number;
  enabled?: boolean;
  eventSourceFactory?: RealtimeEventSourceFactory;
  organizationId?: string | null;
  spaceId?: string | null;
};

export function RealtimeProvider({
  children,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  enabled = true,
  eventSourceFactory,
  organizationId,
  spaceId,
}: RealtimeProviderProps) {
  const registryRef = useRef<RealtimeInvalidationRegistry>(
    createRealtimeInvalidationRegistry(),
  );
  const pendingRef = useRef<PendingInvalidations>({
    events: [],
    resyncs: [],
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const seenEventIdsRef = useRef(new Set<string>());
  const seenSequencesRef = useRef(new Set<number>());
  const scopeKey = `${organizationId ?? ""}:${spaceId ?? ""}`;

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flushPending = useCallback(() => {
    clearPendingTimer();

    const pending = pendingRef.current;
    pendingRef.current = {
      events: [],
      resyncs: [],
    };

    const keys = collectInvalidationKeys(pending, registryRef.current);

    if (keys.length === 0) {
      return;
    }

    registryRef.current.dispatch({
      mode: "realtime",
      keys,
      events: pending.events,
      resyncs: pending.resyncs,
      lastEventId: lastEventIdRef.current,
    });
  }, [clearPendingTimer]);

  const scheduleFlush = useCallback(() => {
    clearPendingTimer();
    timerRef.current = setTimeout(flushPending, debounceMs);
  }, [clearPendingTimer, debounceMs, flushPending]);

  const handleMessage = useCallback(
    (message: RealtimeClientMessage) => {
      if (message.event === "heartbeat") {
        return;
      }

      if (message.event === "realtime") {
        const event = message.message.data;

        if (!realtimeEventMatchesScope(event, organizationId, spaceId)) {
          return;
        }

        if (
          seenEventIdsRef.current.has(event.id) ||
          seenSequencesRef.current.has(event.sequence)
        ) {
          return;
        }

        rememberDedupeValue(seenEventIdsRef.current, event.id);
        rememberDedupeValue(seenSequencesRef.current, event.sequence);
        lastEventIdRef.current = message.message.id;
        pendingRef.current.events.push(event);
        scheduleFlush();
        return;
      }

      const resync = message.message.data;

      if (!realtimeResyncMatchesScope(resync, organizationId, spaceId)) {
        return;
      }

      pendingRef.current.resyncs.push(resync);
      scheduleFlush();
    },
    [organizationId, scheduleFlush, spaceId],
  );

  useEffect(() => {
    lastEventIdRef.current = null;
    seenEventIdsRef.current.clear();
    seenSequencesRef.current.clear();
    pendingRef.current = {
      events: [],
      resyncs: [],
    };
    clearPendingTimer();
  }, [clearPendingTimer, scopeKey]);

  useEffect(() => {
    if (!enabled || !organizationId) {
      return;
    }

    const client = createRealtimeEventSourceClient({
      eventSourceFactory,
      lastEventId: lastEventIdRef.current,
      onMessage: handleMessage,
    });

    return () => {
      client?.close();
    };
  }, [enabled, eventSourceFactory, handleMessage, organizationId, scopeKey]);

  useEffect(() => clearPendingTimer, [clearPendingTimer]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      subscribe: (keys, callback) =>
        registryRef.current.subscribe(keys, callback),
    }),
    [],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeInvalidation(
  keys: readonly RealtimeInvalidationKey[],
  callback: RealtimeInvalidationCallback,
) {
  const context = useContext(RealtimeContext);
  const callbackRef = useRef(callback);
  const normalizedKeys = useMemo(() => [...new Set(keys)], [keys]);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!context || normalizedKeys.length === 0) {
      return;
    }

    return context.subscribe(normalizedKeys, (invalidationContext) =>
      callbackRef.current(invalidationContext),
    );
  }, [context, normalizedKeys]);
}

function collectInvalidationKeys(
  pending: PendingInvalidations,
  registry: RealtimeInvalidationRegistry,
): RealtimeInvalidationKey[] {
  const keys = new Set<RealtimeInvalidationKey>();
  let refreshAllRegisteredKeys = false;

  for (const event of pending.events) {
    for (const key of event.invalidates) {
      keys.add(key);
    }
  }

  for (const resync of pending.resyncs) {
    if (resync.invalidates.length === 0) {
      refreshAllRegisteredKeys = true;
      continue;
    }

    for (const key of resync.invalidates) {
      keys.add(key);
    }
  }

  if (refreshAllRegisteredKeys) {
    for (const key of registry.getRegisteredKeys()) {
      keys.add(key);
    }
  }

  return [...keys];
}

function realtimeEventMatchesScope(
  event: RealtimeEvent,
  organizationId: string | null | undefined,
  spaceId: string | null | undefined,
): boolean {
  if (organizationId && event.organizationId !== organizationId) {
    return false;
  }

  if (spaceId && event.spaceId !== spaceId) {
    return false;
  }

  return true;
}

function realtimeResyncMatchesScope(
  resync: RealtimeResyncEvent,
  organizationId: string | null | undefined,
  spaceId: string | null | undefined,
): boolean {
  if (
    organizationId &&
    resync.scope?.organizationId &&
    resync.scope.organizationId !== organizationId
  ) {
    return false;
  }

  if (spaceId && resync.scope?.spaceId && resync.scope.spaceId !== spaceId) {
    return false;
  }

  return true;
}

function rememberDedupeValue<T>(values: Set<T>, value: T): boolean {
  if (values.has(value)) {
    return false;
  }

  values.add(value);

  if (values.size > MAX_DEDUPED_EVENTS) {
    const oldestValue = values.values().next().value as T | undefined;

    if (oldestValue !== undefined) {
      values.delete(oldestValue);
    }
  }

  return true;
}

export type { RealtimeInvalidationContext };
