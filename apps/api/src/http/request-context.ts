import type {
  AuthenticatedSessionContext,
  AuthenticatedUserContext,
} from "../modules/auth/auth-session.types";

export type SessionContext = AuthenticatedSessionContext & {
  organizationId?: string;
};

export type LegacySessionContext = {
  sessionId: string;
  userId: string;
  organizationId?: string;
};

export type McpOAuthPrincipalContext = {
  accessTokenId: string;
  authorizationId: string;
  clientId: string;
  resource: string;
  scopes: string[];
  userId: string;
};

export type HeaderValue = string | string[] | undefined;

export type RequestWithContext = {
  cookies?: Record<string, string | undefined>;
  currentUser?: AuthenticatedUserContext;
  headers?: Record<string, HeaderValue>;
  ip?: string;
  mcpPrincipal?: McpOAuthPrincipalContext;
  protocol?: string;
  requestId?: string;
  session?: SessionContext;
  socket?: {
    remoteAddress?: string;
  };
};

export function firstHeaderValue(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function getRequestId(request: RequestWithContext): string {
  return request.requestId ?? "unknown";
}
