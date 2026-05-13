"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRouter } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";

export function LogoutButton() {
  const t = useTranslations("shell.logout");
  const router = useRouter();
  const { logout, status } = useSession();
  const [isPending, setIsPending] = useState(false);

  async function onLogout() {
    setIsPending(true);

    try {
      await logout();
      router.replace("/login");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button
      aria-label={t("ariaLabel")}
      className="icon-button"
      disabled={status !== "authenticated" || isPending}
      onClick={() => void onLogout()}
      title={t("label")}
      type="button"
    >
      <LogOut aria-hidden="true" size={17} strokeWidth={2} />
    </button>
  );
}
