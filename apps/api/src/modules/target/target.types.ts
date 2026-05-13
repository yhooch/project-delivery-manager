import type {
  ApiErrorCode,
  SpaceRole,
  TargetType,
} from "@project-delivery/shared";

export type TargetAccessMode = "read" | "write";

export type ResolveTargetOptions = {
  access?: TargetAccessMode;
  hideInaccessible?: boolean;
  notFoundCode?: ApiErrorCode;
};

export type ResolvedTargetContext = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: TargetType;
  title?: string;
  role: SpaceRole;
  canWrite: boolean;
};

export type TargetRecord = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: TargetType;
  title?: string;
  isDraftRequirement?: boolean;
};
