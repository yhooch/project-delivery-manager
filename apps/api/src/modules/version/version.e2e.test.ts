import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  type Organization,
  type OrganizationMember,
  type OrganizationMemberWithUser,
  type OrganizationRole,
  type Space,
  type SpaceMember,
  type SpaceMemberWithUser,
  type SpaceRole,
  type Version,
  type VersionStatus,
} from "@project-delivery/shared";
import request from "supertest";
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { configureApp } from "../../main";
import {
  SESSION_REPOSITORY,
  USER_REPOSITORY,
} from "../identity/identity.repository";
import type {
  CreateIdentitySessionInput,
  CreateIdentityUserInput,
  IdentitySession,
  IdentitySessionWithUser,
  IdentityUser,
  PublicIdentityUser,
  SessionRevocationReason,
  UpdateUserPreferencesInput,
} from "../identity/identity.types";
import { ORGANIZATION_REPOSITORY } from "../organization/organization.repository";
import { SPACE_REPOSITORY } from "../space/space.repository";
import {
  VERSION_REPOSITORY,
  type VersionRepository,
} from "./version.repository";
import type {
  CreateVersionInput,
  UpdateVersionInput,
  VersionBoardInput,
  VersionBoardResult,
  VersionListInput,
  VersionListResult,
} from "./version.types";

const ORIGIN = "http://localhost:3000";

