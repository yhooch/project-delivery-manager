import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { RequestWithContext } from "../../http/request-context";

@Injectable()
export class SystemUpdateOperatorService {
  constructor(private readonly config: ConfigService) {}

  canOperate(request: RequestWithContext): boolean {
    const userId = request.session?.userId;
    const username = request.currentUser?.username;
    const userIds = parseAllowlist(
      this.config.get<string>("SYSTEM_OPERATOR_USER_IDS"),
    );

    if (userIds.size > 0) {
      return userId !== undefined && userIds.has(userId);
    }

    const usernames = parseAllowlist(
      this.config.get<string>("SYSTEM_OPERATOR_USERNAMES"),
    );

    return usernames.size > 0 && username !== undefined && usernames.has(username);
  }

  hasConfiguredAllowlist(): boolean {
    return (
      parseAllowlist(this.config.get<string>("SYSTEM_OPERATOR_USER_IDS")).size >
        0 ||
      parseAllowlist(this.config.get<string>("SYSTEM_OPERATOR_USERNAMES")).size >
        0
    );
  }
}

function parseAllowlist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}
