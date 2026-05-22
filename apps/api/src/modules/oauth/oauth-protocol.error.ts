export type OAuthProtocolErrorCode =
  | "invalid_client"
  | "invalid_grant"
  | "invalid_request"
  | "invalid_scope"
  | "unsupported_grant_type";

export class OAuthProtocolError extends Error {
  constructor(
    readonly error: OAuthProtocolErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }

  toResponseBody(): { error: OAuthProtocolErrorCode; error_description: string } {
    return {
      error: this.error,
      error_description: this.message,
    };
  }
}
