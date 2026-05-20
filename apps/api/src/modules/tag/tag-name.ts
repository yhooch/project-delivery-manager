export {
  normalizeTagNameInput,
  normalizeTagSearchQuery,
} from "@project-delivery/shared";

const TAG_COLOR_KEYS = [
  "blue",
  "green",
  "purple",
  "orange",
  "pink",
  "teal",
  "red",
  "yellow",
  "cyan",
  "gray",
] as const;

export function colorKeyForNormalizedName(normalizedName: string): string {
  const hash = [...normalizedName].reduce(
    (current, character) =>
      Math.imul(current ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0,
    2166136261,
  );

  return TAG_COLOR_KEYS[hash % TAG_COLOR_KEYS.length];
}
