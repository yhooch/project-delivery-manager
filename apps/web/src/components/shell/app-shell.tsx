"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";

import { useSession } from "../providers/session-provider";

import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { OnboardingEmpty } from "./onboarding-empty";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { status, session } = useSession();
  const t = useTranslations("shell");
  useCommandPaletteShortcut();

  useEffect(() => {
    document.title = t("documentTitle");
  }, [t]);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return null;
  }

  const hasOrganization = session.organizations.length > 0;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto bg-background">
          {hasOrganization ? children : <OnboardingEmpty />}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
