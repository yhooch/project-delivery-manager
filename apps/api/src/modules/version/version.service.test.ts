import { describe, expect, it, vi } from "vitest";

import type {
  OrganizationMemberWithUser,
  Space,
  SpaceMemberWithUser,
  SpaceRole,
  Version,
} from "@project-delivery/shared";
import type { AuditService } from "../audit/audit.service";
import type { OrganizationRepository } from "../organization/organization.repository";
import type { SpaceRepository } from "../space/space.repository";
import type { SpaceAccess } from "../space/space.types";
import type { VersionRepository } from "./version.repository";
import { VersionService } from "./version.service";
import type {
  CreateVersionInput,
  UpdateVersionInput,
  VersionBoardInput,
  VersionBoardResult,
  VersionListInput,
  VersionListResult,
  VersionStatsScope,
} from "./version.types";

type RequirementStatsVisibility = "SPACE";

type VersionStatsScopeWithRequirementVisibility = VersionStatsScope & {
  requirementStatsVisibility?: RequirementStatsVisibility;
};

type VersionListInputWithRequirementVisibility = VersionListInput & {
  requirementStatsVisibility?: RequirementStatsVisibility;
};

const ORGANIZATION_ID = "01H00000000000000000000000";
const OTHER_ORGANIZATION_ID = "01H0000000000000000000000Z";
const SPACE_ID = "01H00000000000000000000001";
const OTHER_SPACE_ID = "01H0000000000000000000000Y";
const ACTOR_ID = "01H00000000000000000000002";
const VERSION_ID = "01H00000000000000000000003";
const ASSIGNEE_ID = "01H00000000000000000000004";

