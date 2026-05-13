import type { Locale, ThemeMode } from "@project-delivery/shared";

export type UserStatus = "ACTIVE" | "DISABLED";
export type SessionRevocationReason = "LOGOUT" | "ROTATED" | "EXPIRED" | "ADMIN";

export type IdentityUser = {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  avatar?: string;
  status: UserStatus;
  locale: Locale;
  themeMode: ThemeMode;
};

export type PublicIdentityUser = Omit<IdentityUser, "passwordHash">;

export type CreateIdentityUserInput = {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  locale: Locale;
  themeMode: ThemeMode;
};

export type IdentitySession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  revocationReason?: SessionRevocationReason;
  lastAccessedAt: Date;
};

export type IdentitySessionWithUser = {
  session: IdentitySession;
  user: IdentityUser;
};

export type CreateIdentitySessionInput = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
};

export type UpdateUserPreferencesInput = {
  locale: Locale;
  themeMode: ThemeMode;
};
