import type { SessionUser } from "@project-delivery/shared";

import type { PublicIdentityUser } from "../identity/identity.types";

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
