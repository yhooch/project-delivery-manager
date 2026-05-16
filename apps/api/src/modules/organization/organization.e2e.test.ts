import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AppSessionSchema,
  RecentOrganizationCookieName,
  type Organization,
  type OrganizationMember,
  type OrganizationMemberWithUser,
  type RecordStatus,
  type SessionOrganizationSummary,
  type SessionSpaceSummary,
} from "@project-delivery/shared";
import request from "supertest";
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
  LastOrganizationOwnerRequiredError,
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "./organization.repository";
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
} from "./organization.types";

const ORIGIN = "http://localhost:3000";

describe("organization and AppSession API", () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let organizations: InMemoryOrganizationRepository;

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??=
      "postgresql://postgres:postgres@localhost:5432/project_delivery_manager";
    process.env["NODE_ENV"] = "test";
    process.env["SESSION_COOKIE_NAME"] = "pdm_session";
    process.env["WEB_APP_URL"] = ORIGIN;

    users = new InMemoryUserRepository();
    organizations = new InMemoryOrganizationRepository(users);
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
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns an empty organization AppSession for a new user", async () => {
    const agent = await registeredAgent("empty_org_user", "203.0.113.31");
    const response = await agent.get("/api/v1/auth/session").expect(200);
    const appSession = AppSessionSchema.parse(response.body.data);

    expect(appSession.organizations).toEqual([]);
    expect(appSession.spaces).toEqual([]);
    expect(appSession.defaultOrganizationId).toBeUndefined();
    expect(appSession.defaultSpaceId).toBeUndefined();
    expect(appSession.capabilities).toEqual({
      canCreateOrganization: true,
      canCreateSpace: false,
    });
  });

  it("creates an organization, initializes OWNER, and returns it in AppSession", async () => {
    const agent = await registeredAgent("owner_user", "203.0.113.32");
    const createResponse = await createOrganization(agent, "Alpha Team", "alpha")
      .expect(200);
    const organization = createResponse.body.data as Organization;
    const owner = organizations.members.find(
      (member) => member.organizationId === organization.id,
    );

    expect(owner).toMatchObject({
      role: "OWNER",
      userId: users.getByUsername("owner_user")?.id,
    });

    const sessionResponse = await agent.get("/api/v1/auth/session").expect(200);
    const appSession = AppSessionSchema.parse(sessionResponse.body.data);

    expect(appSession.organizations).toEqual([
      {
        id: organization.id,
        name: "Alpha Team",
        code: "alpha",
        role: "OWNER",
        status: "ACTIVE",
      },
    ]);
    expect(appSession.defaultOrganizationId).toBe(organization.id);
    expect(appSession.capabilities.canCreateSpace).toBe(true);
  });

  it("lists and gets only organizations accessible to the current user", async () => {
    const agent = await registeredAgent("list_user", "203.0.113.33");
    const createResponse = await createOrganization(agent, "List Org", "list-org")
      .expect(200);
    const organization = createResponse.body.data as Organization;

    await agent
      .get("/api/v1/organizations")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(1);
        expect(body.data.items[0]).toMatchObject({
          id: organization.id,
          code: "list-org",
        });
      });

    await agent
      .get(`/api/v1/organizations/${organization.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: organization.id,
          name: "List Org",
        });
      });
  });

  it("uses a validated recentOrganizationId cookie as the default organization", async () => {
    const agent = await registeredAgent("multi_org_user", "203.0.113.34");
    const first = (await createOrganization(agent, "First Org", "first-org"))
      .body.data as Organization;
    const second = (await createOrganization(agent, "Second Org", "second-org"))
      .body.data as Organization;

    await agent
      .get("/api/v1/auth/session")
      .set("Cookie", `${RecentOrganizationCookieName}=${second.id}`)
      .expect(200)
      .expect(({ body }) => {
        const appSession = AppSessionSchema.parse(body.data);
        expect(appSession.organizations.map((item) => item.id)).toEqual([
          first.id,
          second.id,
        ]);
        expect(appSession.defaultOrganizationId).toBe(second.id);
      });
  });

  it("falls back when recentOrganizationId is invalid or inaccessible", async () => {
    const agent = await registeredAgent("fallback_user", "203.0.113.35");
    const first = (await createOrganization(agent, "Fallback One", "fallback-one"))
      .body.data as Organization;
    await createOrganization(agent, "Fallback Two", "fallback-two").expect(200);

    await agent
      .get("/api/v1/auth/session")
      .set(
        "Cookie",
        `${RecentOrganizationCookieName}=01ARZ3NDEKTSV4RRFFQ69G5FAV`,
      )
      .expect(200)
      .expect(({ body }) => {
        const appSession = AppSessionSchema.parse(body.data);
        expect(appSession.defaultOrganizationId).toBe(first.id);
      });
  });

  it("allows OWNER and ADMIN to manage organization members by username or userId", async () => {
    const ownerAgent = await registeredAgent("m1c_owner", "203.0.113.40");
    const adminAgent = await registeredAgent("m1c_admin", "203.0.113.41");
    const memberAgent = await registeredAgent("m1c_member", "203.0.113.42");
    const organization = (
      await createOrganization(ownerAgent, "M1C Manage", "m1c-manage")
    ).body.data as Organization;
    const memberUser = users.getByUsername("m1c_member");

    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1c_admin",
      role: "ADMIN",
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          organizationId: organization.id,
          role: "ADMIN",
          status: "ACTIVE",
          user: {
            username: "m1c_admin",
            name: "m1c_admin",
          },
        });
        expect(body.data.user).not.toHaveProperty("passwordHash");
      });

    await addOrganizationMember(adminAgent, organization.id, {
      userId: memberUser?.id,
      role: "MEMBER",
    }).expect(200);

    const member = organizations.members.find(
      (item) =>
        item.organizationId === organization.id &&
        item.userId === memberUser?.id,
    );

    await updateOrganizationMember(adminAgent, organization.id, member?.id ?? "", {
      role: "ADMIN",
      status: "DISABLED",
    })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: member?.id,
          role: "ADMIN",
          status: "DISABLED",
        });
      });

    await listOrganizationMembers(ownerAgent, organization.id)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(3);
        expect(
          body.data.items.map((item: OrganizationMemberWithUser) =>
            item.user.username
          ),
        ).toEqual(["m1c_owner", "m1c_admin", "m1c_member"]);
      });

    await memberAgent.get("/api/v1/auth/session").expect(200);
  });

  it("rejects MEMBER management and non-member access", async () => {
    const ownerAgent = await registeredAgent("m1c_perm_owner", "203.0.113.43");
    const memberAgent = await registeredAgent("m1c_perm_member", "203.0.113.44");
    const outsiderAgent = await registeredAgent(
      "m1c_perm_outsider",
      "203.0.113.45",
    );
    const organization = (
      await createOrganization(ownerAgent, "M1C Perm", "m1c-perm")
    ).body.data as Organization;

    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1c_perm_member",
      role: "MEMBER",
    }).expect(200);

    await addOrganizationMember(memberAgent, organization.id, {
      username: "m1c_perm_outsider",
      role: "MEMBER",
    })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_ACCESS_DENIED");
      });

    await listOrganizationMembers(outsiderAgent, organization.id)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_ACCESS_DENIED");
      });
  });

  it("denies organization access and management after the organization is disabled", async () => {
    const ownerAgent = await registeredAgent(
      "m1c_disabled_owner",
      "203.0.113.146",
    );
    await registeredAgent("m1c_disabled_member", "203.0.113.147");
    const organization = (
      await createOrganization(ownerAgent, "M1C Disabled", "m1c-disabled")
    ).body.data as Organization;

    await updateOrganization(ownerAgent, organization.id, {
      status: "DISABLED",
    }).expect(200);

    await ownerAgent
      .get(`/api/v1/organizations/${organization.id}`)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_ACCESS_DENIED");
      });
    await listOrganizationMembers(ownerAgent, organization.id)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_ACCESS_DENIED");
      });
    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1c_disabled_member",
      role: "MEMBER",
    })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_ACCESS_DENIED");
      });
    await ownerAgent
      .get("/api/v1/organizations")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: organization.id,
            }),
          ]),
        );
      });
    await ownerAgent
      .get("/api/v1/auth/session")
      .expect(200)
      .expect(({ body }) => {
        const appSession = AppSessionSchema.parse(body.data);
        expect(appSession.organizations).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: organization.id,
            }),
          ]),
        );
      });
  });

  it("prevents disabling or downgrading the last active OWNER", async () => {
    const ownerAgent = await registeredAgent("m1c_last_owner", "203.0.113.46");
    await registeredAgent("m1c_second_owner", "203.0.113.47");
    const organization = (
      await createOrganization(ownerAgent, "M1C Last Owner", "m1c-last-owner")
    ).body.data as Organization;
    const ownerMember = organizations.members.find(
      (member) => member.organizationId === organization.id,
    );

    await updateOrganizationMember(
      ownerAgent,
      organization.id,
      ownerMember?.id ?? "",
      {
        role: "ADMIN",
      },
    )
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("LAST_ORGANIZATION_OWNER_REQUIRED");
      });

    await updateOrganizationMember(
      ownerAgent,
      organization.id,
      ownerMember?.id ?? "",
      {
        status: "DISABLED",
      },
    )
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe("LAST_ORGANIZATION_OWNER_REQUIRED");
      });

    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1c_second_owner",
      role: "OWNER",
    }).expect(200);

    await updateOrganizationMember(
      ownerAgent,
      organization.id,
      ownerMember?.id ?? "",
      {
        role: "ADMIN",
      },
    )
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.role).toBe("ADMIN");
      });
  });

  it("disables an organization member through PATCH status", async () => {
    const ownerAgent = await registeredAgent("m1c_rm_owner", "203.0.113.60");
    const memberAgent = await registeredAgent("m1c_rm_member", "203.0.113.61");
    const organization = (
      await createOrganization(ownerAgent, "M1C Remove", "m1c-remove")
    ).body.data as Organization;
    const memberUser = users.getByUsername("m1c_rm_member");

    await addOrganizationMember(ownerAgent, organization.id, {
      username: "m1c_rm_member",
      role: "MEMBER",
    }).expect(200);

    const memberBefore = organizations.members.find(
      (item) =>
        item.organizationId === organization.id &&
        item.userId === memberUser?.id,
    );

    await updateOrganizationMember(
      ownerAgent,
      organization.id,
      memberBefore?.id ?? "",
      {
        status: "DISABLED",
      },
    )
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: memberBefore?.id,
          status: "DISABLED",
        });
      });

    const memberAfter = organizations.members.find(
      (item) =>
        item.organizationId === organization.id &&
        item.userId === memberUser?.id,
    );
    expect(memberAfter?.status).toBe("DISABLED");

    await listOrganizationMembers(ownerAgent, organization.id)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(2);
        expect(
          body.data.items.map(
            (item: OrganizationMemberWithUser) => item.user.username,
          ),
        ).toEqual(["m1c_rm_owner", "m1c_rm_member"]);
      });

    await memberAgent
      .get(`/api/v1/organizations/${organization.id}/members`)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_ACCESS_DENIED");
      });
  });

  it("returns ORGANIZATION_MEMBER_NOT_FOUND for an unknown member id", async () => {
    const ownerAgent = await registeredAgent(
      "m1c_rm_missing_owner",
      "203.0.113.64",
    );
    const organization = (
      await createOrganization(
        ownerAgent,
        "M1C Remove Missing",
        "m1c-remove-missing",
      )
    ).body.data as Organization;

    await updateOrganizationMember(
      ownerAgent,
      organization.id,
      "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      {
        status: "DISABLED",
      },
    )
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_MEMBER_NOT_FOUND");
      });
  });

  it("scopes organization member lists to the requested organization", async () => {
    const ownerA = await registeredAgent("m1c_iso_owner_a", "203.0.113.48");
    const ownerB = await registeredAgent("m1c_iso_owner_b", "203.0.113.49");
    await registeredAgent("m1c_iso_member_a", "203.0.113.50");
    await registeredAgent("m1c_iso_member_b", "203.0.113.51");
    const organizationA = (
      await createOrganization(ownerA, "M1C Iso A", "m1c-iso-a")
    ).body.data as Organization;
    const organizationB = (
      await createOrganization(ownerB, "M1C Iso B", "m1c-iso-b")
    ).body.data as Organization;

    await addOrganizationMember(ownerA, organizationA.id, {
      username: "m1c_iso_member_a",
      role: "MEMBER",
    }).expect(200);
    await addOrganizationMember(ownerB, organizationB.id, {
      username: "m1c_iso_member_b",
      role: "MEMBER",
    }).expect(200);

    await listOrganizationMembers(ownerA, organizationA.id)
      .expect(200)
      .expect(({ body }) => {
        expect(
          body.data.items.map((item: OrganizationMemberWithUser) =>
            item.user.username
          ),
        ).toEqual(["m1c_iso_owner_a", "m1c_iso_member_a"]);
      });

    await listOrganizationMembers(ownerB, organizationA.id)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("ORGANIZATION_ACCESS_DENIED");
      });
  });

  it("shows a second organization in AppSession after the user is added", async () => {
    const addedUserAgent = await registeredAgent(
      "m1c_switch_user",
      "203.0.113.52",
    );
    const ownerAgent = await registeredAgent("m1c_switch_owner", "203.0.113.53");
    const ownOrganization = (
      await createOrganization(addedUserAgent, "M1C Own", "m1c-own")
    ).body.data as Organization;
    const secondOrganization = (
      await createOrganization(ownerAgent, "M1C Second", "m1c-second")
    ).body.data as Organization;

    await addOrganizationMember(ownerAgent, secondOrganization.id, {
      username: "m1c_switch_user",
      role: "MEMBER",
    }).expect(200);

    await addedUserAgent
      .get("/api/v1/auth/session")
      .expect(200)
      .expect(({ body }) => {
        const appSession = AppSessionSchema.parse(body.data);
        expect(appSession.organizations).toEqual([
          {
            id: ownOrganization.id,
            name: "M1C Own",
            code: "m1c-own",
            role: "OWNER",
            status: "ACTIVE",
          },
          {
            id: secondOrganization.id,
            name: "M1C Second",
            code: "m1c-second",
            role: "MEMBER",
            status: "ACTIVE",
          },
        ]);
        expect(appSession.defaultOrganizationId).toBe(ownOrganization.id);
      });
  });

  it("rate limits organization creation by userId", async () => {
    const agent = await registeredAgent("limited_org_user", "203.0.113.36");

    for (let index = 0; index < 5; index += 1) {
      await createOrganization(
        agent,
        `Limited ${index}`,
        `limited-${index}`,
      ).expect(200);
    }

    await createOrganization(agent, "Limited extra", "limited-extra")
      .expect(429)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: "RATE_LIMITED",
          details: {
            retryAfterSeconds: expect.any(Number),
          },
        });
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
    body: { role: "OWNER" | "ADMIN" | "MEMBER"; userId?: string; username?: string },
  ) {
    return agent
      .post(`/api/v1/organizations/${organizationId}/members`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function updateOrganizationMember(
    agent: request.Agent,
    organizationId: string,
    memberId: string,
    body: { role?: "OWNER" | "ADMIN" | "MEMBER"; status?: RecordStatus },
  ) {
    return agent
      .patch(`/api/v1/organizations/${organizationId}/members/${memberId}`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function listOrganizationMembers(
    agent: request.Agent,
    organizationId: string,
  ) {
    return agent.get(`/api/v1/organizations/${organizationId}/members`);
  }

  function updateOrganization(
    agent: request.Agent,
    organizationId: string,
    body: { name?: string; code?: string; status?: RecordStatus },
  ) {
    return agent
      .patch(`/api/v1/organizations/${organizationId}`)
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

  constructor(private readonly users: InMemoryUserRepository) {}

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

    return member && organization?.status === "ACTIVE"
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
    return this.members
      .filter((member) => member.userId === userId && member.status === "ACTIVE")
      .map((member) => {
        const organization = this.organizations.get(member.organizationId);

        if (!organization) {
          throw new Error(`Missing organization ${member.organizationId}`);
        }

        return organization.status === "ACTIVE"
          ? {
              id: organization.id,
              name: organization.name,
              code: organization.code,
              role: member.role,
              status: organization.status as RecordStatus,
            }
          : undefined;
      })
      .filter((summary): summary is SessionOrganizationSummary =>
        Boolean(summary),
      );
  }

  async listSessionSpaceSummaries(
    _userId: string,
  ): Promise<SessionSpaceSummary[]> {
    return [];
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

    const nextRole = input.role ?? member.role;
    const nextStatus = input.status ?? member.status;

    if (
      member.role === "OWNER" &&
      member.status === "ACTIVE" &&
      (nextRole !== "OWNER" || nextStatus !== "ACTIVE") &&
      this.isLastActiveOwner(member)
    ) {
      throw new LastOrganizationOwnerRequiredError();
    }

    member.role = nextRole;
    member.status = nextStatus;

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

        return organization.status === "ACTIVE" ? organization : undefined;
      })
      .filter((organization): organization is Organization =>
        Boolean(organization),
      );
  }

  private isLastActiveOwner(member: OrganizationMember): boolean {
    return (
      member.role === "OWNER" &&
      member.status === "ACTIVE" &&
      this.members.filter(
        (item) =>
          item.organizationId === member.organizationId &&
          item.role === "OWNER" &&
          item.status === "ACTIVE",
      ).length <= 1
    );
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
