"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { useRouter } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";

export function BugLanding() {
  const t = useTranslations("bugs");
  const router = useRouter();
  const { currentSpace, session, status } = useSession();

  useEffect(() => {
    if (status === "authenticated" && currentSpace) {
      router.replace(`/spaces/${currentSpace.id}/bugs`);
    }
  }, [currentSpace, router, status]);

  if (status === "loading") {
    return (
      <StatePanel
        icon="loading"
        title={t("states.loading.title")}
        description={t("states.loading.description")}
      />
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.unauthenticated.title")}
        description={t("states.unauthenticated.description")}
      />
    );
  }

  return (
    <StatePanel
      icon="warning"
      title={t("states.noSpace.title")}
      description={t("states.noSpace.description")}
    />
  );
}

function StatePanel({
  description,
  icon,
  title,
}: {
  description: string;
  icon: "loading" | "warning";
  title: string;
}) {
  const Icon = icon === "loading" ? Loader2 : CircleAlert;

  return (
    <section className="state-panel" aria-live="polite">
      <div className="state-panel__icon">
        <Icon aria-hidden="true" size={18} strokeWidth={2} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}
