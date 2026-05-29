import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaObjectCodeRepository } from "./object-code.repository";

const ACTOR_ID = "01H00000000000000000000001";
const ORGANIZATION_ID = "01H00000000000000000000002";
const SPACE_ID = "01H00000000000000000000003";
const REQUIREMENT_ID = "01H00000000000000000000004";

describe("PrismaObjectCodeRepository", () => {
  it("looks up current requirement documents before code history", async () => {
    const documentFindMany = vi.fn(async () => [
      makeRequirementDocument({ sequence: 12 }),
    ]);
    const documentCodeHistoryFindMany = vi.fn();
    const objectParticipantFindMany = vi.fn(async () => [
      { targetId: REQUIREMENT_ID },
    ]);
    const repository = new PrismaObjectCodeRepository({
      client: {
        document: {
          findMany: documentFindMany,
        },
        documentCodeHistory: {
          findMany: documentCodeHistoryFindMany,
        },
        objectParticipant: {
          findMany: objectParticipantFindMany,
        },
      },
    } as unknown as PrismaService);

    const records = await repository.findByCode({
      actorUserId: ACTOR_ID,
      objectType: "REQUIREMENT",
      organizationId: ORGANIZATION_ID,
      sequence: 12,
      spaceId: SPACE_ID,
    });

    expect(records).toEqual([
      expect.objectContaining({
        displayCode: "REQ-12",
        id: REQUIREMENT_ID,
        isParticipant: true,
        objectType: "REQUIREMENT",
        sequence: 12,
        type: "REQUIREMENT",
      }),
    ]);
    expect(documentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: "REQUIREMENT",
          sequence: 12,
          status: {
            not: "DRAFT",
          },
        }),
      }),
    );
    expect(documentCodeHistoryFindMany).not.toHaveBeenCalled();
    expect(objectParticipantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetType: "DOCUMENT",
        }),
      }),
    );
  });

  it("falls back to requirement document code history", async () => {
    const documentCodeHistoryFindMany = vi.fn(async () => [
      {
        sequence: 7,
        document: makeRequirementDocument({
          sequence: 12,
          status: "ACTIVE",
        }),
      },
    ]);
    const repository = new PrismaObjectCodeRepository({
      client: {
        document: {
          findMany: vi.fn(async () => []),
        },
        documentCodeHistory: {
          findMany: documentCodeHistoryFindMany,
        },
        objectParticipant: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService);

    const records = await repository.findByCode({
      actorUserId: ACTOR_ID,
      objectType: "REQUIREMENT",
      organizationId: ORGANIZATION_ID,
      sequence: 7,
      spaceId: SPACE_ID,
    });

    expect(records).toEqual([
      expect.objectContaining({
        displayCode: "REQ-7",
        id: REQUIREMENT_ID,
        sequence: 7,
      }),
    ]);
    expect(documentCodeHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          codeStatus: "ASSIGNED",
          kind: "REQUIREMENT",
          sequence: 7,
          document: expect.objectContaining({
            kind: "REQUIREMENT",
            status: {
              not: "DRAFT",
            },
          }),
        }),
      }),
    );
  });
});

function makeRequirementDocument(input: {
  sequence: number;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
}) {
  return {
    id: REQUIREMENT_ID,
    organizationId: ORGANIZATION_ID,
    sequence: input.sequence,
    spaceId: SPACE_ID,
    status: input.status ?? "ACTIVE",
    title: "Requirement",
    space: {
      members: [{ role: "PM" }],
    },
  };
}
