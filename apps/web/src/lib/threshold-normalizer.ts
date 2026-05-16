const MIN_THRESHOLD_DAYS = 1;
const MAX_THRESHOLD_DAYS = 30;

export function normalizeThresholdDays(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  const parsed =
    typeof value === "number" ? value : Number(String(value).trim());

  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_THRESHOLD_DAYS ||
    parsed > MAX_THRESHOLD_DAYS
  ) {
    return Number.NaN;
  }

  return parsed;
}

export function parseThresholdDays(value: string): number | null {
  if (!/^\d+$/u.test(value.trim())) {
    return null;
  }

  const parsed = normalizeThresholdDays(value);

  return typeof parsed === "number" && !Number.isNaN(parsed) ? parsed : null;
}
