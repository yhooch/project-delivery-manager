import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
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
      createAuditService(),
    );

    await expect(
      service.updateMember(ACTOR_ID, ORGANIZATION_ID, MEMBER_ID, {
        role: "ADMIN",
      }),
    ).rejects.toMatchObject({
      code: "LAST_ORGANIZATION_OWNER_REQUIRED",
    });
  });

  it("writes access denied audit for non-manager member writes", async () => {
    const repository = createRepository();
    const audit = createAuditService();
    vi.mocked(repository.findAccessibleById).mockResolvedValueOnce({
      organization: {
        id: ORGANIZATION_ID,
        code: "org",
        name: "Org",
        status: "ACTIVE" as const,
      },
      role: "MEMBER" as const,
    });
    const service = new OrganizationService(
      repository,
      {} as UserRepository,
      {} as RateLimiterService,
      audit,
    );

    await expect(
      service.addMember(
        ACTOR_ID,
        ORGANIZATION_ID,
        { role: "MEMBER", username: "new-user" },
        { requestId: "req-org-denied" },
      ),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_ACCESS_DENIED",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "ACCESS_DENIED",
        actorId: ACTOR_ID,
        metadata: expect.objectContaining({
          operation: "addOrganizationMember",
          reason: "ROLE_NOT_ALLOWED",
          role: "MEMBER",
        }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-org-denied",
        targetId: ORGANIZATION_ID,
        targetType: "ORGANIZATION",
      }),
    );
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
    updateMember: vi.fn(),
    updateOrganization: vi.fn(),
  } satisfies Record<keyof OrganizationRepository, unknown> as OrganizationRepository & {
    countActiveOwners: ReturnType<typeof vi.fn>;
    updateMember: ReturnType<typeof vi.fn>;
  };
}

function createAuditService() {
  return {
    record: vi.fn(),
  } as unknown as AuditService;
}
