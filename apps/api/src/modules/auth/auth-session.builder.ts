import { Injectable } from "@nestjs/common";
import type { AppSession, SessionUser } from "@project-delivery/shared";

import type { PublicIdentityUser } from "../identity/identity.types";

@Injectable()
export class AuthSessionBuilder {
  buildIdentitySession(user: PublicIdentityUser): AppSession {
    return {
      user: toSessionUser(user),
      organizations: [],
      spaces: [],
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: false,
      },
    };
  }
}

export function toSessionUser(user: PublicIdentityUser): SessionUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar: user.avatar,
    status: user.status,
    preferences: {
      locale: user.locale,
      themeMode: user.themeMode,
    },
  };
}
