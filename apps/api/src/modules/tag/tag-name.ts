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

export function normalizeTagNameInput(value: string): {
  displayName: string;
  name: string;
  normalizedName: string;
} {
  const withoutShortcut = stripLeadingShortcut(value);
  const name = collapseWhitespace(withoutShortcut.trim());
  const normalizedName = name.toLocaleLowerCase("en-US");

  return {
    displayName: `#${name}`,
    name,
    normalizedName,
  };
}

export function normalizeTagSearchQuery(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeTagNameInput(value).normalizedName;

  return normalized.length > 0 ? normalized : undefined;
}

export function colorKeyForNormalizedName(normalizedName: string): string {
  const hash = [...normalizedName].reduce(
    (current, character) =>
      Math.imul(current ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0,
    2166136261,
  );

  return TAG_COLOR_KEYS[hash % TAG_COLOR_KEYS.length];
}

function stripLeadingShortcut(value: string): string {
  const trimmed = value.trim();

  return trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ");
}
