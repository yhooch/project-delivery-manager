import type { AppSession, SessionUser } from "@project-delivery/shared";

import type { IdentitySession } from "../identity/identity.types";

export type AuthenticatedSessionContext = {
  sessionId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type AuthenticatedUserContext = SessionUser;

export type AuthSessionContext = {
  session: AuthenticatedSessionContext;
  user: AuthenticatedUserContext;
};

export type AuthResult = {
  appSession: AppSession;
  cookie: SessionCookie;
};

export type SessionCookie = {
  name: string;
  token: string;
  expiresAt: Date;
};

export type CreatedSession = {
  session: IdentitySession;
  token: string;
};

export type RequestMetadata = {
  ip?: string;
  requestId?: string;
  userAgent?: string;
};