describe("version API", () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let organizations: InMemoryOrganizationRepository;
  let spaces: InMemorySpaceRepository;
  let versions: InMemoryVersionRepository;

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??=
      "postgresql://postgres:postgres@localhost:5432/project_delivery_manager";
    process.env["NODE_ENV"] = "test";
    process.env["SESSION_COOKIE_NAME"] = "pdm_session";
    process.env["WEB_APP_URL"] = ORIGIN;

    users = new InMemoryUserRepository();
    organizations = new InMemoryOrganizationRepository(users);
    spaces = new InMemorySpaceRepository(users, organizations);
    versions = new InMemoryVersionRepository();
    const sessions = new InMemorySessionRepository(users);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(USER_REPOSITORY)
      .useValue(users)
      .overrideProvider(SESSION_REPOSITORY)
      .useValue(sessions)
      .overrideProvider(ORGANIZATION_REPOSITORY)
      .useValue(organizations)
      .overrideProvider(SPACE_REPOSITORY)
      .useValue(spaces)
      .overrideProvider(VERSION_REPOSITORY)
      .useValue(versions)
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows SPACE_ADMIN and PM to create, update, and read versions", async () => {
    const ownerAgent = await registeredAgent("m1f_admin", "203.0.113.90");
    const pmAgent = await registeredAgent("m1f_pm", "203.0.113.91");
    const owner = getUser("m1f_admin");
    const pm = getUser("m1f_pm");
    const organization = organizations.createTestOrganization(
      owner.id,
      "M1F Versions",
      "m1f-versions",
    );
    organizations.addTestMember(organization.id, pm.id, "MEMBER");
    const space = spaces.createTestSpace(organization.id, owner.id, "Version Space");
    spaces.addTestMember(organization.id, space.id, pm.id, "PM");

    const createResponse = await createVersion(ownerAgent, space.id, {
      name: "M1 Release",
      target: "Deliver M1",
      description: "Core delivery milestone",
      ownerId: pm.id,
      status: "PLANNED",
      startDate: "2026-05-13T00:00:00.000Z",
      targetDate: "2026-06-01T00:00:00.000Z",
    }).expect(200);
    const version = createResponse.body.data as Version;

    expect(version).toMatchObject({
      organizationId: organization.id,
      spaceId: space.id,
      name: "M1 Release",
      target: "Deliver M1",
      description: "Core delivery milestone",
      ownerId: pm.id,
      status: "PLANNED",
      stats: {
        requirementCount: 0,
        taskCount: 0,
        bugCount: 0,
        blockedCount: 0,
      },
    });

    await listVersions(pmAgent, space.id)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(1);
        expect(body.data.items[0].id).toBe(version.id);
      });

    await patchVersion(pmAgent, version.id, {
      status: "IN_PROGRESS",
      releaseDate: "2026-06-10T00:00:00.000Z",
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.status).toBe("IN_PROGRESS");
        expect(body.data.releaseDate).toBe("2026-06-10T00:00:00.000Z");
      });

    await ownerAgent
      .get(`/api/v1/versions/${version.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: version.id,
          status: "IN_PROGRESS",
        });
      });
  });

  it("rejects non-space-member reads and VIEWER writes", async () => {
    const ownerAgent = await registeredAgent("m1f_access_owner", "203.0.113.92");
    const viewerAgent = await registeredAgent(
      "m1f_access_viewer",
      "203.0.113.93",
    );
    const outsiderAgent = await registeredAgent(
      "m1f_access_outsider",
      "203.0.113.94",
    );
    const owner = getUser("m1f_access_owner");
    const viewer = getUser("m1f_access_viewer");
    const outsider = getUser("m1f_access_outsider");
    const organization = organizations.createTestOrganization(
      owner.id,
      "M1F Access",
      "m1f-access",
    );
    organizations.addTestMember(organization.id, viewer.id, "MEMBER");
    organizations.addTestMember(organization.id, outsider.id, "MEMBER");
    const space = spaces.createTestSpace(organization.id, owner.id, "Access Space");
    spaces.addTestMember(organization.id, space.id, viewer.id, "VIEWER");
    const version = (
      await createVersion(ownerAgent, space.id, {
        name: "Access Version",
      })
    ).body.data as Version;

    await listVersions(outsiderAgent, space.id)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("SPACE_ACCESS_DENIED");
      });
    await outsiderAgent
      .get(`/api/v1/versions/${version.id}`)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("SPACE_ACCESS_DENIED");
      });
    await createVersion(viewerAgent, space.id, {
      name: "Viewer Write",
    }).expect(403);
    await patchVersion(viewerAgent, version.id, {
      target: "viewer cannot change",
    }).expect(403);
  });

  it("enforces version name uniqueness per space only", async () => {
    const ownerAgent = await registeredAgent("m1f_unique_owner", "203.0.113.95");
    const owner = getUser("m1f_unique_owner");
    const organization = organizations.createTestOrganization(
      owner.id,
      "M1F Unique",
      "m1f-unique",
    );
    const firstSpace = spaces.createTestSpace(
      organization.id,
      owner.id,
      "First Space",
    );
    const secondSpace = spaces.createTestSpace(
      organization.id,
      owner.id,
      "Second Space",
    );

    await createVersion(ownerAgent, firstSpace.id, {
      name: "Same Name",
    }).expect(200);
    await createVersion(ownerAgent, firstSpace.id, {
      name: "Same Name",
    })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("CONFLICT");
      });
    await createVersion(ownerAgent, secondSpace.id, {
      name: "Same Name",
    }).expect(200);
  });

  it("filters versions by status and owner", async () => {
    const ownerAgent = await registeredAgent("m1f_filter_owner", "203.0.113.96");
    const pmAgent = await registeredAgent("m1f_filter_pm", "203.0.113.97");
    const owner = getUser("m1f_filter_owner");
    const pm = getUser("m1f_filter_pm");
    const organization = organizations.createTestOrganization(
      owner.id,
      "M1F Filter",
      "m1f-filter",
    );
    organizations.addTestMember(organization.id, pm.id, "MEMBER");
    const space = spaces.createTestSpace(organization.id, owner.id, "Filter Space");
    spaces.addTestMember(organization.id, space.id, pm.id, "PM");

    const plannedForPm = (
      await createVersion(ownerAgent, space.id, {
        name: "Planned PM",
        ownerId: pm.id,
        status: "PLANNED",
      })
    ).body.data as Version;
    const progressForOwner = (
      await createVersion(ownerAgent, space.id, {
        name: "Progress Owner",
        ownerId: owner.id,
        status: "IN_PROGRESS",
      })
    ).body.data as Version;
    const progressForPm = (
      await createVersion(ownerAgent, space.id, {
        name: "Progress PM",
        ownerId: pm.id,
        status: "IN_PROGRESS",
      })
    ).body.data as Version;

    await listVersions(pmAgent, space.id, { status: "IN_PROGRESS" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items.map((item: Version) => item.id)).toEqual([
          progressForOwner.id,
          progressForPm.id,
        ]);
      });
    await listVersions(pmAgent, space.id, { ownerId: pm.id })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items.map((item: Version) => item.id)).toEqual([
          plannedForPm.id,
          progressForPm.id,
        ]);
      });
    await listVersions(pmAgent, space.id, {
      ownerId: pm.id,
      status: "IN_PROGRESS",
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items.map((item: Version) => item.id)).toEqual([
          progressForPm.id,
        ]);
      });
  });

  it("reports requirement count from version-linked requirement records", async () => {
    const ownerAgent = await registeredAgent("m1f_stats_owner", "203.0.113.98");
    const owner = getUser("m1f_stats_owner");
    const organization = organizations.createTestOrganization(
      owner.id,
      "M1F Stats",
      "m1f-stats",
    );
    const space = spaces.createTestSpace(organization.id, owner.id, "Stats Space");
    const version = (
      await createVersion(ownerAgent, space.id, {
        name: "Stats Version",
      })
    ).body.data as Version;

    versions.recordRequirement(version.id);
    versions.recordRequirement(version.id);

    await ownerAgent
      .get(`/api/v1/versions/${version.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.stats).toEqual({
          requirementCount: 2,
          taskCount: 0,
          bugCount: 0,
          blockedCount: 0,
        });
      });
    await listVersions(ownerAgent, space.id)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items[0].stats.requirementCount).toBe(2);
      });
  });

  it("requires ownerId to be an active member of the same space", async () => {
    const ownerAgent = await registeredAgent("m1f_owner_owner", "203.0.113.99");
    const candidateAgent = await registeredAgent(
      "m1f_owner_candidate",
      "203.0.113.100",
    );
    const owner = getUser("m1f_owner_owner");
    const candidate = getUser("m1f_owner_candidate");
    const organization = organizations.createTestOrganization(
      owner.id,
      "M1F Owner",
      "m1f-owner",
    );
    organizations.addTestMember(organization.id, candidate.id, "MEMBER");
    const space = spaces.createTestSpace(organization.id, owner.id, "Owner Space");

    await createVersion(ownerAgent, space.id, {
      name: "Bad Owner",
      ownerId: candidate.id,
    })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe("SPACE_MEMBER_NOT_FOUND");
      });

    await candidateAgent.get(`/api/v1/spaces/${space.id}/versions`).expect(403);
  });

  async function registeredAgent(username: string, ip: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/register")
      .set("Origin", ORIGIN)
      .set("x-forwarded-for", ip)
      .send({
        username,
        password: "password-123",
        confirmPassword: "password-123",
      })
      .expect(200);

    return agent;
  }

  function createVersion(
    agent: request.Agent,
    spaceId: string,
    body: {
      description?: string;
      name: string;
      ownerId?: string;
      releaseDate?: string;
      startDate?: string;
      status?: VersionStatus;
      target?: string;
      targetDate?: string;
    },
  ) {
    return agent
      .post(`/api/v1/spaces/${spaceId}/versions`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function listVersions(
    agent: request.Agent,
    spaceId: string,
    query: { ownerId?: string; status?: VersionStatus } = {},
  ) {
    return agent.get(`/api/v1/spaces/${spaceId}/versions`).query(query);
  }

  function patchVersion(
    agent: request.Agent,
    versionId: string,
    body: {
      description?: string;
      name?: string;
      ownerId?: string;
      releaseDate?: string;
      startDate?: string;
      status?: VersionStatus;
      target?: string;
      targetDate?: string;
    },
  ) {
    return agent
      .patch(`/api/v1/versions/${versionId}`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function getUser(username: string): IdentityUser {
    const user = users.getByUsername(username);

    if (!user) {
      throw new Error(`Missing test user ${username}`);
    }

    return user;
  }
});

class InMemoryUserRepository {
  private readonly users = new Map<string, IdentityUser>();

  async create(input: CreateIdentityUserInput): Promise<IdentityUser> {
    const user: IdentityUser = {
      id: input.id,
      username: input.username,
      passwordHash: input.passwordHash,
      name: input.name,
      status: "ACTIVE",
      locale: input.locale,
      themeMode: input.themeMode,
    };
    this.users.set(user.id, user);
    return user;
  }

  async findById(id: string): Promise<IdentityUser | undefined> {
    return this.users.get(id);
  }

  async findByUsername(username: string): Promise<IdentityUser | undefined> {
    return this.getByUsername(username);
  }

  getById(id: string): IdentityUser | undefined {
    return this.users.get(id);
  }

  getByUsername(username: string): IdentityUser | undefined {
    return [...this.users.values()].find((user) => user.username === username);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.get(userId);

    if (user) {
      user.passwordHash = passwordHash;
    }
  }

  async updatePreferences(
    userId: string,
    input: UpdateUserPreferencesInput,
  ): Promise<PublicIdentityUser> {
    const user = this.users.get(userId);

    if (!user) {
      throw new Error(`Missing test user ${userId}`);
    }

    user.locale = input.locale;
    user.themeMode = input.themeMode;
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }
}

class InMemorySessionRepository {
  private readonly records: IdentitySession[] = [];

  constructor(private readonly users: InMemoryUserRepository) {}

  async create(input: CreateIdentitySessionInput): Promise<IdentitySession> {
    const session: IdentitySession = {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      lastAccessedAt: new Date(),
    };
    this.records.push(session);
    return session;
  }

  async findValidByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<IdentitySessionWithUser | undefined> {
    const session = this.records.find(
      (record) =>
        record.tokenHash === tokenHash &&
        !record.revokedAt &&
        record.expiresAt > now,
    );
    const user = session ? await this.users.findById(session.userId) : undefined;

    return session && user && user.status === "ACTIVE"
      ? {
          session,
          user,
        }
      : undefined;
  }

  async revokeById(
    sessionId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<void> {
    const session = this.records.find((record) => record.id === sessionId);

    if (session && !session.revokedAt) {
      session.revokedAt = revokedAt;
      session.revocationReason = reason;
    }
  }

  async revokeActiveByUserId(
    userId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<void> {
    for (const session of this.records) {
      if (
        session.userId === userId &&
        !session.revokedAt &&
        session.expiresAt > revokedAt
      ) {
        session.revokedAt = revokedAt;
        session.revocationReason = reason;
      }
    }
  }

  async touch(sessionId: string, lastAccessedAt: Date): Promise<void> {
    const session = this.records.find((record) => record.id === sessionId);

    if (session) {
      session.lastAccessedAt = lastAccessedAt;
    }
  }
}

class InMemoryOrganizationRepository {
  private readonly members: OrganizationMember[] = [];
  private readonly organizations = new Map<string, Organization>();

  constructor(private readonly users: InMemoryUserRepository) {}

  createTestOrganization(
    ownerId: string,
    name: string,
    code: string,
  ): Organization {
    const organization: Organization = {
      id: ulid(),
      name,
      code,
      ownerId,
      status: "ACTIVE",
    };
    this.organizations.set(organization.id, organization);
    this.addTestMember(organization.id, ownerId, "OWNER");

    return organization;
  }

  addTestMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): OrganizationMember {
    const member: OrganizationMember = {
      id: ulid(),
      organizationId,
      userId,
      role,
      status: "ACTIVE",
    };
    this.members.push(member);

    return member;
  }

  async findAccessibleById(userId: string, organizationId: string) {
    const member = this.members.find(
      (item) =>
        item.organizationId === organizationId &&
        item.userId === userId &&
        item.status === "ACTIVE",
    );
    const organization = this.organizations.get(organizationId);

    return member && organization && organization.status === "ACTIVE"
      ? {
          organization,
          role: member.role,
        }
      : undefined;
  }

  async findMemberByUserId(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMemberWithUser | undefined> {
    const member = this.members.find(
      (item) => item.organizationId === organizationId && item.userId === userId,
    );

    return member ? this.toMemberWithUser(member) : undefined;
  }

  private toMemberWithUser(
    member: OrganizationMember,
  ): OrganizationMemberWithUser {
    const user = this.users.getById(member.userId);

    if (!user) {
      throw new Error(`Missing user ${member.userId}`);
    }

    return {
      ...member,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar: user.avatar,
        status: user.status,
      },
    };
  }
}

class InMemorySpaceRepository {
  private readonly members: SpaceMember[] = [];
  private readonly spaces = new Map<string, Space>();

  constructor(
    private readonly users: InMemoryUserRepository,
    private readonly organizations: InMemoryOrganizationRepository,
  ) {}

  createTestSpace(
    organizationId: string,
    ownerId: string,
    name: string,
  ): Space {
    const space: Space = {
      id: ulid(),
      organizationId,
      name,
      code: name.toLowerCase().replace(/[^a-z0-9]+/gu, "-"),
      ownerId,
      status: "ACTIVE",
      settings: {
        staleThresholdDays: 3,
      },
    };
    this.spaces.set(space.id, space);
    this.addTestMember(organizationId, space.id, ownerId, "SPACE_ADMIN");

    return space;
  }

  addTestMember(
    organizationId: string,
    spaceId: string,
    userId: string,
    role: SpaceRole,
  ): SpaceMember {
    const member: SpaceMember = {
      id: ulid(),
      organizationId,
      spaceId,
      userId,
      role,
      status: "ACTIVE",
    };
    this.members.push(member);

    return member;
  }

  async findAccessibleById(userId: string, spaceId: string) {
    const member = this.members.find(
      (item) =>
        item.spaceId === spaceId &&
        item.userId === userId &&
        item.status === "ACTIVE",
    );
    const space = this.spaces.get(spaceId);
    const organizationAccess = space
      ? await this.organizations.findAccessibleById(
          userId,
          space.organizationId,
        )
      : undefined;

    return member && space && space.status === "ACTIVE" && organizationAccess
      ? {
          space,
          role: member.role,
        }
      : undefined;
  }

  async findMemberByUserId(
    spaceId: string,
    userId: string,
  ): Promise<SpaceMemberWithUser | undefined> {
    const member = this.members.find(
      (item) => item.spaceId === spaceId && item.userId === userId,
    );

    return member ? this.toMemberWithUser(member) : undefined;
  }

  private toMemberWithUser(member: SpaceMember): SpaceMemberWithUser {
    const user = this.users.getById(member.userId);

    if (!user) {
      throw new Error(`Missing user ${member.userId}`);
    }

    return {
      ...member,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar: user.avatar,
        status: user.status,
      },
    };
  }
}

class InMemoryVersionRepository implements VersionRepository {
  private readonly requirementCounts = new Map<string, number>();
  private readonly versions = new Map<string, Version>();

  async create(input: CreateVersionInput): Promise<Version> {
    const version: Version = {
      id: input.id,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      name: input.name,
      target: input.target,
      description: input.description,
      ownerId: input.ownerId,
      status: input.status ?? "PLANNED",
      startDate: input.startDate?.toISOString(),
      targetDate: input.targetDate?.toISOString(),
      releaseDate: input.releaseDate?.toISOString(),
      stats: {
        requirementCount: 0,
        taskCount: 0,
        bugCount: 0,
        blockedCount: 0,
      },
    };
    this.versions.set(version.id, version);

    return this.withStats(version);
  }

  async findById(versionId: string): Promise<Version | undefined> {
    const version = this.versions.get(versionId);

    return version ? this.withStats(version) : undefined;
  }

  async findByName(
    spaceId: string,
    name: string,
  ): Promise<{ id: string } | undefined> {
    const version = [...this.versions.values()].find(
      (item) => item.spaceId === spaceId && item.name === name,
    );

    return version ? { id: version.id } : undefined;
  }

  async listBySpaceId(
    spaceId: string,
    input: VersionListInput,
  ): Promise<VersionListResult> {
    const items = [...this.versions.values()]
      .filter(
        (version) =>
          version.spaceId === spaceId &&
          (!input.ownerId || version.ownerId === input.ownerId) &&
          (!input.status || version.status === input.status),
      )
      .map((version) => this.withStats(version));

    return {
      items: items.slice(
        (input.page - 1) * input.pageSize,
        input.page * input.pageSize,
      ),
      page: input.page,
      pageSize: input.pageSize,
      total: items.length,
    };
  }

  async listBoard(input: VersionBoardInput): Promise<VersionBoardResult> {
    return {
      columns: [
        { statusCategory: "NOT_STARTED", title: "Not started", total: 0 },
        { statusCategory: "IN_PROGRESS", title: "In progress", total: 0 },
        { statusCategory: "WAITING", title: "Waiting", total: 0 },
        { statusCategory: "VERIFYING", title: "Verifying", total: 0 },
        { statusCategory: "DONE", title: "Done", total: 0 },
        { statusCategory: "TERMINATED", title: "Terminated", total: 0 },
      ],
      items: {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      },
    };
  }

  async update(input: UpdateVersionInput): Promise<Version | undefined> {
    const version = this.versions.get(input.versionId);

    if (!version) {
      return undefined;
    }

    const updated: Version = {
      ...version,
      name: input.name ?? version.name,
      target: input.target ?? version.target,
      description: input.description ?? version.description,
      ownerId: input.ownerId ?? version.ownerId,
      status: input.status ?? version.status,
      startDate: input.startDate?.toISOString() ?? version.startDate,
      targetDate: input.targetDate?.toISOString() ?? version.targetDate,
      releaseDate: input.releaseDate?.toISOString() ?? version.releaseDate,
    };
    this.versions.set(updated.id, updated);

    return this.withStats(updated);
  }

  recordRequirement(versionId: string): void {
    this.requirementCounts.set(
      versionId,
      (this.requirementCounts.get(versionId) ?? 0) + 1,
    );
  }

  private withStats(version: Version): Version {
    return {
      ...version,
      stats: {
        ...version.stats,
        requirementCount: this.requirementCounts.get(version.id) ?? 0,
      },
    };
  }
}
