"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useSession } from "../providers/session-provider";

export function OrganizationSwitcher() {
  const t = useTranslations("shell.organizationSwitcher");
  const { currentOrganization, session, status, switchOrganization } =
    useSession();
  const [isPending, setIsPending] = useState(false);

  if (status !== "authenticated" || !session) {
    return (
      <div
        data-testid="org-switcher"
        data-org-switcher-state="signed-out"
        className="organization-switcher organization-switcher--static"
      >
        <Building2 aria-hidden="true" size={16} strokeWidth={2} />
        <span>{t("signedOut")}</span>
      </div>
    );
  }

  if (session.organizations.length <= 1) {
    return (
      <div
        data-testid="org-switcher"
        data-org-switcher-state="static"
        className="organization-switcher organization-switcher--static"
      >
        <Building2 aria-hidden="true" size={16} strokeWidth={2} />
        <span data-testid="org-switcher-current-name">
          {currentOrganization?.name ?? t("empty")}
        </span>
      </div>
    );
  }

  async function onChange(organizationId: string) {
    setIsPending(true);

    try {
      await switchOrganization(organizationId);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <label
      data-testid="org-switcher"
      data-org-switcher-state="select"
      className="organization-switcher"
    >
      <Building2 aria-hidden="true" size={16} strokeWidth={2} />
      <span className="sr-only">{t("label")}</span>
      <select
        data-testid="org-switcher-select"
        aria-label={t("label")}
        disabled={isPending}
        onChange={(event) => void onChange(event.target.value)}
        value={session.defaultOrganizationId ?? ""}
      >
        {session.organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
    </label>
  );
}
