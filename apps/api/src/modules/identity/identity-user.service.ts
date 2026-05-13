import { Inject, Injectable } from "@nestjs/common";
import type { UserPreferences } from "@project-delivery/shared";

import {
  USER_REPOSITORY,
  type UserRepository,
} from "./identity.repository";
import type { PublicIdentityUser } from "./identity.types";

@Injectable()
export class IdentityUserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
  ) {}

  async updatePreferences(
    userId: string,
    preferences: UserPreferences,
  ): Promise<UserPreferences> {
    const user = await this.users.updatePreferences(userId, preferences);

    return toUserPreferences(user);
  }
}

export function toUserPreferences(user: PublicIdentityUser): UserPreferences {
  return {
    locale: user.locale,
    themeMode: user.themeMode,
  };
}
