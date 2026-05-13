import type {
  CreateIdentitySessionInput,
  CreateIdentityUserInput,
  IdentitySession,
  IdentitySessionWithUser,
  IdentityUser,
  PublicIdentityUser,
  SessionRevocationReason,
  UpdateUserPreferencesInput,
} from "./identity.types";

export const USER_REPOSITORY = Symbol("USER_REPOSITORY");
export const SESSION_REPOSITORY = Symbol("SESSION_REPOSITORY");

export type UserRepository = {
  create(input: CreateIdentityUserInput): Promise<IdentityUser>;
  findById(id: string): Promise<IdentityUser | undefined>;
  findByUsername(username: string): Promise<IdentityUser | undefined>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  updatePreferences(
    userId: string,
    input: UpdateUserPreferencesInput,
  ): Promise<PublicIdentityUser>;
};

export type SessionRepository = {
  create(input: CreateIdentitySessionInput): Promise<IdentitySession>;
  findValidByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<IdentitySessionWithUser | undefined>;
  revokeById(
    sessionId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<void>;
  revokeActiveByUserId(
    userId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<void>;
  touch(sessionId: string, lastAccessedAt: Date): Promise<void>;
};
