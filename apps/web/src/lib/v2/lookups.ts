"use client";

import type {
  SpaceMemberWithUser,
  Version,
  WorkflowState,
  WorkflowVersion,
} from "@project-delivery/shared";
import { useEffect, useState } from "react";

import { getIntakeItem } from "../intake-service";
import { getRequirement } from "../requirement-service";
import { listSpaceMembers } from "../space-service";
import { listVersions } from "../version-service";
import { getWorkflowVersion } from "../workflow-service";
import { getWorkItem } from "../work-item-service";

// ----------------------------------------------------------------------
// Module-level caches keyed by `${organizationId}:${spaceId}` and `${spaceId}`.
// 这些缓存是会话级、纯内存的；切换组织或空间后旧条目自然不会被命中。
// 任何 hook/纯函数共享同一份缓存，避免重复请求。
// ----------------------------------------------------------------------

const memberCache = new Map<string, SpaceMemberWithUser[]>();
const versionCache = new Map<string, Version[]>();
const relationTitleCache = new Map<string, string | undefined>();
const workflowVersionCache = new Map<string, WorkflowVersion>();

const memberInflight = new Map<string, Promise<SpaceMemberWithUser[]>>();
const versionInflight = new Map<string, Promise<Version[]>>();
const relationTitleInflight = new Map<string, Promise<string | undefined>>();
const workflowVersionInflight = new Map<string, Promise<WorkflowVersion>>();

function memberKey(spaceId: string, organizationId?: string): string {
  return `${organizationId ?? ""}:${spaceId}`;
}

function versionKey(spaceId: string, organizationId?: string): string {
  return `${organizationId ?? ""}:${spaceId}`;
}

function relationTitleKey(
  type: RelationTitleType,
  id: string,
  spaceId?: string,
  organizationId?: string,
): string {
  return `${organizationId ?? ""}:${spaceId ?? ""}:${type}:${id}`;
}

function workflowVersionKey(
  workflowVersionId: string,
  spaceId?: string,
  organizationId?: string,
): string {
  return `${organizationId ?? ""}:${spaceId ?? ""}:${workflowVersionId}`;
}

async function fetchMembers(
  spaceId: string,
): Promise<SpaceMemberWithUser[]> {
  const result = await listSpaceMembers(spaceId);
  return result.items;
}

async function fetchVersions(
  spaceId: string,
  organizationId?: string,
): Promise<Version[]> {
  const result = await listVersions({ organizationId, spaceId });
  return result.items;
}

async function fetchRelationTitle({
  id,
  organizationId,
  spaceId,
  type,
}: {
  id: string;
  organizationId?: string;
  spaceId?: string;
  type: RelationTitleType;
}): Promise<string | undefined> {
  if (type === "requirement") {
    const requirement = await getRequirement({
      organizationId,
      requirementId: id,
      spaceId,
    });
    return normalizeTitle(requirement.title);
  }

  if (type === "intake") {
    const intakeItem = await getIntakeItem({
      intakeItemId: id,
      organizationId,
      spaceId,
    });
    return normalizeTitle(intakeItem.title);
  }

  const workItem = await getWorkItem({
    organizationId,
    spaceId,
    workItemId: id,
  });
  return normalizeTitle(workItem.title);
}

