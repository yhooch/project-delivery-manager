import {
  RealtimeInvalidationKeySchema,
  type RealtimeInvalidationKey,
} from "@project-delivery/shared";

import type {
  RealtimeInvalidationCallback,
  RealtimeInvalidationContext,
  RealtimeInvalidationRegistry,
} from "./types";

type Subscription = {
  callback: RealtimeInvalidationCallback;
  keys: Set<RealtimeInvalidationKey>;
};

export function createRealtimeInvalidationRegistry(): RealtimeInvalidationRegistry {
  let nextSubscriptionId = 0;
  const subscriptions = new Map<number, Subscription>();

  return {
    dispatch(context) {
      for (const subscription of subscriptions.values()) {
        const matchingKeys = context.keys.filter((key) =>
          subscription.keys.has(key),
        );

        if (matchingKeys.length === 0) {
          continue;
        }

        void subscription.callback(filterContextForKeys(context, matchingKeys));
      }
    },

    getRegisteredKeys() {
      const keys = new Set<RealtimeInvalidationKey>();

      for (const subscription of subscriptions.values()) {
        for (const key of subscription.keys) {
          keys.add(key);
        }
      }

      return [...keys];
    },

    subscribe(keys, callback) {
      const normalizedKeys = normalizeRealtimeInvalidationKeys(keys);

      if (normalizedKeys.length === 0) {
        return () => {};
      }

      const subscriptionId = nextSubscriptionId;
      nextSubscriptionId += 1;
      subscriptions.set(subscriptionId, {
        callback,
        keys: new Set(normalizedKeys),
      });

      return () => {
        subscriptions.delete(subscriptionId);
      };
    },
  };
}

function filterContextForKeys(
  context: RealtimeInvalidationContext,
  keys: RealtimeInvalidationKey[],
): RealtimeInvalidationContext {
  const keySet = new Set(keys);

  return {
    ...context,
    keys,
    events: context.events.filter((event) =>
      event.invalidates.some((key) => keySet.has(key)),
    ),
    resyncs: context.resyncs.filter(
      (resync) =>
        resync.invalidates.length === 0 ||
        resync.invalidates.some((key) => keySet.has(key)),
    ),
  };
}

export function normalizeRealtimeInvalidationKeys(
  keys: readonly string[],
): RealtimeInvalidationKey[] {
  const normalized = new Set<RealtimeInvalidationKey>();

  for (const key of keys) {
    const result = RealtimeInvalidationKeySchema.safeParse(key);

    if (result.success) {
      normalized.add(result.data);
    }
  }

  return [...normalized];
}
