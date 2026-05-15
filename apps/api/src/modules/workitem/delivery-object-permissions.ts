import type { SpaceRole } from "@project-delivery/shared";

const DELIVERY_OBJECT_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);

export function canManageDeliveryObject(role: SpaceRole): boolean {
  return DELIVERY_OBJECT_MANAGER_ROLES.has(role);
}

export function getDeliveryObjectWriteDeniedReason(role: SpaceRole): string {
  return role === "VIEWER" ? "VIEWER_READ_ONLY" : "ROLE_CANNOT_MANAGE_OBJECT";
}
