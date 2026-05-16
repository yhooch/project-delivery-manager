import type { Priority, Requirement } from "@project-delivery/shared";

import {
  createContentEditorValue,
  type RequirementContentEditorValue,
} from "./requirement-editor-content";

export const LOCAL_DRAFT_CACHE_VERSION = 1;
export const LOCAL_DRAFT_CACHE_WRITE_DELAY_MS = 300;

const DRAFT_CACHE_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export type RequirementDraftCacheFormState = {
  content: RequirementContentEditorValue;
  ownerId: string;
  priority: Priority | "";
  summary: string;
  title: string;
  versionId: string;
};

export type RequirementDraftLocalCache = {
  cachedAt: string;
  form: RequirementDraftCacheFormState;
  requirementUpdatedAt: string;
  version: typeof LOCAL_DRAFT_CACHE_VERSION;
};

export type RequirementDraftLocalCacheSnapshot = {
  canEdit: boolean;
  form: RequirementDraftCacheFormState;
  key: string | null;
  requirement: Requirement | null;
};

export function createEmptyRequirementDraftCacheForm(): RequirementDraftCacheFormState {
  return {
    content: createContentEditorValue({}),
    ownerId: "",
    priority: "",
    summary: "",
    title: "",
    versionId: "",
  };
}

export function createRequirementDraftCacheForm(
  requirement: Requirement,
): RequirementDraftCacheFormState {
  return {
    content: createContentEditorValue({
      contentJson: requirement.contentJson,
      contentMarkdownCache: requirement.contentMarkdownCache,
      contentText: requirement.contentText,
    }),
    ownerId: requirement.ownerId ?? "",
    priority: requirement.priority ?? "",
    summary: requirement.summary ?? "",
    title: requirement.title,
    versionId: requirement.versionId ?? "",
  };
}

export function createRequirementDraftLocalCacheKey(input: {
  organizationId: string;
  requirementId: string;
  spaceId: string;
  userId: string;
}): string {
  return [
    "requirement",
    "draft",
    input.userId,
    input.organizationId,
    input.spaceId,
    input.requirementId,
  ].join(":");
}

export function resolveRequirementDraftCacheForm(
  requirement: Requirement,
  serverForm: RequirementDraftCacheFormState,
  userId: string | undefined,
): { form: RequirementDraftCacheFormState; restored: boolean } {
  if (
    !userId ||
    requirement.status !== "DRAFT" ||
    requirement.permissions?.canEdit !== true
  ) {
    return { form: serverForm, restored: false };
  }

  const cacheKey = createRequirementDraftLocalCacheKey({
    organizationId: requirement.organizationId,
    requirementId: requirement.id,
    spaceId: requirement.spaceId,
    userId,
  });
  const cached = readRequirementDraftLocalCache(cacheKey);

  if (!cached) {
    return { form: serverForm, restored: false };
  }

  if (!isRequirementDraftCacheNewerThanRequirement(cached, requirement)) {
    clearRequirementDraftLocalCache(cacheKey);
    return { form: serverForm, restored: false };
  }

  return { form: cached.form, restored: true };
}

export function persistRequirementDraftLocalCacheSnapshot(
  snapshot: RequirementDraftLocalCacheSnapshot,
) {
  const { canEdit, form, key, requirement } = snapshot;

  if (!key || !requirement || !canEdit || requirement.status !== "DRAFT") {
    return;
  }

  if (
    areRequirementDraftCacheFormsEqual(
      form,
      createRequirementDraftCacheForm(requirement),
    )
  ) {
    clearRequirementDraftLocalCache(key);
    return;
  }

  writeRequirementDraftLocalCache(key, {
    cachedAt: new Date().toISOString(),
    form,
    requirementUpdatedAt: requirement.updatedAt,
    version: LOCAL_DRAFT_CACHE_VERSION,
  });
}

export function readRequirementDraftLocalCache(
  key: string,
): RequirementDraftLocalCache | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(key);

    if (!raw) {
      return undefined;
    }

    return parseRequirementDraftLocalCache(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function writeRequirementDraftLocalCache(
  key: string,
  cache: RequirementDraftLocalCache,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // Best-effort browser cache; persistence failures should not block editing.
  }
}

export function clearRequirementDraftLocalCache(key: string | null) {
  if (!key || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup.
  }
}

export function parseRequirementDraftLocalCache(
  value: unknown,
): RequirementDraftLocalCache | undefined {
  if (!isPlainRecord(value) || value.version !== LOCAL_DRAFT_CACHE_VERSION) {
    return undefined;
  }

  if (
    typeof value.cachedAt !== "string" ||
    typeof value.requirementUpdatedAt !== "string" ||
    !isPlainRecord(value.form)
  ) {
    return undefined;
  }

  const form = parseRequirementDraftCacheForm(value.form);

  if (!form) {
    return undefined;
  }

  return {
    cachedAt: value.cachedAt,
    form,
    requirementUpdatedAt: value.requirementUpdatedAt,
    version: LOCAL_DRAFT_CACHE_VERSION,
  };
}

export function isRequirementDraftCacheNewerThanRequirement(
  cache: RequirementDraftLocalCache,
  requirement: Requirement,
): boolean {
  const cachedAt = Date.parse(cache.cachedAt);
  const updatedAt = Date.parse(requirement.updatedAt);

  if (!Number.isFinite(cachedAt)) {
    return false;
  }

  if (!Number.isFinite(updatedAt)) {
    return true;
  }

  return cachedAt > updatedAt;
}

function parseRequirementDraftCacheForm(
  value: Record<string, unknown>,
): RequirementDraftCacheFormState | undefined {
  if (
    typeof value.ownerId !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.title !== "string" ||
    typeof value.versionId !== "string"
  ) {
    return undefined;
  }

  const priority =
    typeof value.priority === "string" && isPriority(value.priority)
      ? value.priority
      : "";

  return {
    content: parseRequirementContentEditorValue(value.content),
    ownerId: value.ownerId,
    priority,
    summary: value.summary,
    title: value.title,
    versionId: value.versionId,
  };
}

function parseRequirementContentEditorValue(
  value: unknown,
): RequirementContentEditorValue {
  if (!isPlainRecord(value)) {
    return createContentEditorValue({});
  }

  return createContentEditorValue({
    contentJson: isPlainRecord(value.contentJson)
      ? value.contentJson
      : undefined,
    contentMarkdownCache:
      typeof value.contentMarkdownCache === "string"
        ? value.contentMarkdownCache
        : undefined,
    contentText:
      typeof value.contentText === "string" ? value.contentText : undefined,
  });
}

function areRequirementDraftCacheFormsEqual(
  left: RequirementDraftCacheFormState,
  right: RequirementDraftCacheFormState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPriority(value: string): value is Priority {
  return DRAFT_CACHE_PRIORITIES.includes(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
