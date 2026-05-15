import type {
  SessionOrganizationSummary,
  SessionSpaceSummary,
  SessionUser,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationRepository } from "./organization.repository";
import { AppSessionService } from "./app-session.service";

const user: SessionUser = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
  name: "demo",
  preferences: {
    locale: "zh-CN",
    themeMode: "SYSTEM",
  },
  status: "ACTIVE",
  username: "demo",
};

const firstOrganization: SessionOrganizationSummary = {
  code: "first",
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
  name: "First",
  role: "OWNER",
  status: "ACTIVE",
};

const secondOrganization: SessionOrganizationSummary = {
  code: "second",
  id: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
  name: "Second",
  role: "ADMIN",
  status: "ACTIVE",
};

const firstSpace: SessionSpaceSummary = {
  code: "first-space",
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAC",
  name: "First Space",
  organizationId: firstOrganization.id,
  role: "SPACE_ADMIN",
  status: "ACTIVE",
};

const secondSpace: SessionSpaceSummary = {
  code: "second-space",
  id: "01BRZ3NDEKTSV4RRFFQ69G5FAC",
  name: "Second Space",
  organizationId: secondOrganization.id,
  role: "SPACE_ADMIN",
  status: "ACTIVE",
};

describe("AppSessionService", () => {
  it("keeps defaultSpaceId inside the selected defaultOrganizationId", async () => {
    const service = new AppSessionService(
      createRepository({
        organizations: [firstOrganization, secondOrganization],
        spaces: [secondSpace, firstSpace],
      }),
    );

    const session = await service.buildForUser(
      user,
      firstOrganization.id,
      secondSpace.id,
    );

    expect(session.defaultOrganizationId).toBe(firstOrganization.id);
    expect(session.defaultSpaceId).toBe(firstSpace.id);
  });

  it("uses a valid recent space to infer the default organization", async () => {
    const service = new AppSessionService(
      createRepository({
        organizations: [firstOrganization, secondOrganization],
        spaces: [firstSpace, secondSpace],
      }),
    );

    const session = await service.buildForUser(user, undefined, secondSpace.id);

    expect(session.defaultOrganizationId).toBe(secondOrganization.id);
    expect(session.defaultSpaceId).toBe(secondSpace.id);
  });
});

function createRepository(input: {
  organizations: SessionOrganizationSummary[];
  spaces: SessionSpaceSummary[];
}): OrganizationRepository {
  return {
    listSessionSpaceSummaries: vi.fn(async () => input.spaces),
    listSessionSummaries: vi.fn(async () => input.organizations),
  } as unknown as OrganizationRepository;
}
