import { describe, expect, it, vi } from "vitest";

import type { OrganizationRepository } from "../organization/organization.repository";
import type { SpaceRepository } from "../space/space.repository";
import type { ObjectCodeRepository } from "./object-code.repository";
import { ObjectCodeService } from "./object-code.service";
import type { ObjectCodeLookupRecord } from "./object-code.types";

const ACTOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ORGANIZATION_ID = "01BRZ3NDEKTSV4RRFFQ69G5FAA";
const SPACE_ID = "01DRZ3NDEKTSV4RRFFQ69G5FAC";

describe("ObjectCodeService", () => {
  it("maps TASK lookup results to the frozen work item contract", async () => {
    const record = makeWorkItemRecord({
      id: "01TRZ3NDEKTSV4RRFFQ69G5FAT",
      objectType: "TASK",
      workItemType: "TASK",
      sequence: 12,
      displayCode: "TASK-12",
      title: "Implement dashboard",
    });
    const { objectCodes, service } = makeService(record);

    await expect(
      service.lookup(ACTOR_ID, {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        code: "task-12",
      }),
    ).resolves.toEqual({
      id: record.id,
      type: "WORK_ITEM",
      workItemType: "TASK",
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      sequence: 12,
      displayCode: "TASK-12",
      title: "Implement dashboard",
    });
    expect(objectCodes.findByCode).toHaveBeenCalledWith(
      expect.objectContaining({
        objectType: "TASK",
        sequence: 12,
      }),
    );
  });

  it("maps BUG lookup results to the frozen work item contract", async () => {
    const record = makeWorkItemRecord({
      id: "01URZ3NDEKTSV4RRFFQ69G5FAU",
      objectType: "BUG",
      workItemType: "BUG",
      sequence: 7,
      displayCode: "BUG-7",
      title: "Fix login regression",
    });
    const { service } = makeService(record);

    await expect(
      service.lookup(ACTOR_ID, {
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        code: "BUG-7",
      }),
    ).resolves.toEqual({
      id: record.id,
      type: "WORK_ITEM",
      workItemType: "BUG",
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      sequence: 7,
      displayCode: "BUG-7",
      title: "Fix login regression",
    });
  });
});

function makeService(record: ObjectCodeLookupRecord) {
  const objectCodes = {
    findByCode: vi.fn(async () => [record]),
  };
  const organizations = {
    findAccessibleById: vi.fn(async () => ({
      organization: { id: ORGANIZATION_ID },
      role: "MEMBER",
    })),
  };
  const spaces = {
    findAccessibleById: vi.fn(async () => ({
      space: {
        id: SPACE_ID,
        organizationId: ORGANIZATION_ID,
      },
      role: "SPACE_ADMIN",
    })),
  };

  return {
    objectCodes,
    service: new ObjectCodeService(
      objectCodes as unknown as ObjectCodeRepository,
      organizations as unknown as OrganizationRepository,
      spaces as unknown as SpaceRepository,
    ),
  };
}

function makeWorkItemRecord(
  overrides: Pick<
    ObjectCodeLookupRecord,
    "displayCode" | "id" | "objectType" | "sequence" | "title" | "workItemType"
  >,
): ObjectCodeLookupRecord {
  return {
    type: "WORK_ITEM",
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    isParticipant: false,
    role: "SPACE_ADMIN",
    workItem: {
      type: overrides.workItemType ?? "TASK",
      statusCategory: "IN_PROGRESS",
      currentState: {
        code: "in_progress",
        name: "In Progress",
      },
    },
    ...overrides,
  };
}