function normalizeTitle(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function getMembers(
  spaceId: string,
  organizationId?: string,
): Promise<SpaceMemberWithUser[]> {
  const key = memberKey(spaceId, organizationId);
  const cached = memberCache.get(key);

  if (cached) {
    return cached;
  }

  const inflight = memberInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = fetchMembers(spaceId)
    .then((members) => {
      memberCache.set(key, members);
      return members;
    })
    .finally(() => {
      memberInflight.delete(key);
    });

  memberInflight.set(key, promise);
  return promise;
}

export async function getVersions(
  spaceId: string,
  organizationId?: string,
): Promise<Version[]> {
  const key = versionKey(spaceId, organizationId);
  const cached = versionCache.get(key);

  if (cached) {
    return cached;
  }

  const inflight = versionInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = fetchVersions(spaceId, organizationId)
    .then((versions) => {
      versionCache.set(key, versions);
      return versions;
    })
    .finally(() => {
      versionInflight.delete(key);
    });

  versionInflight.set(key, promise);
  return promise;
}

export type RelationTitleType = "intake" | "requirement" | "workItem";

export async function getRelationTitle({
  id,
  organizationId,
  spaceId,
  type,
}: {
  id: string;
  organizationId?: string;
  spaceId?: string;
  type: RelationTitleType;
}): Promise<string | undefined> {
  const key = relationTitleKey(type, id, spaceId, organizationId);

  if (relationTitleCache.has(key)) {
    return relationTitleCache.get(key);
  }

  const inflight = relationTitleInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = fetchRelationTitle({ id, organizationId, spaceId, type })
    .then((title) => {
      relationTitleCache.set(key, title);
      return title;
    })
    .finally(() => {
      relationTitleInflight.delete(key);
    });

  relationTitleInflight.set(key, promise);
  return promise;
}

export async function getCachedWorkflowVersion({
  organizationId,
  spaceId,
  workflowVersionId,
}: {
  organizationId?: string;
  spaceId?: string;
  workflowVersionId: string;
}): Promise<WorkflowVersion> {
  const key = workflowVersionKey(workflowVersionId, spaceId, organizationId);
  const cached = workflowVersionCache.get(key);

  if (cached) {
    return cached;
  }

  const inflight = workflowVersionInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = getWorkflowVersion({
    organizationId,
    spaceId: spaceId ?? "",
    workflowVersionId,
  })
    .then((workflowVersion) => {
      workflowVersionCache.set(key, workflowVersion);
      return workflowVersion;
    })
    .finally(() => {
      workflowVersionInflight.delete(key);
    });

  workflowVersionInflight.set(key, promise);
  return promise;
}

/**
 * Synchronous lookup helpers — return `undefined` if the cache is cold.
 * Useful in pure transform functions where async fetching is not possible.
 * Callers should warm the cache via the hooks or `getMembers/getVersions`
 * before relying on these.
 */
export function getMemberById(
  userId: string,
  spaceId: string,
  organizationId?: string,
): SpaceMemberWithUser | undefined {
  const key = memberKey(spaceId, organizationId);
  const members = memberCache.get(key);

  if (!members) {
    return undefined;
  }

  return members.find((member) => member.userId === userId);
}

export function getVersionById(
  versionId: string,
  spaceId: string,
  organizationId?: string,
): Version | undefined {
  const key = versionKey(spaceId, organizationId);
  const versions = versionCache.get(key);

  if (!versions) {
    return undefined;
  }

  return versions.find((version) => version.id === versionId);
}

export type SpaceMembersHookResult = {
  members: SpaceMemberWithUser[];
  loading: boolean;
  error: unknown;
  getMember: (userId: string) => SpaceMemberWithUser | undefined;
};

export type VersionsHookResult = {
  versions: Version[];
  loading: boolean;
  error: unknown;
  getVersion: (versionId: string) => Version | undefined;
};

export type RelationTitleHookResult = {
  title: string | undefined;
  loading: boolean;
  error: unknown;
};

export type WorkflowStateLookupHookResult = {
  loading: boolean;
  error: unknown;
  getState: (
    workflowVersionId: string | undefined,
    stateId: string | undefined,
  ) => WorkflowState | undefined;
};

export function useSpaceMembers(
  spaceId: string | undefined,
  organizationId: string | undefined,
): SpaceMembersHookResult {
  const initial =
    spaceId !== undefined
      ? memberCache.get(memberKey(spaceId, organizationId))
      : undefined;
  const [members, setMembers] = useState<SpaceMemberWithUser[]>(initial ?? []);
  const [loading, setLoading] = useState<boolean>(
    spaceId !== undefined && initial === undefined,
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!spaceId) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const cached = memberCache.get(memberKey(spaceId, organizationId));

    if (cached) {
      setMembers(cached);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getMembers(spaceId, organizationId)
      .then((next) => {
        if (cancelled) return;
        setMembers(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [spaceId, organizationId]);

  return {
    members,
    loading,
    error,
    getMember: (userId: string) =>
      members.find((member) => member.userId === userId),
  };
}

export function useVersions(
  spaceId: string | undefined,
  organizationId: string | undefined,
): VersionsHookResult {
  const initial =
    spaceId !== undefined
      ? versionCache.get(versionKey(spaceId, organizationId))
      : undefined;
  const [versions, setVersions] = useState<Version[]>(initial ?? []);
  const [loading, setLoading] = useState<boolean>(
    spaceId !== undefined && initial === undefined,
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!spaceId) {
      setVersions([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const cached = versionCache.get(versionKey(spaceId, organizationId));

    if (cached) {
      setVersions(cached);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getVersions(spaceId, organizationId)
      .then((next) => {
        if (cancelled) return;
        setVersions(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [spaceId, organizationId]);

  return {
    versions,
    loading,
    error,
    getVersion: (versionId: string) =>
      versions.find((version) => version.id === versionId),
  };
}

export function useRelationTitle(
  type: RelationTitleType,
  id: string | undefined,
  spaceId: string | undefined,
  organizationId: string | undefined,
): RelationTitleHookResult {
  const key = id ? relationTitleKey(type, id, spaceId, organizationId) : "";
  const initial = key ? relationTitleCache.get(key) : undefined;
  const [title, setTitle] = useState<string | undefined>(initial);
  const [loading, setLoading] = useState<boolean>(
    Boolean(id) && !relationTitleCache.has(key),
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!id) {
      setTitle(undefined);
      setLoading(false);
      setError(null);
      return;
    }

    const nextKey = relationTitleKey(type, id, spaceId, organizationId);
    if (relationTitleCache.has(nextKey)) {
      setTitle(relationTitleCache.get(nextKey));
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getRelationTitle({ id, organizationId, spaceId, type })
      .then((next) => {
        if (cancelled) return;
        setTitle(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setTitle(undefined);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, organizationId, spaceId, type]);

  return { title, loading, error };
}

export function useWorkflowStateLookup(
  workflowVersionIds: string[],
  spaceId: string | undefined,
  organizationId: string | undefined,
): WorkflowStateLookupHookResult {
  const idsKey = Array.from(new Set(workflowVersionIds)).sort().join(":");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(Boolean(idsKey));
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const ids = idsKey ? idsKey.split(":").filter(Boolean) : [];
    const missingIds = ids.filter((id) => {
      const key = workflowVersionKey(id, spaceId, organizationId);
      return !workflowVersionCache.has(key);
    });

    if (missingIds.length === 0) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all(
      missingIds.map((workflowVersionId) =>
        getCachedWorkflowVersion({
          organizationId,
          spaceId,
          workflowVersionId,
        }),
      ),
    )
      .then(() => {
        if (cancelled) return;
        setRevision((current) => current + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [idsKey, organizationId, spaceId]);

  return {
    loading,
    error,
    getState: (
      workflowVersionId: string | undefined,
      stateId: string | undefined,
    ) => {
      void revision;
      if (!workflowVersionId || !stateId) {
        return undefined;
      }

      const key = workflowVersionKey(
        workflowVersionId,
        spaceId,
        organizationId,
      );
      return workflowVersionCache
        .get(key)
        ?.states.find((state) => state.id === stateId);
    },
  };
}
