import {
  TagFilterQuerySchema,
  TagMatchSchema,
  type TagFilterQuery,
  type TagMatch,
} from "@project-delivery/shared";

export type TagFilterState = {
  tagIds: string[];
  tagMatch: TagMatch;
};

export const DEFAULT_TAG_MATCH: TagMatch = "ANY";

export function parseTagFilterQuery(
  input:
    | URLSearchParams
    | Record<string, string | string[] | null | undefined>,
): TagFilterState {
  const rawTagIds = getQueryValue(input, "tagIds");
  const rawTagMatch = getQueryValue(input, "tagMatch");
  const parsed = TagFilterQuerySchema.safeParse({
    tagIds: rawTagIds || undefined,
    tagMatch: rawTagMatch || undefined,
  });

  if (!parsed.success) {
    return {
      tagIds: [],
      tagMatch: parseTagMatch(rawTagMatch),
    };
  }

  return {
    tagIds: parsed.data.tagIds ? parsed.data.tagIds.split(",") : [],
    tagMatch: parsed.data.tagMatch,
  };
}

export function serializeTagFilterQuery(
  input: Partial<TagFilterState>,
): TagFilterQuery {
  const tagIds = dedupeTagIds(input.tagIds ?? []);
  const tagMatch = parseTagMatch(input.tagMatch);

  return TagFilterQuerySchema.parse({
    tagIds: tagIds.length > 0 ? tagIds.join(",") : undefined,
    tagMatch,
  });
}

export function toTagFilterSearchParams(
  input: Partial<TagFilterState>,
): URLSearchParams {
  const query = serializeTagFilterQuery(input);
  const searchParams = new URLSearchParams();

  if (query.tagIds) {
    searchParams.set("tagIds", query.tagIds);
    searchParams.set("tagMatch", query.tagMatch);
  }

  return searchParams;
}

export function buildTagFilterQueryString(
  input: Partial<TagFilterState>,
): string {
  const query = serializeTagFilterQuery(input);

  if (!query.tagIds) {
    return "";
  }

  const tagIds = query.tagIds.split(",").map(encodeURIComponent).join(",");

  return `tagIds=${tagIds}&tagMatch=${encodeURIComponent(query.tagMatch)}`;
}

export function normalizeTagFilterState(
  input: Partial<TagFilterState>,
): TagFilterState {
  return {
    tagIds: dedupeTagIds(input.tagIds ?? []),
    tagMatch: parseTagMatch(input.tagMatch),
  };
}

export function normalizeTagApiQuery<TQuery extends Record<string, unknown>>(
  query: TQuery,
): TQuery {
  if (!hasActiveTagIds(query.tagIds)) {
    const { tagIds: _tagIds, tagMatch: _tagMatch, ...rest } = query;

    return rest as TQuery;
  }

  if (query.tagMatch) {
    return query;
  }

  return {
    ...query,
    tagMatch: DEFAULT_TAG_MATCH,
  };
}

function parseTagMatch(value: unknown): TagMatch {
  const parsed = TagMatchSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_TAG_MATCH;
}

function dedupeTagIds(tagIds: readonly string[]) {
  return Array.from(new Set(tagIds.filter(Boolean)));
}

function hasActiveTagIds(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return typeof value === "string" && value.trim().length > 0;
}

function getQueryValue(
  input:
    | URLSearchParams
    | Record<string, string | string[] | null | undefined>,
  key: string,
) {
  if (input instanceof URLSearchParams) {
    return input.get(key) ?? undefined;
  }

  const value = input[key];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? undefined;
}
