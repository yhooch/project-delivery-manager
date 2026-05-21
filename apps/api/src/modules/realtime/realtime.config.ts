export const REALTIME_REPLAY_DEFAULT_TTL_SECONDS = 300;
export const REALTIME_REPLAY_DEFAULT_MAX_EVENTS = 1000;

export const REALTIME_REPLAY_OPTIONS = Symbol("REALTIME_REPLAY_OPTIONS");

export type RealtimeReplayOptions = {
  maxEvents: number;
  streamId?: string;
  ttlSeconds: number;
};

export function resolveRealtimeReplayOptions(
  env: NodeJS.ProcessEnv = process.env,
): RealtimeReplayOptions {
  return {
    maxEvents: readPositiveIntegerEnv(
      env.REALTIME_REPLAY_MAX_EVENTS,
      REALTIME_REPLAY_DEFAULT_MAX_EVENTS,
    ),
    ttlSeconds: readPositiveIntegerEnv(
      env.REALTIME_REPLAY_TTL_SECONDS,
      REALTIME_REPLAY_DEFAULT_TTL_SECONDS,
    ),
  };
}

function readPositiveIntegerEnv(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}
