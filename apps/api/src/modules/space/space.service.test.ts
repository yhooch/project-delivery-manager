import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
import type { UserRepository } from "../identity/identity.repository";
import type { OrganizationRepository } from "../organization/organization.repository";
import type { WorkflowDefaultInitializerService } from "../workflow/workflow-default-initializer.service";
import type { SpaceRepository } from "./space.repository";
import { SpaceService } from "./space.service";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const MEMBER_ID = "01H00000000000000000000003";
const TARGET_USER_ID = "01H00000000000000000000004";

describe("SpaceService", () => {
  it("does not reactivate a space member whose organization membership is disabled", async () => {
    const spaces = createSpaceRepository();
    const organizations = createOrganizationRepository();
    const service = new SpaceService(
      spaces,
      organizations,
      {} as UserRepository,
      {} as WorkflowDefaultInitializerService,
      createAuditService(),
    );

    await expect(
      service.updateMember(ACTOR_ID, SPACE_ID, MEMBER_ID, {
        role: "TESTER",
      }),
    ).rejects.toMatchObject({
      code: "SPACE_MEMBER_MUST_BELONG_TO_ORGANIZATION",
    });
    expect(spaces.updateMember).not.toHaveBeenCalled();
  });
});

function createSpaceRepository() {
  return {
    addMember: vi.fn(),
    createWithAdmin: vi.fn(),
    findAccessibleById: vi.fn(async () => ({
      role: "PM" as const,
      space: {
        id: SPACE_ID,
        code: "space",
        name: "Space",
        organizationId: ORGANIZATION_ID,
        settings: {
          staleThresholdDays: 3,
        },
        status: "ACTIVE" as const,
      },
    })),
    findByCode: vi.fn(),
    findCurrentVersion: vi.fn(),
    findMemberById: vi.fn(async () => ({
      id: MEMBER_ID,
      organizationId: ORGANIZATION_ID,
      role: "DEVELOPER" as const,
      spaceId: SPACE_ID,
      status: "ACTIVE" as const,
      userId: TARGET_USER_ID,
      user: {
        id: TARGET_USER_ID,
        name: "Target",
        status: "ACTIVE" as const,
        username: "target",
      },
    })),
    findMemberByUserId: vi.fn(),
    getMyWorkbenchView: vi.fn(),
    getSpaceExceptionsView: vi.fn(),
    getSpaceOverviewView: vi.fn(),
    listByOrganizationId: vi.fn(),
    listDefaultWorkflows: vi.fn(),
    listMembers: vi.fn(),
    update: vi.fn(),
    updateMember: vi.fn(),
  } satisfies Record<keyof SpaceRepository, unknown> as SpaceRepository & {
    updateMember: ReturnType<typeof vi.fn>;
  };
}

function createOrganizationRepository() {
  return {
    addMember: vi.fn(),
    countActiveOwners: vi.fn(),
    createWithOwner: vi.fn(),
    findAccessibleById: vi.fn(),
    findByCode: vi.fn(),
    findMemberById: vi.fn(),
    findMemberByUserId: vi.fn(async () => ({
      id: "01H00000000000000000000005",
      organizationId: ORGANIZATION_ID,
      role: "MEMBER" as const,
      status: "DISABLED" as const,
      userId: TARGET_USER_ID,
      user: {
        id: TARGET_USER_ID,
        name: "Target",
        status: "ACTIVE" as const,
        username: "target",
      },
    })),
    listByUserId: vi.fn(),
    listMembers: vi.fn(),
    listSessionSpaceSummaries: vi.fn(),
    listSessionSummaries: vi.fn(),
    updateMember: vi.fn(),
    updateOrganization: vi.fn(),
  } satisfies Record<keyof OrganizationRepository, unknown> as OrganizationRepository;
}

function createAuditService() {
  return {
    record: vi.fn(),
  } as unknown as AuditService;
}
