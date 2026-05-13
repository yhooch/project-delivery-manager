import type { Locale, ThemeMode } from "@project-delivery/shared";

import type { IdentitySession, IdentityUser } from "./identity.types";

type PrismaUserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  avatar: string | null;
  status: "ACTIVE" | "DISABLED";
  locale: "zh_CN" | "en_US";
  themeMode: "SYSTEM" | "LIGHT" | "DARK";
};

type PrismaSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: "LOGOUT" | "ROTATED" | "EXPIRED" | "ADMIN" | null;
  lastAccessedAt: Date;
};

export function toIdentityUser(record: PrismaUserRecord): IdentityUser {
  return {
    id: record.id,
    username: record.username,
    passwordHash: record.passwordHash,
    name: record.name,
    avatar: record.avatar ?? undefined,
    status: record.status,
    locale: toSharedLocale(record.locale),
    themeMode: record.themeMode,
  };
}

export function toIdentitySession(record: PrismaSessionRecord): IdentitySession {
  return {
    id: record.id,
    userId: record.userId,
    tokenHash: record.tokenHash,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt ?? undefined,
    revocationReason: record.revocationReason ?? undefined,
    lastAccessedAt: record.lastAccessedAt,
  };
}

export function toPrismaLocale(locale: Locale): "zh_CN" | "en_US" {
  return locale === "zh-CN" ? "zh_CN" : "en_US";
}

export function toSharedLocale(locale: "zh_CN" | "en_US"): Locale {
  return locale === "zh_CN" ? "zh-CN" : "en-US";
}

export function toPrismaThemeMode(
  themeMode: ThemeMode,
): "SYSTEM" | "LIGHT" | "DARK" {
  return themeMode;
}
