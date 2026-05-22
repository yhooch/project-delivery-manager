import { HttpStatus } from "@nestjs/common";
import type { McpBearerChallengeError } from "@project-delivery/shared";

export class McpBearerAuthenticationError extends Error {
  constructor(
    readonly status: HttpStatus.UNAUTHORIZED | HttpStatus.FORBIDDEN,
    readonly challengeError: McpBearerChallengeError,
    message: string,
    readonly requiredScope?: string,
  ) {
    super(message);
  }
}
