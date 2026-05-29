import type {
  ApiErrorCode,
  DocumentKind,
  StatusCategory,
  SpaceRole,
  TargetType,
  WorkItemType,
} from "@project-delivery/shared";
import type { RequestMetadata } from "../auth/auth-session.types";

export type TargetAccessMode = "read" | "write";
export type TargetWritePolicy = "default" | "objectUpdate";

export type ResolveTargetOptions = {
  access?: TargetAccessMode;
  hideInaccessible?: boolean;
  notFoundCode?: ApiErrorCode;
  writePolicy?: TargetWritePolicy;
  audit?: RequestMetadata & {
    operation: string;
  };
};

export type ResolvedTargetContext = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: TargetType;
  targetKind?: DocumentKind;
  title?: string;
  role: SpaceRole;
  canWrite: boolean;
  workItemType?: WorkItemType;
};

export type TargetRecord = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: TargetType;
  targetKind?: DocumentKind;
  title?: string;
  isDraftRequirement?: boolean;
  createdById?: string | null;
  statusCategory?: StatusCategory;
  workItemType?: WorkItemType;
  currentState?: {
    code: string;
    name: string;
  };
};
