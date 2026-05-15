"use client";

import { KeyRound, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useSession } from "../providers/session-provider";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ChangePasswordDialog } from "./change-password-dialog";

export function UserMenu() {
  const t = useTranslations("shell.user");
  const { session, logout } = useSession();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  if (!session) return null;

  const initial = session.user.name.slice(0, 1).toUpperCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("openMenu")}>
            <Avatar className="h-6 w-6">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="flex flex-col gap-0.5 text-foreground normal-case">
            <span className="text-sm font-semibold">{session.user.name}</span>
            <span className="text-[11px] font-normal text-muted-foreground">
              @{session.user.username}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="user-menu-change-password"
            onSelect={() => {
              setChangePasswordOpen(true);
            }}
            className="gap-2 text-xs"
          >
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            {t("changePassword")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void logout();
            }}
            className="gap-2 text-xs text-destructive focus:text-destructive"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
      />
    </>
  );
}
