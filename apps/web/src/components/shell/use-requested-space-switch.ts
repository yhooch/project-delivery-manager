"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "../providers/session-provider";
import {
  getApiErrorDisplay,
  type ApiErrorDisplayState,
} from "./api-error-display";

export type RequestedSpaceSwitchNotice = {
  id: string;
  spaceName: string;
};

export function useRequestedSpaceSwitch(): {
  dismissNotice: () => void;
  error: ApiErrorDisplayState | null;
  errorKey: string | null;
  isSwitching: boolean;
  notice: RequestedSpaceSwitchNotice | null;
} {
  const tRoot = useTranslations();
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
    error: ApiErrorDisplayState;
    spaceId: string;
  } | null>(null);
  const [notice, setNotice] = useState<RequestedSpaceSwitchNotice | null>(null);
  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);
  const requestIdLabel = tRoot("errors.apiDetails.requestId");

  const activeError =
    requestedSpaceSwitchError &&
    requestedSpaceSwitchError.spaceId === requestedSpaceId
      ? requestedSpaceSwitchError.error
      : null;
  const needsSwitch = Boolean(
    requestedSpace && requestedSpace.id !== currentSpace?.id,
  );
  const isSwitching = Boolean(
    (needsSwitch || requestedSpaceSwitchId) && !activeError,
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
            error: getApiErrorDisplay(error, requestIdLabel),
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
    requestIdLabel,
    switchSpace,
  ]);

  return {
    dismissNotice,
    error: activeError,
    errorKey: activeError?.messageKey ?? null,
    isSwitching,
    notice,
  };
}

function normalizeSearchParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
