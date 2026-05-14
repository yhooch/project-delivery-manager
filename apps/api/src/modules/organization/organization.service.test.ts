import { describe, expect, it, vi } from "vitest";

import type { RateLimiterService } from "../auth/rate-limiter.service";
import type { UserRepository } from "../identity/identity.repository";
import {
  LastOrganizationOwnerRequiredError,
  type OrganizationRepository,
} from "./organization.repository";
import { OrganizationService } from "./organization.service";

const ORGANIZATION_ID = "01H00000000000000000000000";
const ACTOR_ID = "01H00000000000000000000001";
const MEMBER_ID = "01H00000000000000000000002";

describe("OrganizationService", () => {
  it("maps repository last-owner race protection during member downgrade", async () => {
    const repository = createRepository();
    repository.countActiveOwners.mockResolvedValue(2);
    repository.updateMember.mockRejectedValue(
      new LastOrganizationOwnerRequiredError(),
    );
    const service = new OrganizationService(
      repository,
      {} as UserRepository,
      {} as RateLimiterService,
    );

    await expect(
      service.updateMember(ACTOR_ID, ORGANIZATION_ID, MEMBER_ID, {
        role: "ADMIN",
      }),
    ).rejects.toMatchObject({
      code: "LAST_ORGANIZATION_OWNER_REQUIRED",
    });
  });

  it("maps repository last-owner race protection during member removal", async () => {
    const repository = createRepository();
    repository.countActiveOwners.mockResolvedValue(2);
    repository.removeMember.mockRejectedValue(
      new LastOrganizationOwnerRequiredError(),
    );
    const service = new OrganizationService(
      repository,
      {} as UserRepository,
      {} as RateLimiterService,
    );

    await expect(
      service.removeMember(ACTOR_ID, ORGANIZATION_ID, MEMBER_ID),
    ).rejects.toMatchObject({
      code: "LAST_ORGANIZATION_OWNER_REQUIRED",
    });
  });
});

function createRepository() {
  return {
    addMember: vi.fn(),
    countActiveOwners: vi.fn(async () => 1),
    createWithOwner: vi.fn(),
    findAccessibleById: vi.fn(async () => ({
      organization: {
        id: ORGANIZATION_ID,
        code: "org",
        name: "Org",
        status: "ACTIVE" as const,
      },
      role: "OWNER" as const,
    })),
    findByCode: vi.fn(),
    findMemberById: vi.fn(async () => ({
      id: MEMBER_ID,
      organizationId: ORGANIZATION_ID,
      userId: ACTOR_ID,
      role: "OWNER" as const,
      status: "ACTIVE" as const,
      user: {
        id: ACTOR_ID,
        name: "Owner",
        status: "ACTIVE" as const,
        username: "owner",
      },
    })),
    findMemberByUserId: vi.fn(),
    listByUserId: vi.fn(),
    listMembers: vi.fn(),
    listSessionSpaceSummaries: vi.fn(),
    listSessionSummaries: vi.fn(),
    removeMember: vi.fn(),
    updateMember: vi.fn(),
    updateOrganization: vi.fn(),
  } satisfies Record<keyof OrganizationRepository, unknown> as OrganizationRepository & {
    countActiveOwners: ReturnType<typeof vi.fn>;
    removeMember: ReturnType<typeof vi.fn>;
    updateMember: ReturnType<typeof vi.fn>;
  };
}
