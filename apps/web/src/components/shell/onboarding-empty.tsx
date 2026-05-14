"use client";

import { Building2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "../ui/button";

import { CreateOrganizationDialog } from "./create-organization-dialog";
import { useSession } from "../providers/session-provider";

export function OnboardingEmpty() {
  const t = useTranslations("shell.onboarding");
  const { session } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  const canCreate = session?.capabilities.canCreateOrganization ?? true;

  return (
    <>
      <div
        data-testid="onboarding-empty"
        className="flex h-full items-center justify-center px-4"
      >
        <div className="max-w-md text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
          {canCreate && (
            <Button
              size="lg"
              className="mt-5"
              data-testid="onboarding-create-org-button"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              {t("createCta")}
            </Button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{t("waitingHint")}</p>
        </div>
      </div>
      <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
