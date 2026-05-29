import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ObjectCodeLookupQuery,
  ObjectCodeLookupResult,
  SpaceRole,
} from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import {
  canReadAllSpaceWorkItems,
  isTesterVisibleWorkItem,
} from "../workitem/workitem-visibility";
import {
  OBJECT_CODE_REPOSITORY,
  type ObjectCodeRepository,
} from "./object-code.repository";
import type { ObjectCodeLookupRecord } from "./object-code.types";
import { parseObjectCode } from "./object-code.types";

const FULL_SPACE_INTAKE_READER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
]);
const SPACE_BUG_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "TESTER",
  "VIEWER",
]);

@Injectable()
export class ObjectCodeService {
  constructor(
    @Inject(OBJECT_CODE_REPOSITORY)
    private readonly objectCodes: ObjectCodeRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
  ) {}

  async lookup(
    actorUserId: string,
    query: ObjectCodeLookupQuery,
  ): Promise<ObjectCodeLookupResult> {
    const parsed = parseObjectCode(query.code);

    if (!parsed) {
      throwObjectCodeInvalid();
    }

    await this.requireOrganizationAccess(actorUserId, query.organizationId);

    if (query.spaceId) {
      await this.requireSpaceInOrganization(
        actorUserId,
        query.organizationId,
        query.spaceId,
      );
    }

    const records = await this.objectCodes.findByCode({
      actorUserId,
      includeHistorical: query.includeHistorical,
      organizationId: query.organizationId,
      objectType: parsed.objectType,
      sequence: parsed.sequence,
      spaceId: query.spaceId,
    });
    const visibleRecords = records.filter((record) =>
      canReadLookupRecord(record),
    );

    if (visibleRecords.length === 0) {
      throwObjectCodeNotFound();
    }

    if (visibleRecords.length > 1) {
      throwObjectCodeAmbiguous();
    }

    const record = visibleRecords[0];

    return {
      id: record.id,
      type: record.type,
      targetType: record.targetType,
      targetId: record.targetId,
      ...(record.kind ? { kind: record.kind } : {}),
      ...(record.previousKind ? { previousKind: record.previousKind } : {}),
      ...(record.codeStatus ? { codeStatus: record.codeStatus } : {}),
      ...(record.workItemType ? { workItemType: record.workItemType } : {}),
      organizationId: record.organizationId,
      sequence: record.sequence,
      displayCode: record.displayCode,
      spaceId: record.spaceId,
      title: record.title,
    };
  }

  private async requireOrganizationAccess(
    actorUserId: string,
    organizationId: string,
  ) {
    const access = await this.organizations.findAccessibleById(
      actorUserId,
      organizationId,
    );

    if (!access) {
      throw new ApiException(
        "ORGANIZATION_ACCESS_DENIED",
        "Organization access denied",
        HttpStatus.FORBIDDEN,
      );
    }

    return access;
  }

  private async requireSpaceInOrganization(
    actorUserId: string,
    organizationId: string,
    spaceId: string,
  ) {
    const access = await this.spaces.findAccessibleById(actorUserId, spaceId);

    if (!access || access.space.organizationId !== organizationId) {
      throw new ApiException(
        "SPACE_ACCESS_DENIED",
        "Space access denied",
        HttpStatus.FORBIDDEN,
      );
    }

    return access;
  }
}

function canReadLookupRecord(record: ObjectCodeLookupRecord): boolean {
  switch (record.objectType) {
    case "REQUIREMENT":
      return true;
    case "INTAKE_ITEM":
      return (
        FULL_SPACE_INTAKE_READER_ROLES.has(record.role) || record.isParticipant
      );
    case "TASK":
      return (
        canReadAllSpaceWorkItems(record.role) ||
        (record.role === "TESTER" &&
          record.workItem !== undefined &&
          isTesterVisibleWorkItem(record.workItem)) ||
        record.isParticipant
      );
    case "BUG":
      return SPACE_BUG_READ_ALL_ROLES.has(record.role) || record.isParticipant;
  }
}

function throwObjectCodeInvalid(): never {
  throw new ApiException(
    "OBJECT_CODE_INVALID",
    "Object code is invalid",
    HttpStatus.BAD_REQUEST,
  );
}

function throwObjectCodeNotFound(): never {
  throw new ApiException(
    "OBJECT_CODE_NOT_FOUND",
    "Object code not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwObjectCodeAmbiguous(): never {
  throw new ApiException(
    "OBJECT_CODE_AMBIGUOUS",
    "Object code is ambiguous; provide a spaceId",
    HttpStatus.CONFLICT,
  );
}
