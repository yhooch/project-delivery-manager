export type DisplayCodePrefix = "REQ" | "INTAKE" | "TASK" | "BUG";

export type DisplayCodeSource = {
  displayCode?: null | string;
  id: string;
  status?: null | string;
};

export type WorkItemDisplayCodeSource = DisplayCodeSource & {
  type: "TASK" | "BUG";
};

type ResolveDisplayCodeOptions = {
  draftLabel?: string;
  prefix: DisplayCodePrefix;
};

const DISPLAY_CODE_PATTERN = /^(REQ|INTAKE|TASK|BUG)-([1-9]\d*)$/iu;
const DISPLAY_CODE_LIKE_PATTERN = /^(REQ|INTAKE|TASK|BUG)-/iu;

export function formatDisplayCode(prefix: string, id: string): string {
  return `${prefix}-${id.slice(-6).toUpperCase()}`;
}

export function resolveDisplayCode(
  source: DisplayCodeSource,
  { draftLabel = "DRAFT", prefix }: ResolveDisplayCodeOptions,
): string {
  const displayCode = source.displayCode?.trim();
  if (displayCode) {
    return displayCode;
  }

  if (prefix === "REQ" && source.status === "DRAFT") {
    return draftLabel;
  }

  return formatDisplayCode(prefix, source.id);
}

export function resolveRequirementDisplayCode(
  source: DisplayCodeSource,
  options: { draftLabel?: string } = {},
): string {
  return resolveDisplayCode(source, {
    draftLabel: options.draftLabel,
    prefix: "REQ",
  });
}

export function resolveIntakeDisplayCode(source: DisplayCodeSource): string {
  return resolveDisplayCode(source, { prefix: "INTAKE" });
}

export function resolveWorkItemDisplayCode(
  source: WorkItemDisplayCodeSource,
): string {
  return resolveDisplayCode(source, { prefix: source.type });
}

export function normalizeObjectDisplayCodeQuery(value: string): string | null {
  const match = DISPLAY_CODE_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  return `${match[1].toUpperCase()}-${match[2]}`;
}

export function isObjectDisplayCodeLike(value: string): boolean {
  return DISPLAY_CODE_LIKE_PATTERN.test(value.trim());
}