describe("VersionService board view", () => {
  it("writes audit logs when versions are created and updated", async () => {
    const subject = createSubject("PM");

    const created = await subject.service.create(
      ACTOR_ID,
      SPACE_ID,
      {
        name: "M1",
        ownerId: ASSIGNEE_ID,
        status: "PLANNED",
        target: "First milestone",
      },
      { requestId: "req-version-create" },
    );

    expect(subject.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        actorId: ACTOR_ID,
        after: expect.objectContaining({ id: created.id, name: "M1" }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-version-create",
        spaceId: SPACE_ID,
        targetId: created.id,
        targetType: "VERSION",
      }),
    );

    await subject.service.update(
      ACTOR_ID,
      created.id,
      {
        name: "M1.1",
      },
      { requestId: "req-version-update" },
    );

    expect(subject.audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        actorId: ACTOR_ID,
        after: expect.objectContaining({ name: "M1.1" }),
        before: expect.objectContaining({ name: "M1" }),
        organizationId: ORGANIZATION_ID,
        requestId: "req-version-update",
        spaceId: SPACE_ID,
        targetId: created.id,
        targetType: "VERSION",
      }),
    );
  });

  it("returns the version board with canonical filters and space-wide visibility", async () => {
    const subject = createSubject("PM");

    subject.versions.items.set(VERSION_ID, makeVersion());

    const result = await subject.service.getBoard(ACTOR_ID, VERSION_ID, {
      assigneeId: ASSIGNEE_ID,
      organizationId: ORGANIZATION_ID,
      page: 2,
      pageSize: 10,
      statusCategory: "IN_PROGRESS",
      workItemType: "BUG",
    });

    expect(result.filters).toEqual({
      assigneeId: ASSIGNEE_ID,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      statusCategory: "IN_PROGRESS",
      versionId: VERSION_ID,
      workItemType: "BUG",
    });
    expect(result.items).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 0,
    });
    expect(subject.versions.boardInput).toMatchObject({
      actorUserId: ACTOR_ID,
      assigneeId: ASSIGNEE_ID,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
      staleThresholdDays: 5,
      statusCategory: "IN_PROGRESS",
      versionId: VERSION_ID,
      visibility: "SPACE",
      workItemType: "BUG",
    });
  });

  it("uses participant visibility for roles without space-wide read access", async () => {
    const subject = createSubject("DEVELOPER");

    subject.versions.items.set(VERSION_ID, makeVersion());

    await subject.service.getBoard(ACTOR_ID, VERSION_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(subject.versions.boardInput?.visibility).toBe("PARTICIPANT");
  });

  it("uses tester-scoped visibility for TESTER board reads", async () => {
    const subject = createSubject("TESTER");

    subject.versions.items.set(VERSION_ID, makeVersion());

    await subject.service.getBoard(ACTOR_ID, VERSION_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(subject.versions.boardInput?.visibility).toBe("TESTER");
  });

  it("passes actor-scoped stats visibility when listing versions", async () => {
    const subject = createSubject("TESTER");

    subject.versions.items.set(VERSION_ID, makeVersion());

    await subject.service.list(ACTOR_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(subject.versions.listInput).toMatchObject({
      actorUserId: ACTOR_ID,
      page: 1,
      pageSize: 20,
      visibility: "TESTER",
    });
  });

  it("uses requirement-wide stats for REQUIREMENT role without widening board work items", async () => {
    const subject = createSubject("REQUIREMENT");

    subject.versions.items.set(
      VERSION_ID,
      makeVersion({
        stats: {
          blockedCount: 8,
          bugCount: 7,
          requirementCount: 6,
          taskCount: 5,
        },
      }),
    );

    await subject.service.list(ACTOR_ID, SPACE_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(subject.versions.listInput).toMatchObject({
      actorUserId: ACTOR_ID,
      requirementStatsVisibility: "SPACE",
      visibility: "PARTICIPANT",
    });

    const result = await subject.service.get(ACTOR_ID, VERSION_ID);

    expect(subject.versions.findStatsScopes).toEqual([
      undefined,
      {
        actorUserId: ACTOR_ID,
        requirementStatsVisibility: "SPACE",
        spaceId: SPACE_ID,
        visibility: "PARTICIPANT",
      },
    ]);
    expect(result.stats).toEqual({
      blockedCount: 0,
      bugCount: 1,
      requirementCount: 6,
      taskCount: 1,
    });

    await subject.service.getBoard(ACTOR_ID, VERSION_ID, {
      page: 1,
      pageSize: 20,
    });

    expect(subject.versions.boardInput?.visibility).toBe("PARTICIPANT");
  });

  it("returns participant-scoped stats for restricted version reads", async () => {
    const subject = createSubject("DEVELOPER");

    subject.versions.items.set(
      VERSION_ID,
      makeVersion({
        stats: {
          blockedCount: 4,
          bugCount: 3,
          requirementCount: 2,
          taskCount: 1,
        },
      }),
    );

    const result = await subject.service.get(ACTOR_ID, VERSION_ID);

    expect(subject.versions.findStatsScopes).toEqual([
      undefined,
      {
        actorUserId: ACTOR_ID,
        spaceId: SPACE_ID,
        visibility: "PARTICIPANT",
      },
    ]);
    expect(result.stats).toEqual({
      blockedCount: 0,
      bugCount: 1,
      requirementCount: 1,
      taskCount: 1,
    });
  });

  it("rejects query scope that does not match the version", async () => {
    const subject = createSubject("PM");

    subject.versions.items.set(VERSION_ID, makeVersion());

    await expect(
      subject.service.getBoard(ACTOR_ID, VERSION_ID, {
        organizationId: OTHER_ORGANIZATION_ID,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({
      code: "CROSS_ORGANIZATION_ACCESS_DENIED",
    });

    await expect(
      subject.service.getBoard(ACTOR_ID, VERSION_ID, {
        page: 1,
        pageSize: 20,
        spaceId: OTHER_SPACE_ID,
      }),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
    });
  });
});

function createSubject(role: SpaceRole) {
  const versions = new FakeVersionRepository();
  const spaces = new FakeSpaceRepository(role);
  const organizations = new FakeOrganizationRepository();
  const audit = createAuditService();

  return {
    audit,
    organizations,
    service: new VersionService(
      versions,
      spaces as unknown as SpaceRepository,
      organizations as unknown as OrganizationRepository,
      audit,
    ),
    spaces,
    versions,
  };
}

function createAuditService() {
  return {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
  };
}

class FakeVersionRepository implements VersionRepository {
  readonly items = new Map<string, Version>();
  boardInput?: VersionBoardInput;
  readonly findStatsScopes: Array<
    VersionStatsScopeWithRequirementVisibility | undefined
  > = [];
  listInput?: VersionListInputWithRequirementVisibility;

  async create(input: CreateVersionInput): Promise<Version> {
    const version = makeVersion({
      id: input.id,
      name: input.name,
      ownerId: input.ownerId,
      status: input.status ?? "PLANNED",
    });

    this.items.set(version.id, version);

    return version;
  }

  async findById(
    versionId: string,
    statsScope?: VersionStatsScopeWithRequirementVisibility,
  ): Promise<Version | undefined> {
    this.findStatsScopes.push(statsScope);
    const version = this.items.get(versionId);

    if (!version || !statsScope || statsScope.visibility === "SPACE") {
      return version;
    }

    if (statsScope.requirementStatsVisibility === "SPACE") {
      return {
        ...version,
        stats: {
          blockedCount: 0,
          bugCount: 1,
          requirementCount: version.stats.requirementCount,
          taskCount: 1,
        },
      };
    }

    return {
      ...version,
      stats: {
        blockedCount: 0,
        bugCount: 1,
        requirementCount: 1,
        taskCount: 1,
      },
    };
  }

  async findByName(
    spaceId: string,
    name: string,
  ): Promise<{ id: string } | undefined> {
    const version = [...this.items.values()].find(
      (item) => item.spaceId === spaceId && item.name === name,
    );

    return version ? { id: version.id } : undefined;
  }

  async listBySpaceId(
    spaceId: string,
    input: VersionListInput,
  ): Promise<VersionListResult> {
    this.listInput = input as VersionListInputWithRequirementVisibility;
    const items = [...this.items.values()].filter(
      (item) => item.spaceId === spaceId,
    );

    return {
      items,
      page: input.page,
      pageSize: input.pageSize,
      total: items.length,
    };
  }

  async listBoard(input: VersionBoardInput): Promise<VersionBoardResult> {
    this.boardInput = input;

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
    const version = this.items.get(input.versionId);

    if (!version) {
      return undefined;
    }

    const updated = {
      ...version,
      name: input.name ?? version.name,
      status: input.status ?? version.status,
    };

    this.items.set(updated.id, updated);

    return updated;
  }
}

class FakeSpaceRepository {
  constructor(private readonly role: SpaceRole) {}

  async findAccessibleById(
    userId: string,
    spaceId: string,
  ): Promise<SpaceAccess | undefined> {
    if (userId !== ACTOR_ID || spaceId !== SPACE_ID) {
      return undefined;
    }

    return {
      role: this.role,
      space: makeSpace(),
    };
  }

  async findMemberByUserId(
    spaceId: string,
    userId: string,
  ): Promise<SpaceMemberWithUser | undefined> {
    if (spaceId !== SPACE_ID) {
      return undefined;
    }

    return {
      id: `${userId}M`,
      organizationId: ORGANIZATION_ID,
      role: this.role,
      spaceId,
      status: "ACTIVE",
      user: {
        id: userId,
        name: userId,
        status: "ACTIVE",
        username: userId.toLowerCase(),
      },
      userId,
    };
  }
}

class FakeOrganizationRepository {
  async findMemberByUserId(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMemberWithUser | undefined> {
    if (organizationId !== ORGANIZATION_ID) {
      return undefined;
    }

    return {
      id: `${userId}O`,
      organizationId,
      role: "MEMBER",
      status: "ACTIVE",
      user: {
        id: userId,
        name: userId,
        status: "ACTIVE",
        username: userId.toLowerCase(),
      },
      userId,
    };
  }
}

function makeVersion(overrides: Partial<Version> = {}): Version {
  return {
    id: VERSION_ID,
    name: "Version Board",
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    stats: {
      blockedCount: 0,
      bugCount: 0,
      requirementCount: 0,
      taskCount: 0,
    },
    status: "PLANNED",
    ...overrides,
  };
}

function makeSpace(): Space {
  return {
    code: "BOARD",
    id: SPACE_ID,
    name: "Board Space",
    organizationId: ORGANIZATION_ID,
    settings: {
      staleThresholdDays: 5,
    },
    status: "ACTIVE",
  };
}
