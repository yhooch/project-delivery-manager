"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { useSession } from "../providers/session-provider";

export type RequestedSpaceSwitchNotice = {
  id: string;
  spaceName: string;
};

export function useRequestedSpaceSwitch(): {
  dismissNotice: () => void;
  errorKey: string | null;
  isSwitching: boolean;
  notice: RequestedSpaceSwitchNotice | null;
} {
  const searchParams = useSearchParams();
  const {
    currentSpace,
    spacesForCurrentOrganization = [],
    switchSpace,
  } = useSession();
  const requestedSpaceId = normalizeSearchParam(searchParams.get("spaceId"));
  const requestedSpace = useMemo(
    () =>
      requestedSpaceId
        ? spacesForCurrentOrganization.find(
            (space) => space.id === requestedSpaceId,
          )
        : undefined,
    [requestedSpaceId, spacesForCurrentOrganization],
  );
  const [requestedSpaceSwitchId, setRequestedSpaceSwitchId] = useState<
    string | null
  >(null);
  const [requestedSpaceSwitchError, setRequestedSpaceSwitchError] = useState<{
    key: string;
    spaceId: string;
  } | null>(null);
  const [notice, setNotice] = useState<RequestedSpaceSwitchNotice | null>(null);
  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  const activeErrorKey =
    requestedSpaceSwitchError &&
    requestedSpaceSwitchError.spaceId === requestedSpaceId
      ? requestedSpaceSwitchError.key
      : null;
  const needsSwitch = Boolean(
    requestedSpace && requestedSpace.id !== currentSpace?.id,
  );
  const isSwitching = Boolean(
    (needsSwitch || requestedSpaceSwitchId) && !activeErrorKey,
  );

  useEffect(() => {
    if (!requestedSpaceId || !requestedSpace) {
      setRequestedSpaceSwitchId(null);
      setRequestedSpaceSwitchError(null);
      setNotice(null);
      return;
    }

    if (currentSpace?.id === requestedSpace.id) {
      if (requestedSpaceSwitchId === requestedSpace.id) {
        setNotice(
          (current) =>
            current ?? {
              id: `${requestedSpace.id}:${Date.now()}`,
              spaceName: requestedSpace.name,
            },
        );
      }
      setRequestedSpaceSwitchId(null);
      setRequestedSpaceSwitchError(null);
      return;
    }

    let cancelled = false;
    setRequestedSpaceSwitchId(requestedSpace.id);
    setRequestedSpaceSwitchError(null);
    setNotice(null);

    void switchSpace(requestedSpace.id)
      .then(() => {
        if (!cancelled) {
          setRequestedSpaceSwitchId(null);
          setNotice({
            id: `${requestedSpace.id}:${Date.now()}`,
            spaceName: requestedSpace.name,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRequestedSpaceSwitchId(null);
          setRequestedSpaceSwitchError({
            key: getApiErrorMessageKey(error),
            spaceId: requestedSpace.id,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentSpace?.id,
    requestedSpace,
    requestedSpaceId,
    requestedSpaceSwitchId,
    switchSpace,
  ]);

  return {
    dismissNotice,
    errorKey: activeErrorKey,
    isSwitching,
    notice,
  };
}

function normalizeSearchParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
