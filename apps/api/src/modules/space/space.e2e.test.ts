import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AppSessionSchema,
  type DefaultWorkflowSummary,
  type GetSpaceExceptionsViewResponse,
  type Organization,
  type OrganizationMember,
  type OrganizationMemberWithUser,
  type OrganizationRole,
  type RecordStatus,
  type SessionOrganizationSummary,
  type SessionSpaceSummary,
  type Space,
  type SpaceMember,
  type SpaceMemberWithUser,
  type SpaceOverviewStats,
  type SpaceRole,
  type SpaceSummary,
  type VersionSummary,
} from "@project-delivery/shared";
import request from "supertest";
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../app.module";
import { configureApp } from "../../main";
import {
  SESSION_REPOSITORY,
  USER_REPOSITORY,
  type SessionRepository,
  type UserRepository,
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
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import type {
  AddOrganizationMemberInput,
  CreateOrganizationInput,
  CreatedOrganizationWithOwner,
  OrganizationAccess,
  OrganizationListInput,
  OrganizationListResult,
  OrganizationMemberListInput,
  OrganizationMemberListResult,
  UpdateOrganizationMemberInput,
} from "../organization/organization.types";
import { WorkflowDefaultInitializerService } from "../workflow/workflow-default-initializer.service";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "./space.repository";
import type {
  AddSpaceMemberInput,
  CreateSpaceInput,
  CreatedSpaceWithAdmin,
  MyWorkbenchViewInput,
  SpaceAccess,
  SpaceExceptionsViewInput,
  SpaceListInput,
  SpaceListResult,
  SpaceMemberListInput,
  SpaceMemberListResult,
  SpaceOverviewViewInput,
  UpdateSpaceInput,
  UpdateSpaceMemberInput,
} from "./space.types";

const ORIGIN = "http://localhost:3000";

describe("space API", () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let organizations: InMemoryOrganizationRepository;
  let spaces: InMemorySpaceRepository;
  let workflowInitializer: FakeWorkflowDefaultInitializer;

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??=
      "postgresql://postgres:postgres@localhost:5432/project_delivery_manager";
    process.env["NODE_ENV"] = "test";
    process.env["SESSION_COOKIE_NAME"] = "pdm_session";
    process.env["WEB_APP_URL"] = ORIGIN;

    users = new InMemoryUserRepository();
    organizations = new InMemoryOrganizationRepository(users);
    spaces = new InMemorySpaceRepository(users, organizations);
    organizations.setSpaceRepository(spaces);
    workflowInitializer = new FakeWorkflowDefaultInitializer(spaces);
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
      .overrideProvider(WorkflowDefaultInitializerService)
      .useValue(workflowInitializer)
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a space, adds creator as SPACE_ADMIN, and initializes defaults", async () => {
    const ownerAgent = await registeredAgent("m1d_create_owner", "203.0.113.60");
    const organization = (
      await createOrganization(ownerAgent, "M1D Create", "m1d-create")
    ).body.data as Organization;

    const response = await createSpace(ownerAgent, organization.id, {
      name: "Delivery Space",
      code: "delivery",
    }).expect(200);
    const space = response.body.data as Space;
    const creator = users.getByUsername("m1d_create_owner");

    expect(space).toMatchObject({
      organizationId: organization.id,
      name: "Delivery Space",
      code: "delivery",
      ownerId: creator?.id,
      settings: {
        staleThresholdDays: 3,
      },
    });
    expect(spaces.members).toEqual([
      expect.objectContaining({
        organizationId: organization.id,
        role: "SPACE_ADMIN",
        spaceId: space.id,
        status: "ACTIVE",
        userId: creator?.id,
      }),
    ]);
    expect(workflowInitializer.calls).toContainEqual({
      actorUserId: creator?.id,
      organizationId: organization.id,
      spaceId: space.id,
    });

    await ownerAgent.get(`/api/v1/spaces/${space.id}`).expect(200);
    await ownerAgent
      .get(`/api/v1/spaces/${space.id}/members`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(1);
        expect(body.data.items[0]).toMatchObject({
          role: "SPACE_ADMIN",
          user: {
            username: "m1d_create_owner",
          },
        });
      });
    await ownerAgent
      .get(`/api/v1/views/spaces/${space.id}/overview`)
      .expect(200)
      .expect(({ body }) => {
        const overview = body.data;
        expect(overview.space.id).toBe(space.id);
        expect(
          (overview.defaultWorkflows as Array<{ code: string }>).map(
            (item) => item.code,
          ),
        ).toEqual(["DEVELOPMENT_TASK", "GENERAL_TASK", "BUG"]);
        expect(overview.filters).toMatchObject({
          organizationId: organization.id,
          spaceId: space.id,
        });
        expect(overview.recentActivities).toMatchObject({
          page: 1,
          pageSize: 20,
          total: 0,
        });
      });

    await ownerAgent
      .get(`/api/v1/views/my-workbench?organizationId=${organization.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.filters.organizationId).toBe(organization.id);
        expect(body.data.sections).toHaveProperty("myTodos");
        expect(body.data.sections).toHaveProperty("actionTodos");
      });
  });

  it("exposes the space exceptions view to read-only members", async () => {
    const ownerAgent = await registeredAgent("m4d_exception_owner", "203.0.113.160");
    const viewerAgent = await registeredAgent(
      "m4d_exception_viewer",
      "203.0.113.161",
    );
    const outsiderAgent = await registeredAgent(
      "m4d_exception_outsider",
      "203.0.113.162",
    );
    const organization = (
      await createOrganization(ownerAgent, "M4D Exceptions", "m4d-exceptions")
    ).body.data as Organization;
    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m4d_exception_viewer",
      role: "MEMBER",
    }).expect(200);
    const space = (
      await createSpace(ownerAgent, organization.id, {
        name: "Exception Space",
        code: "exception-space",
        staleThresholdDays: 5,
      })
    ).body.data as Space;
    await addSpaceMember(ownerAgent, space.id, {
      username: "m4d_exception_viewer",
      role: "VIEWER",
    }).expect(200);

    await viewerAgent
      .get(
        `/api/v1/views/spaces/${space.id}/exceptions?organizationId=${organization.id}&exceptionType=stale`,
      )
      .expect(200)
      .expect(({ body }) => {
        const data = body.data as GetSpaceExceptionsViewResponse;

        expect(data.filters).toMatchObject({
          organizationId: organization.id,
          spaceId: space.id,
          exceptionType: "stale",
        });
        expect(data.counts).toEqual([
          { exceptionType: "overdue", count: 0 },
          { exceptionType: "blocked", count: 0 },
          { exceptionType: "pending_confirm", count: 0 },
          { exceptionType: "pending_regression", count: 0 },
          { exceptionType: "stale", count: 0 },
        ]);
        expect(data.items).toMatchObject({
          page: 1,
          pageSize: 20,
          total: 0,
        });
      });

    await outsiderAgent
      .get(`/api/v1/views/spaces/${space.id}/exceptions`)
      .expect(403);
  });

  it("enforces code uniqueness inside one organization and allows reuse across organizations", async () => {
    const ownerA = await registeredAgent("m1d_code_owner_a", "203.0.113.61");
    const ownerB = await registeredAgent("m1d_code_owner_b", "203.0.113.62");
    const organizationA = (
      await createOrganization(ownerA, "M1D Code A", "m1d-code-a")
    ).body.data as Organization;
    const organizationB = (
      await createOrganization(ownerB, "M1D Code B", "m1d-code-b")
    ).body.data as Organization;

    await createSpace(ownerA, organizationA.id, {
      name: "Shared Code",
      code: "same-code",
    }).expect(200);
    await createSpace(ownerA, organizationA.id, {
      name: "Duplicate Code",
      code: "same-code",
    })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("CONFLICT");
      });
    await createSpace(ownerB, organizationB.id, {
      name: "Shared Code",
      code: "same-code",
    }).expect(200);
  });

  it("adds space members only from active members in the same organization", async () => {
    const ownerAgent = await registeredAgent("m1d_member_owner", "203.0.113.63");
    await registeredAgent("m1d_member_candidate", "203.0.113.64");
    const outsiderAgent = await registeredAgent(
      "m1d_member_other_org",
      "203.0.113.65",
    );
    const organization = (
      await createOrganization(ownerAgent, "M1D Members", "m1d-members")
    ).body.data as Organization;
    await createOrganization(outsiderAgent, "M1D Other", "m1d-other").expect(200);
    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1d_member_candidate",
      role: "MEMBER",
    }).expect(200);
    const space = (
      await createSpace(ownerAgent, organization.id, {
        name: "Member Space",
        code: "member-space",
      })
    ).body.data as Space;

    await addSpaceMember(ownerAgent, space.id, {
      username: "m1d_member_candidate",
      role: "PM",
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          organizationId: organization.id,
          role: "PM",
          spaceId: space.id,
          user: {
            username: "m1d_member_candidate",
          },
        });
      });

    await addSpaceMember(ownerAgent, space.id, {
      username: "m1d_member_other_org",
      role: "VIEWER",
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("SPACE_MEMBER_MUST_BELONG_TO_ORGANIZATION");
      });
  });

  it("rejects non-organization access and non-space-member access", async () => {
    const ownerAgent = await registeredAgent("m1d_access_owner", "203.0.113.66");
    const orgMemberAgent = await registeredAgent(
      "m1d_access_org_member",
      "203.0.113.67",
    );
    const outsiderAgent = await registeredAgent(
      "m1d_access_outsider",
      "203.0.113.68",
    );
    const organization = (
      await createOrganization(ownerAgent, "M1D Access", "m1d-access")
    ).body.data as Organization;
    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1d_access_org_member",
      role: "MEMBER",
    }).expect(200);
    const space = (
      await createSpace(ownerAgent, organization.id, {
        name: "Access Space",
        code: "access-space",
      })
    ).body.data as Space;

    await outsiderAgent
      .get(`/api/v1/organizations/${organization.id}/spaces`)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_ACCESS_DENIED");
      });
    await orgMemberAgent
      .get(`/api/v1/organizations/${organization.id}/spaces`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items).toEqual([]);
        expect(body.data.total).toBe(0);
      });
    await orgMemberAgent
      .get(`/api/v1/spaces/${space.id}`)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("SPACE_ACCESS_DENIED");
      });
    await addSpaceMember(ownerAgent, space.id, {
      username: "m1d_access_org_member",
      role: "VIEWER",
    }).expect(200);
    await orgMemberAgent
      .get(`/api/v1/organizations/${organization.id}/spaces`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items).toEqual([
          expect.objectContaining({
            id: space.id,
          }),
        ]);
        expect(body.data.total).toBe(1);
      });
  });

  it("allows SPACE_ADMIN and PM to manage settings and members, but rejects VIEWER writes", async () => {
    const ownerAgent = await registeredAgent("m1d_role_owner", "203.0.113.69");
    const pmAgent = await registeredAgent("m1d_role_pm", "203.0.113.70");
    const viewerAgent = await registeredAgent("m1d_role_viewer", "203.0.113.71");
    await registeredAgent("m1d_role_dev", "203.0.113.72");
    const organization = (
      await createOrganization(ownerAgent, "M1D Roles", "m1d-roles")
    ).body.data as Organization;
    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1d_role_pm",
      role: "MEMBER",
    }).expect(200);
    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1d_role_viewer",
      role: "MEMBER",
    }).expect(200);
    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1d_role_dev",
      role: "MEMBER",
    }).expect(200);
    const space = (
      await createSpace(ownerAgent, organization.id, {
        name: "Role Space",
        code: "role-space",
      })
    ).body.data as Space;
    await addSpaceMember(ownerAgent, space.id, {
      username: "m1d_role_pm",
      role: "PM",
    }).expect(200);
    await addSpaceMember(ownerAgent, space.id, {
      username: "m1d_role_viewer",
      role: "VIEWER",
    }).expect(200);

    await patchSpace(viewerAgent, space.id, {
      staleThresholdDays: 8,
    })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("SPACE_ACCESS_DENIED");
      });
    await addSpaceMember(viewerAgent, space.id, {
      username: "m1d_role_dev",
      role: "DEVELOPER",
    }).expect(403);

    await patchSpace(pmAgent, space.id, {
      staleThresholdDays: 9,
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.settings.staleThresholdDays).toBe(9);
      });
    const devMember = (
      await addSpaceMember(pmAgent, space.id, {
        username: "m1d_role_dev",
        role: "DEVELOPER",
      }).expect(200)
    ).body.data as SpaceMemberWithUser;

    await patchSpaceMember(pmAgent, space.id, devMember.id, {
      status: "DISABLED",
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: devMember.id,
          status: "DISABLED",
        });
      });
  });

  it("keeps AppSession default organization and space consistent", async () => {
    const agent = await registeredAgent("m1d_session_user", "203.0.113.73");
    const organizationA = (
      await createOrganization(agent, "M1D Session A", "m1d-session-a")
    ).body.data as Organization;
    const spaceA = (
      await createSpace(agent, organizationA.id, {
        name: "Session A",
        code: "session-a",
      })
    ).body.data as Space;
    const organizationB = (
      await createOrganization(agent, "M1D Session B", "m1d-session-b")
    ).body.data as Organization;
    const spaceB = (
      await createSpace(agent, organizationB.id, {
        name: "Session B",
        code: "session-b",
      })
    ).body.data as Space;

    await agent
      .get(
        `/api/v1/auth/session?recentOrganizationId=${organizationB.id}&recentSpaceId=${spaceA.id}`,
      )
      .expect(200)
      .expect(({ body }) => {
        const appSession = AppSessionSchema.parse(body.data);
        expect(appSession.spaces.map((space) => space.id)).toEqual([
          spaceA.id,
          spaceB.id,
        ]);
        expect(appSession.defaultOrganizationId).toBe(organizationB.id);
        expect(appSession.defaultSpaceId).toBe(spaceB.id);
      });

    await agent
      .get(`/api/v1/auth/session?recentSpaceId=${spaceA.id}`)
      .expect(200)
      .expect(({ body }) => {
        const appSession = AppSessionSchema.parse(body.data);
        expect(appSession.defaultOrganizationId).toBe(organizationA.id);
        expect(appSession.defaultSpaceId).toBe(spaceA.id);
      });
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

  function createOrganization(
    agent: request.Agent,
    name: string,
    code: string,
  ) {
    return agent
      .post("/api/v1/organizations")
      .set("Origin", ORIGIN)
      .send({
        name,
        code,
      });
  }

  function addOrganizationMember(
    agent: request.Agent,
    organizationId: string,
    body: { role: OrganizationRole; userId?: string; username?: string },
  ) {
    return agent
      .post(`/api/v1/organizations/${organizationId}/members`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function createSpace(
    agent: request.Agent,
    organizationId: string,
    body: {
      code: string;
      description?: string;
      name: string;
      ownerId?: string;
      staleThresholdDays?: number;
    },
  ) {
    return agent
      .post(`/api/v1/organizations/${organizationId}/spaces`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function patchSpace(
    agent: request.Agent,
    spaceId: string,
    body: {
      code?: string;
      description?: string;
      name?: string;
      ownerId?: string;
      staleThresholdDays?: number;
      status?: RecordStatus;
    },
  ) {
    return agent
      .patch(`/api/v1/spaces/${spaceId}`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function addSpaceMember(
    agent: request.Agent,
    spaceId: string,
    body: { role: SpaceRole; userId?: string; username?: string },
  ) {
    return agent
      .post(`/api/v1/spaces/${spaceId}/members`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function patchSpaceMember(
    agent: request.Agent,
    spaceId: string,
    memberId: string,
    body: { role?: SpaceRole; status?: RecordStatus },
  ) {
    return agent
      .patch(`/api/v1/spaces/${spaceId}/members/${memberId}`)
      .set("Origin", ORIGIN)
      .send(body);
  }
});

class InMemoryUserRepository implements UserRepository {
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

class InMemorySessionRepository implements SessionRepository {
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

class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly members: OrganizationMember[] = [];
  private readonly organizations = new Map<string, Organization>();
  private spaceRepository?: InMemorySpaceRepository;

  constructor(private readonly users: InMemoryUserRepository) {}

  setSpaceRepository(spaceRepository: InMemorySpaceRepository): void {
    this.spaceRepository = spaceRepository;
  }

  async createWithOwner(
    input: CreateOrganizationInput,
  ): Promise<CreatedOrganizationWithOwner> {
    const organization: Organization = {
      id: input.id,
      name: input.name,
      code: input.code,
      ownerId: input.ownerId,
      status: "ACTIVE",
    };
    const ownerMembership: OrganizationMember = {
      id: input.memberId,
      organizationId: input.id,
      userId: input.ownerId,
      role: "OWNER",
      status: "ACTIVE",
    };
    this.organizations.set(organization.id, organization);
    this.members.push(ownerMembership);

    return {
      organization,
      ownerMembership,
    };
  }

  async addMember(
    input: AddOrganizationMemberInput,
  ): Promise<OrganizationMemberWithUser> {
    const member: OrganizationMember = {
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      status: "ACTIVE",
    };
    this.members.push(member);

    return this.toMemberWithUser(member);
  }

  async countActiveOwners(organizationId: string): Promise<number> {
    return this.members.filter(
      (member) =>
        member.organizationId === organizationId &&
        member.role === "OWNER" &&
        member.status === "ACTIVE",
    ).length;
  }

  async findAccessibleById(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationAccess | undefined> {
    const member = this.members.find(
      (item) =>
        item.userId === userId &&
        item.organizationId === organizationId &&
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

  async findByCode(code: string): Promise<{ id: string } | undefined> {
    const organization = [...this.organizations.values()].find(
      (item) => item.code === code,
    );

    return organization ? { id: organization.id } : undefined;
  }

  async findMemberById(
    organizationId: string,
    memberId: string,
  ): Promise<OrganizationMemberWithUser | undefined> {
    const member = this.members.find(
      (item) => item.organizationId === organizationId && item.id === memberId,
    );

    return member ? this.toMemberWithUser(member) : undefined;
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

  async listByUserId(
    userId: string,
    input: OrganizationListInput,
  ): Promise<OrganizationListResult> {
    const organizations = this.accessibleOrganizations(userId);

    return {
      items: organizations.slice(
        (input.page - 1) * input.pageSize,
        input.page * input.pageSize,
      ),
      total: organizations.length,
    };
  }

  async listMembers(
    organizationId: string,
    input: OrganizationMemberListInput,
  ): Promise<OrganizationMemberListResult> {
    const members = this.members.filter(
      (member) =>
        member.organizationId === organizationId &&
        (!input.role || member.role === input.role) &&
        (!input.status || member.status === input.status),
    );

    return {
      items: members
        .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
        .map((member) => this.toMemberWithUser(member)),
      total: members.length,
    };
  }

  async listSessionSummaries(
    userId: string,
  ): Promise<SessionOrganizationSummary[]> {
    return this.accessibleOrganizations(userId).map((organization) => {
      const member = this.members.find(
        (item) =>
          item.organizationId === organization.id &&
          item.userId === userId &&
          item.status === "ACTIVE",
      );

      if (!member) {
        throw new Error(`Missing organization member for ${organization.id}`);
      }

      return {
        id: organization.id,
        name: organization.name,
        code: organization.code,
        role: member.role,
        status: organization.status,
      };
    });
  }

  async listSessionSpaceSummaries(
    userId: string,
  ): Promise<SessionSpaceSummary[]> {
    return this.spaceRepository?.listSessionSummaries(userId) ?? [];
  }

  async updateMember(
    input: UpdateOrganizationMemberInput,
  ): Promise<OrganizationMemberWithUser | undefined> {
    const member = this.members.find(
      (item) =>
        item.organizationId === input.organizationId &&
        item.id === input.memberId,
    );

    if (!member) {
      return undefined;
    }

    member.role = input.role ?? member.role;
    member.status = input.status ?? member.status;

    return this.toMemberWithUser(member);
  }

  async updateOrganization(input: {
    organizationId: string;
    name?: string;
    code?: string;
    status?: RecordStatus;
  }): Promise<Organization | undefined> {
    const organization = this.organizations.get(input.organizationId);
    if (!organization) {
      return undefined;
    }
    if (input.name !== undefined) organization.name = input.name;
    if (input.code !== undefined) organization.code = input.code;
    if (input.status !== undefined) organization.status = input.status;
    return organization;
  }

  private accessibleOrganizations(userId: string): Organization[] {
    return this.members
      .filter((member) => member.userId === userId && member.status === "ACTIVE")
      .map((member) => {
        const organization = this.organizations.get(member.organizationId);

        if (!organization) {
          throw new Error(`Missing organization ${member.organizationId}`);
        }

        return organization;
      })
      .filter((organization) => organization.status === "ACTIVE");
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

class InMemorySpaceRepository implements SpaceRepository {
  readonly members: SpaceMember[] = [];
  private readonly defaultWorkflows = new Map<string, DefaultWorkflowSummary[]>();
  private readonly spaces = new Map<string, Space>();

  constructor(
    private readonly users: InMemoryUserRepository,
    private readonly organizations: InMemoryOrganizationRepository,
  ) {}

  async createWithAdmin(input: CreateSpaceInput): Promise<CreatedSpaceWithAdmin> {
    const space: Space = {
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      code: input.code,
      description: input.description,
      ownerId: input.ownerId,
      status: "ACTIVE",
      settings: {
        staleThresholdDays: input.staleThresholdDays,
      },
    };
    const adminMembership: SpaceMember = {
      id: input.adminMemberId,
      organizationId: input.organizationId,
      spaceId: input.id,
      userId: input.actorUserId,
      role: "SPACE_ADMIN",
      status: "ACTIVE",
    };
    this.spaces.set(space.id, space);
    this.members.push(adminMembership);

    return {
      space,
      adminMembership,
    };
  }

  async addMember(input: AddSpaceMemberInput): Promise<SpaceMemberWithUser> {
    const member: SpaceMember = {
      id: input.id,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      userId: input.userId,
      role: input.role,
      status: "ACTIVE",
    };
    this.members.push(member);

    return this.toMemberWithUser(member);
  }

  async findAccessibleById(
    userId: string,
    spaceId: string,
  ): Promise<SpaceAccess | undefined> {
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

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<{ id: string } | undefined> {
    const space = [...this.spaces.values()].find(
      (item) => item.organizationId === organizationId && item.code === code,
    );

    return space ? { id: space.id } : undefined;
  }

  async findMemberById(
    spaceId: string,
    memberId: string,
  ): Promise<SpaceMemberWithUser | undefined> {
    const member = this.members.find(
      (item) => item.spaceId === spaceId && item.id === memberId,
    );

    return member ? this.toMemberWithUser(member) : undefined;
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

  async getMyWorkbenchView(input: MyWorkbenchViewInput) {
    const emptyWorkItems = {
      items: [],
      page: input.page,
      pageSize: input.pageSize,
      total: 0,
    };
    const emptyActionTodos = {
      items: [],
      page: input.page,
      pageSize: input.pageSize,
      total: 0,
    };

    return {
      filters: {
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        versionId: input.versionId,
      },
      stats: {
        assignedWorkItemCount: 0,
        actionTodoCount: 0,
        overdueCount: 0,
        blockedCount: 0,
        pendingConfirmCount: 0,
        pendingRegressionCount: 0,
        staleCount: 0,
      },
      sections: {
        myTodos: {
          title: "我的待办",
          total: 0,
          items: emptyWorkItems,
        },
        assignedTasks: {
          title: "我负责的任务",
          total: 0,
          items: emptyWorkItems,
        },
        assignedBugs: {
          title: "我负责的 Bug",
          total: 0,
          items: emptyWorkItems,
        },
        actionTodos: {
          title: "待我处理的流程动作",
          total: 0,
          items: emptyActionTodos,
        },
        pendingConfirm: {
          title: "待我确认",
          total: 0,
          items: emptyWorkItems,
        },
        dueSoon: {
          title: "即将到期",
          total: 0,
          items: emptyWorkItems,
        },
        blocked: {
          title: "阻塞中",
          total: 0,
          items: emptyWorkItems,
        },
        recentActivities: {
          title: "最近动态",
          total: 0,
          items: {
            items: [],
            page: input.page,
            pageSize: input.pageSize,
            total: 0,
          },
        },
      },
      actionTodos: emptyActionTodos,
    };
  }

  async getSpaceOverviewView(input: SpaceOverviewViewInput) {
    const [stats, currentVersion, defaultWorkflows] = await Promise.all([
      this.getOverviewStats(input.space.id),
      this.findCurrentVersion(input.space.id),
      this.listDefaultWorkflows(input.space.id),
    ]);

    return {
      space: input.space,
      currentVersion,
      stats,
      defaultWorkflows,
      filters: {
        organizationId: input.space.organizationId,
        spaceId: input.space.id,
        versionId: input.versionId,
      },
      statusCounts: [],
      workItemTypeCounts: [],
      exceptionCounts: [],
      recentActivities: {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      },
      staleThresholdDays: input.space.settings.staleThresholdDays,
    };
  }

  async getSpaceExceptionsView(
    input: SpaceExceptionsViewInput,
  ): Promise<GetSpaceExceptionsViewResponse> {
    return {
      filters: {
        organizationId: input.space.organizationId,
        spaceId: input.space.id,
        versionId: input.versionId,
        assigneeId: input.assigneeId,
        statusCategory: input.statusCategory,
        workItemType: input.workItemType,
        exceptionType: input.exceptionType,
      },
      counts: [
        { exceptionType: "overdue", count: 0 },
        { exceptionType: "blocked", count: 0 },
        { exceptionType: "pending_confirm", count: 0 },
        { exceptionType: "pending_regression", count: 0 },
        { exceptionType: "stale", count: 0 },
      ],
      items: {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      },
    };
  }

  async getOverviewStats(_spaceId: string): Promise<SpaceOverviewStats> {
    return {
      versionCount: 0,
      requirementCount: 0,
      taskCount: 0,
      completedTaskCount: 0,
      bugCount: 0,
      openBugCount: 0,
      blockedCount: 0,
      overdueCount: 0,
    };
  }

  async findCurrentVersion(_spaceId: string): Promise<VersionSummary | undefined> {
    return undefined;
  }

  async listByOrganizationId(
    organizationId: string,
    input: SpaceListInput,
    accessibleByUserId?: string,
  ): Promise<SpaceListResult> {
    const items = [...this.spaces.values()]
      .filter(
        (space) =>
          space.organizationId === organizationId &&
          (!accessibleByUserId ||
            this.members.some(
              (member) =>
                member.spaceId === space.id &&
                member.userId === accessibleByUserId &&
                member.status === "ACTIVE",
            )) &&
          (!input.status || space.status === input.status),
      )
      .map(toSpaceSummary);

    return {
      items: items.slice(
        (input.page - 1) * input.pageSize,
        input.page * input.pageSize,
      ),
      total: items.length,
    };
  }

  async listDefaultWorkflows(spaceId: string): Promise<DefaultWorkflowSummary[]> {
    return this.defaultWorkflows.get(spaceId) ?? [];
  }

  async listMembers(
    spaceId: string,
    input: SpaceMemberListInput,
  ): Promise<SpaceMemberListResult> {
    const members = this.members.filter(
      (member) =>
        member.spaceId === spaceId &&
        (!input.role || member.role === input.role) &&
        (!input.status || member.status === input.status),
    );

    return {
      items: members
        .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
        .map((member) => this.toMemberWithUser(member)),
      page: input.page,
      pageSize: input.pageSize,
      total: members.length,
    };
  }

  async update(input: UpdateSpaceInput): Promise<Space | undefined> {
    const space = this.spaces.get(input.spaceId);

    if (!space) {
      return undefined;
    }

    space.name = input.name ?? space.name;
    space.code = input.code ?? space.code;
    space.description = input.description ?? space.description;
    space.ownerId = input.ownerId ?? space.ownerId;
    space.status = input.status ?? space.status;
    space.settings.staleThresholdDays =
      input.staleThresholdDays ?? space.settings.staleThresholdDays;

    return space;
  }

  async updateMember(
    input: UpdateSpaceMemberInput,
  ): Promise<SpaceMemberWithUser | undefined> {
    const member = this.members.find(
      (item) => item.spaceId === input.spaceId && item.id === input.memberId,
    );

    if (!member) {
      return undefined;
    }

    member.role = input.role ?? member.role;
    member.status = input.status ?? member.status;

    return this.toMemberWithUser(member);
  }

  listSessionSummaries(userId: string): SessionSpaceSummary[] {
    return this.members
      .filter((member) => member.userId === userId && member.status === "ACTIVE")
      .flatMap((member) => {
        const space = this.spaces.get(member.spaceId);

        if (!space || space.status !== "ACTIVE") {
          return [];
        }

        return [
          {
            id: space.id,
            name: space.name,
            code: space.code,
            organizationId: space.organizationId,
            role: member.role,
            status: space.status,
          },
        ];
      });
  }

  recordDefaultWorkflows(
    spaceId: string,
    summaries: DefaultWorkflowSummary[],
  ): void {
    this.defaultWorkflows.set(spaceId, summaries);
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

class FakeWorkflowDefaultInitializer {
  readonly calls: Array<{
    actorUserId: string;
    organizationId: string;
    spaceId: string;
  }> = [];

  constructor(private readonly spaces: InMemorySpaceRepository) {}

  async initializeDefaultWorkflowsForSpace(input: {
    actorUserId: string;
    organizationId: string;
    spaceId: string;
  }): Promise<DefaultWorkflowSummary[]> {
    this.calls.push(input);
    const summaries = createDefaultWorkflowSummaries();
    this.spaces.recordDefaultWorkflows(input.spaceId, summaries);

    return summaries;
  }

  async initializeDefaultWorkflowsForSpaceInTransaction(
    _tx: unknown,
    input: {
      actorUserId: string;
      organizationId: string;
      spaceId: string;
    },
  ): Promise<DefaultWorkflowSummary[]> {
    return this.initializeDefaultWorkflowsForSpace(input);
  }
}

function createDefaultWorkflowSummaries(): DefaultWorkflowSummary[] {
  return [
    {
      workflowId: ulid(),
      workflowVersionId: ulid(),
      code: "DEVELOPMENT_TASK",
      name: "开发任务默认流程",
      workItemType: "TASK",
      version: 1,
      stateCount: 7,
      actionCount: 8,
      isDefault: false,
      publishedAt: new Date().toISOString(),
    },
    {
      workflowId: ulid(),
      workflowVersionId: ulid(),
      code: "GENERAL_TASK",
      name: "通用任务默认流程",
      workItemType: "TASK",
      version: 1,
      stateCount: 5,
      actionCount: 5,
      isDefault: true,
      publishedAt: new Date().toISOString(),
    },
    {
      workflowId: ulid(),
      workflowVersionId: ulid(),
      code: "BUG",
      name: "Bug 默认流程",
      workItemType: "BUG",
      version: 1,
      stateCount: 7,
      actionCount: 8,
      isDefault: true,
      publishedAt: new Date().toISOString(),
    },
  ];
}

function toSpaceSummary(space: Space): SpaceSummary {
  return {
    id: space.id,
    organizationId: space.organizationId,
    name: space.name,
    code: space.code,
    description: space.description,
    ownerId: space.ownerId,
    status: space.status,
  };
}
