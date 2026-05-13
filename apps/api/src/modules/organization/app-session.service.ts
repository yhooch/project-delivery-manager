import { Inject, Injectable } from "@nestjs/common";
import type {
  AppSession,
  SessionOrganizationSummary,
  SessionSpaceSummary,
  SessionUser,
} from "@project-delivery/shared";

import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "./organization.repository";

@Injectable()
export class AppSessionService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
  ) {}

  async buildForUser(
    user: SessionUser,
    recentOrganizationId?: string,
    recentSpaceId?: string,
  ): Promise<AppSession> {
    const [organizations, spaces] = await Promise.all([
      this.organizations.listSessionSummaries(user.id),
      this.organizations.listSessionSpaceSummaries(user.id),
    ]);
    const defaultOrganization = chooseDefaultOrganization(
      organizations,
      spaces,
      recentOrganizationId,
      recentSpaceId,
    );
    const defaultSpace = chooseDefaultSpace(
      spaces,
      defaultOrganization?.id,
      recentSpaceId,
    );

    return {
      user,
      organizations,
      spaces,
      defaultOrganizationId: defaultOrganization?.id,
      defaultSpaceId: defaultSpace?.id,
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: organizations.some((organization) =>
          organization.status === "ACTIVE" &&
          (organization.role === "OWNER" || organization.role === "ADMIN")
        ),
      },
    };
  }
}

function chooseDefaultOrganization<
  TOrganization extends SessionOrganizationSummary,
>(
  organizations: TOrganization[],
  spaces: SessionSpaceSummary[],
  recentOrganizationId: string | undefined,
  recentSpaceId: string | undefined,
): TOrganization | undefined {
  if (recentOrganizationId) {
    const recent = organizations.find(
      (organization) => organization.id === recentOrganizationId,
    );

    if (recent) {
      return recent;
    }
  }

  if (recentSpaceId) {
    const recentSpace = spaces.find((space) => space.id === recentSpaceId);
    const organization = recentSpace
      ? organizations.find((item) => item.id === recentSpace.organizationId)
      : undefined;

    if (organization) {
      return organization;
    }
  }

  return organizations[0];
}

function chooseDefaultSpace(
  spaces: SessionSpaceSummary[],
  organizationId: string | undefined,
  recentSpaceId: string | undefined,
): SessionSpaceSummary | undefined {
  if (!organizationId) {
    return undefined;
  }

  const organizationSpaces = spaces.filter(
    (space) => space.organizationId === organizationId,
  );

  if (recentSpaceId) {
    const recent = organizationSpaces.find((space) => space.id === recentSpaceId);

    if (recent) {
      return recent;
    }
  }

  return organizationSpaces[0];
}
