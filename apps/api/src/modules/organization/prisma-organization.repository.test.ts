import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaOrganizationRepository } from "./prisma-organization.repository";

const ORGANIZATION_ID = "01HRZ3NDEKTSV4RRFFQ69G5FO1";
const MEMBER_ID = "01HRZ3NDEKTSV4RRFFQ69G5FM1";
const USER_ID = "01HRZ3NDEKTSV4RRFFQ69G5FU1";
const ACTOR_ID = "01HRZ3NDEKTSV4RRFFQ69G5FA1";

describe("PrismaOrganizationRepository", () => {
  it("disables active space memberships in the same transaction when an organization member is disabled", async () => {
    const activeMember = makeMember("ACTIVE");
    const disabledMember = makeMember("DISABLED");
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(activeMember)
      .mockResolvedValueOnce(disabledMember);
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const tx = {
      $queryRaw: vi.fn(async () => []),
      organizationMember: {
        findFirst,
        update: vi.fn(async () => disabledMember),
      },
      spaceMember: {
        updateMany,
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(
          async (callback: (transaction: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
      },
    } as unknown as PrismaService;
    const repository = new PrismaOrganizationRepository(prisma);

    const updated = await repository.updateMember({
      memberId: MEMBER_ID,
      organizationId: ORGANIZATION_ID,
      status: "DISABLED",
      updatedById: ACTOR_ID,
    });

    expect(updated?.status).toBe("DISABLED");
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        status: "DISABLED",
        updatedById: ACTOR_ID,
      },
      where: {
        deletedAt: null,
        organizationId: ORGANIZATION_ID,
        status: "ACTIVE",
        userId: USER_ID,
      },
    });
  });
});

function makeMember(status: "ACTIVE" | "DISABLED") {
  return {
    id: MEMBER_ID,
    organizationId: ORGANIZATION_ID,
    role: "MEMBER" as const,
    status,
    userId: USER_ID,
    user: {
      avatar: null,
      id: USER_ID,
      name: "Member",
      status: "ACTIVE" as const,
      username: "member",
    },
  };
}
