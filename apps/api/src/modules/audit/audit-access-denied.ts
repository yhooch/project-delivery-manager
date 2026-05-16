import type { AuditService } from "./audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";

export type AccessDeniedAuditInput = RequestMetadata & {
  actorId?: string;
  metadata?: Record<string, unknown>;
  operation: string;
  organizationId: string;
  reason: string;
  spaceId?: string;
  targetId: string;
  targetType: string;
};

export async function auditAccessDenied(
  audit: AuditService,
  input: AccessDeniedAuditInput,
): Promise<void> {
  await audit.record({
    actionType: "ACCESS_DENIED",
    actorId: input.actorId,
    metadata: {
      ...input.metadata,
      operation: input.operation,
      reason: input.reason,
    },
    organizationId: input.organizationId,
    requestId: input.requestId,
    ip: input.ip,
    spaceId: input.spaceId,
    targetId: input.targetId,
    targetType: input.targetType,
    userAgent: input.userAgent,
  });
}
