const MIN_THRESHOLD_DAYS = 1;
const MAX_THRESHOLD_DAYS = 30;

export function parseThresholdDays(value: string): number | null {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);

  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_THRESHOLD_DAYS ||
    parsed > MAX_THRESHOLD_DAYS
  ) {
    return null;
  }

  return parsed;
}
