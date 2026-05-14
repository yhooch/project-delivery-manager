"use client";

import type {
  SpaceMemberWithUser,
  Version,
} from "@project-delivery/shared";
import { useEffect, useState } from "react";

import { listSpaceMembers } from "../space-service";
import { listVersions } from "../version-service";

// ----------------------------------------------------------------------
// Module-level caches keyed by `${organizationId}:${spaceId}` and `${spaceId}`.
// 这些缓存是会话级、纯内存的；切换组织或空间后旧条目自然不会被命中。
// 任何 hook/纯函数共享同一份缓存，避免重复请求。
// ----------------------------------------------------------------------

const memberCache = new Map<string, SpaceMemberWithUser[]>();
const versionCache = new Map<string, Version[]>();

const memberInflight = new Map<string, Promise<SpaceMemberWithUser[]>>();
const versionInflight = new Map<string, Promise<Version[]>>();

function memberKey(spaceId: string, organizationId?: string): string {
  return `${organizationId ?? ""}:${spaceId}`;
}

function versionKey(spaceId: string, organizationId?: string): string {
  return `${organizationId ?? ""}:${spaceId}`;
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

/**
 * Synchronous lookup helpers — return `undefined` if the cache is cold.
 * Useful in pure transform functions (e.g. `toMockWorkItem`) where async
 * fetching is not possible. Callers should warm the cache via the hooks
 * or `getMembers/getVersions` before relying on these.
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

/**
 * Test-only helper — clears all in-memory caches.
 * 不在 production code path 中使用；存在以便单测复位状态。
 */
export function __resetLookupCaches(): void {
  memberCache.clear();
  versionCache.clear();
  memberInflight.clear();
  versionInflight.clear();
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
