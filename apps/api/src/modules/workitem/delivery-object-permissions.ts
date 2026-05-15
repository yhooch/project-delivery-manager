import type { SpaceRole } from "@project-delivery/shared";

const BUG_CREATOR_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM", "TESTER"]);
const TASK_CREATOR_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);
const DELIVERY_OBJECT_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);

export function canCreateBugDeliveryObject(role: SpaceRole): boolean {
  return BUG_CREATOR_ROLES.has(role);
}

export function canCreateTaskDeliveryObject(role: SpaceRole): boolean {
  return TASK_CREATOR_ROLES.has(role);
}

export function canManageDeliveryObject(role: SpaceRole): boolean {
  return DELIVERY_OBJECT_MANAGER_ROLES.has(role);
}

export function getBugCreateDeniedReason(role: SpaceRole): string {
  return role === "VIEWER" ? "VIEWER_READ_ONLY" : "ROLE_CANNOT_CREATE_BUG";
}

export function getDeliveryObjectWriteDeniedReason(role: SpaceRole): string {
  return role === "VIEWER" ? "VIEWER_READ_ONLY" : "ROLE_CANNOT_MANAGE_OBJECT";
}
