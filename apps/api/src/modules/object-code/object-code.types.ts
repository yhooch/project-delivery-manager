import type {
  ObjectCodeLookupResult,
  ObjectCodeType,
  SpaceRole,
  StatusCategory,
  WorkItemType,
} from "@project-delivery/shared";

export type ParsedObjectCode = {
  objectType: ObjectCodeType;
  prefix: ObjectCodePrefix;
  sequence: number;
};

export type ObjectCodePrefix = "REQ" | "INTAKE" | "TASK" | "BUG";

export type ObjectCodeLookupRepositoryInput = {
  actorUserId: string;
  organizationId: string;
  objectType: ObjectCodeType;
  includeHistorical?: boolean;
  sequence: number;
  spaceId?: string;
};

export type ObjectCodeLookupRecord = ObjectCodeLookupResult & {
  objectType: ObjectCodeType;
  isParticipant: boolean;
  role: SpaceRole;
  requirementStatus?: "DRAFT" | "CONFIRMED" | "ARCHIVED";
  workItem?: {
    type: WorkItemType;
    statusCategory: StatusCategory;
    currentState?: {
      code?: string | null;
      name?: string | null;
    };
  };
};

const CODE_PATTERN = /^(REQ|INTAKE|TASK|BUG)-([1-9]\d*)$/iu;
const MAX_SEQUENCE = 2_147_483_647;
const PREFIX_BY_TYPE = {
  REQUIREMENT: "REQ",
  INTAKE_ITEM: "INTAKE",
  TASK: "TASK",
  BUG: "BUG",
} as const satisfies Record<ObjectCodeType, ObjectCodePrefix>;
const TYPE_BY_PREFIX = {
  REQ: "REQUIREMENT",
  INTAKE: "INTAKE_ITEM",
  TASK: "TASK",
  BUG: "BUG",
} as const satisfies Record<ObjectCodePrefix, ObjectCodeType>;

export function parseObjectCode(code: string): ParsedObjectCode | undefined {
  const match = CODE_PATTERN.exec(code.trim());

  if (!match) {
    return undefined;
  }

  const prefix = match[1].toUpperCase() as ObjectCodePrefix;
  const sequence = Number(match[2]);

  if (!Number.isSafeInteger(sequence) || sequence > MAX_SEQUENCE) {
    return undefined;
  }

  return {
    objectType: TYPE_BY_PREFIX[prefix],
    prefix,
    sequence,
  };
}

export function formatDisplayCode(
  objectType: ObjectCodeType,
  sequence: number,
): string {
  return `${PREFIX_BY_TYPE[objectType]}-${sequence}`;
}
