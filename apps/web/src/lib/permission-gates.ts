const SPACE_MANAGER_ROLES = new Set<string>(["SPACE_ADMIN", "PM"]);
const BUG_CREATOR_ROLES = new Set<string>([
  "SPACE_ADMIN",
  "PM",
  "TESTER",
]);
const REQUIREMENT_WRITER_ROLES = new Set<string>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);

function isEnabledRecord(status: string | undefined): boolean {
  return status !== "DISABLED";
}

export function canManageSpace(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(role && isEnabledRecord(status) && SPACE_MANAGER_ROLES.has(role));
}

export function canManageWorkflow(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return canManageSpace(role, status);
}

export function canCreateTasks(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return canManageSpace(role, status);
}

export function canCreateBugs(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(role && isEnabledRecord(status) && BUG_CREATOR_ROLES.has(role));
}

export function canWriteRequirements(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(
    role && isEnabledRecord(status) && REQUIREMENT_WRITER_ROLES.has(role),
  );
}
