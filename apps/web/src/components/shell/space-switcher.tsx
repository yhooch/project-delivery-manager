"use client";

import { Layers3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useSession } from "../providers/session-provider";

export function SpaceSwitcher() {
  const t = useTranslations("shell.spaceSwitcher");
  const {
    currentSpace,
    session,
    spacesForCurrentOrganization,
    status,
    switchSpace,
  } = useSession();
  const [isPending, setIsPending] = useState(false);

  if (status !== "authenticated" || !session) {
    return (
      <div className="organization-switcher organization-switcher--static">
        <Layers3 aria-hidden="true" size={16} strokeWidth={2} />
        <span>{t("signedOut")}</span>
      </div>
    );
  }

  if (spacesForCurrentOrganization.length === 0) {
    return (
      <div className="organization-switcher organization-switcher--static">
        <Layers3 aria-hidden="true" size={16} strokeWidth={2} />
        <span>{t("empty")}</span>
      </div>
    );
  }

  if (spacesForCurrentOrganization.length <= 1) {
    return (
      <div className="organization-switcher organization-switcher--static">
        <Layers3 aria-hidden="true" size={16} strokeWidth={2} />
        <span>{currentSpace?.name ?? spacesForCurrentOrganization[0]?.name}</span>
      </div>
    );
  }

  async function onChange(spaceId: string) {
    setIsPending(true);

    try {
      await switchSpace(spaceId);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <label className="organization-switcher">
      <Layers3 aria-hidden="true" size={16} strokeWidth={2} />
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        disabled={isPending}
        onChange={(event) => void onChange(event.target.value)}
        value={currentSpace?.id ?? ""}
      >
        {spacesForCurrentOrganization.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
    </label>
  );
}
