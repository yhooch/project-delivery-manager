import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  type Attachment,
  type AttachmentMimeType,
  type AttachmentTargetType,
  type Organization,
  type OrganizationMember,
  type OrganizationMemberWithUser,
  type OrganizationRole,
  type Priority,
  type Requirement,
  type RequirementStatus,
  type SaveRequirementRequest,
  type Space,
  type SpaceMember,
  type SpaceMemberWithUser,
  type SpaceRole,
  type Version,
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
} from "../version/version.repository";
import type {
  CreateVersionInput,
  UpdateVersionInput,
  VersionBoardInput,
  VersionBoardResult,
  VersionListInput,
  VersionListResult,
} from "../version/version.types";
import {
  ATTACHMENT_REPOSITORY,
  type AttachmentRepository,
} from "../attachment/attachment.repository";
import type { CreateAttachmentInput } from "../attachment/attachment.types";
import {
  REQUIREMENT_REPOSITORY,
  type RequirementRepository,
} from "./requirement.repository";
import type {
  ArchiveRequirementInput,
  CreateRequirementDraftInput,
  RequirementListInput,
  RequirementListResult,
  SaveRequirementInput,
  DeleteRequirementDraftInput,
} from "./requirement.types";

const ORIGIN = "http://localhost:3000";

describe("requirement and attachment API", () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let organizations: InMemoryOrganizationRepository;
  let spaces: InMemorySpaceRepository;
  let versions: InMemoryVersionRepository;
  let requirements: InMemoryRequirementRepository;
  let attachments: InMemoryAttachmentRepository;

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
    attachments = new InMemoryAttachmentRepository();
    requirements = new InMemoryRequirementRepository();
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
      .overrideProvider(REQUIREMENT_REPOSITORY)
      .useValue(requirements)
      .overrideProvider(ATTACHMENT_REPOSITORY)
      .useValue(attachments)
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates an empty DRAFT, saves content as CONFIRMED, returns permission snapshots, and archives it", async () => {
    const { agent, requirementUser, assignee, space, version } =
      await setupRequirementSpace("m1g_lifecycle", "REQUIREMENT");

    const draft = (
      await createRequirement(agent, space.id, {
        versionId: version.id,
      }).expect(200)
    ).body.data as Requirement;

    expect(draft).toMatchObject({
      spaceId: space.id,
      versionId: version.id,
      title: "",
      contentJson: {},
      status: "DRAFT",
      permissions: {
        availableActions: [],
        canComment: true,
        canEdit: true,
        canUploadAttachment: true,
      },
      relatedWorkItems: {
        taskCount: 0,
        bugCount: 0,
        tasks: [],
        bugs: [],
      },
    });
    expect(requirements.participantsFor(draft.id)).toContainEqual({
      relationType: "CREATOR",
      userId: requirementUser.id,
    });

    await listRequirements(agent, space.id)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(0);
      });
    await listRequirements(agent, space.id, { includeDrafts: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(1);
        expect(body.data.items[0].id).toBe(draft.id);
      });

    const contentJson = tiptapDoc("确定首版范围");
    const saved = (
      await patchRequirement(agent, draft.id, {
        title: "首版需求",
        summary: "M1 需求摘要",
        contentJson,
        contentText: "确定首版范围",
        contentMarkdownCache: "## 确定首版范围",
        versionId: version.id,
        ownerId: assignee.id,
        priority: "HIGH",
      }).expect(200)
    ).body.data as Requirement;

    expect(saved).toMatchObject({
      id: draft.id,
      title: "首版需求",
      summary: "M1 需求摘要",
      contentJson,
      contentText: "确定首版范围",
      contentMarkdownCache: "## 确定首版范围",
      status: "CONFIRMED",
      ownerId: assignee.id,
      priority: "HIGH",
      permissions: {
        availableActions: [],
        canComment: true,
        canEdit: true,
        canUploadAttachment: false,
      },
      relatedWorkItems: {
        taskCount: 0,
        bugCount: 0,
        tasks: [],
        bugs: [],
      },
    });
    expect(requirements.participantsFor(draft.id)).toEqual(
      expect.arrayContaining([
        {
          relationType: "CREATOR",
          userId: requirementUser.id,
        },
        {
          relationType: "ASSIGNEE",
          userId: assignee.id,
        },
      ]),
    );

    await agent
      .get(`/api/v1/requirements/${draft.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.relatedWorkItems).toEqual({
          taskCount: 0,
          bugCount: 0,
          tasks: [],
          bugs: [],
        });
      });

    await patchRequirement(agent, draft.id, { status: "ARCHIVED" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.status).toBe("ARCHIVED");
        expect(body.data.permissions).toEqual({
          availableActions: [],
          canComment: false,
          canEdit: false,
          canUploadAttachment: false,
        });
      });
  });

  it("rejects malformed Tiptap content and inline base64 images", async () => {
    const { agent, space } = await setupRequirementSpace(
      "m1g_content_validation",
      "REQUIREMENT",
    );
    const draft = (
      await createRequirement(agent, space.id, {}).expect(200)
    ).body.data as Requirement;

    await patchRequirement(agent, draft.id, {
      title: "非法结构",
      contentJson: {
        foo: "bar",
      },
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("VALIDATION_ERROR");
      });

    await patchRequirement(agent, draft.id, {
      title: "Base64 图片",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "data:image/png;base64,AAAA",
            },
          },
        ],
      },
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("VALIDATION_ERROR");
      });
  });

  it("deletes only empty DRAFT requirements created by the current user", async () => {
    const { agent, assigneeAgent, space } = await setupRequirementSpace(
      "m1g_discard_draft",
      "REQUIREMENT",
    );
    const draft = (
      await createRequirement(agent, space.id, {}).expect(200)
    ).body.data as Requirement;

    await deleteRequirement(assigneeAgent, draft.id)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe("REQUIREMENT_NOT_FOUND");
      });

    await deleteRequirement(agent, draft.id).expect(200).expect(({ body }) => {
      expect(body.data).toEqual({});
    });
    await agent.get(`/api/v1/requirements/${draft.id}`).expect(404);

    const titledDraft = (
      await createRequirement(agent, space.id, {}).expect(200)
    ).body.data as Requirement;
    requirements.setDraftTitle(titledDraft.id, "已有标题");

    await deleteRequirement(agent, titledDraft.id)
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("VALIDATION_ERROR");
      });
  });

  it("returns real related task and Bug summaries for requirement detail and list", async () => {
    const { agent, assignee, space, version } = await setupRequirementSpace(
      "m1g_related_work",
      "PM",
    );
    const requirement = await createSavedRequirement(agent, space.id, {
      versionId: version.id,
      ownerId: assignee.id,
      title: "关联工作项需求",
      priority: "HIGH",
    });
    const taskId = ulid();
    const bugId = ulid();

    requirements.seedRelatedWorkItems(requirement.id, {
      taskCount: 1,
      bugCount: 1,
      tasks: [
        {
          id: taskId,
          type: "TASK",
          title: "实现需求任务",
          versionId: version.id,
          assigneeId: assignee.id,
          statusCategory: "IN_PROGRESS",
        },
      ],
      bugs: [
        {
          id: bugId,
          type: "BUG",
          title: "修复需求 Bug",
          versionId: version.id,
          statusCategory: "VERIFYING",
        },
      ],
    });

    await agent
      .get(`/api/v1/requirements/${requirement.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.relatedWorkItems).toMatchObject({
          taskCount: 1,
          bugCount: 1,
          tasks: [
            {
              id: taskId,
              title: "实现需求任务",
              type: "TASK",
              statusCategory: "IN_PROGRESS",
            },
          ],
          bugs: [
            {
              id: bugId,
              title: "修复需求 Bug",
              type: "BUG",
              statusCategory: "VERIFYING",
            },
          ],
        });
      });
    await listRequirements(agent, space.id, { ownerId: assignee.id })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items[0].relatedWorkItems).toMatchObject({
          taskCount: 1,
          bugCount: 1,
        });
      });
  });

  it("filters by version, owner, and status while hiding empty drafts by default", async () => {
    const { agent, assignee, space, version } = await setupRequirementSpace(
      "m1g_filters",
      "PM",
    );
    const nextVersion = versions.createTestVersion(
      space.organizationId,
      space.id,
      "M1G Next",
    );

    const first = await createSavedRequirement(agent, space.id, {
      versionId: version.id,
      ownerId: assignee.id,
      title: "版本一需求",
      priority: "MEDIUM",
    });
    await createSavedRequirement(agent, space.id, {
      versionId: nextVersion.id,
      title: "版本二需求",
      priority: "LOW",
    });
    const draft = (
      await createRequirement(agent, space.id, {}).expect(200)
    ).body.data as Requirement;

    await listRequirements(agent, space.id, { versionId: version.id })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items.map((item: Requirement) => item.id)).toEqual([
          first.id,
        ]);
      });
    await listRequirements(agent, space.id, { ownerId: assignee.id })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items.map((item: Requirement) => item.id)).toEqual([
          first.id,
        ]);
      });
    await listRequirements(agent, space.id, { status: "CONFIRMED" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(2);
      });
    await listRequirements(agent, space.id)
      .expect(200)
      .expect(({ body }) => {
        expect(
          body.data.items.some((item: Requirement) => item.id === draft.id),
        ).toBe(false);
      });
    await listRequirements(agent, space.id, { status: "DRAFT" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items.map((item: Requirement) => item.id)).toEqual([
          draft.id,
        ]);
      });
  });

  it("rejects non-space-member reads and VIEWER writes while allowing VIEWER reads", async () => {
    const { agent, outsiderAgent, viewerAgent, space } =
      await setupRequirementSpace("m1g_access", "REQUIREMENT");
    const requirement = await createSavedRequirement(agent, space.id, {
      title: "权限需求",
    });

    await listRequirements(outsiderAgent, space.id)
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("SPACE_ACCESS_DENIED");
      });
    await createRequirement(viewerAgent, space.id, {})
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe("SPACE_ACCESS_DENIED");
      });
    await patchRequirement(viewerAgent, requirement.id, {
      title: "VIEWER 不可写",
      contentJson: tiptapDoc("VIEWER 不可写"),
    }).expect(403);
    await viewerAgent.get(`/api/v1/requirements/${requirement.id}`).expect(200);
  });

  it("does not leak titled DRAFT requirements to non-participant space members", async () => {
    const { agent, assigneeAgent, developerAgent, space } = await setupRequirementSpace(
      "m1g_draft_visibility",
      "PM",
    );
    const draft = (
      await createRequirement(agent, space.id, {}).expect(200)
    ).body.data as Requirement;
    requirements.setDraftTitle(draft.id, "已命名草稿");
    const otherDraft = (
      await createRequirement(assigneeAgent, space.id, {}).expect(200)
    ).body.data as Requirement;
    requirements.setDraftTitle(otherDraft.id, "他人草稿");

    await listRequirements(agent, space.id, { status: "DRAFT" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items.map((item: Requirement) => item.id)).toEqual([
          draft.id,
        ]);
      });
    await agent.get(`/api/v1/requirements/${otherDraft.id}`).expect(404);
    await listRequirements(developerAgent, space.id, { status: "DRAFT" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.total).toBe(0);
      });
    await listRequirements(developerAgent, space.id, { includeDrafts: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items.some((item: Requirement) => item.id === draft.id)).toBe(
          false,
        );
      });
    await developerAgent.get(`/api/v1/requirements/${draft.id}`).expect(404);
  });

  it("presigns, registers, and downloads requirement attachments", async () => {
    const { agent, viewerAgent, requirementUser, space } =
      await setupRequirementSpace("m1g_attachment_success", "REQUIREMENT");
    const draft = (
      await createRequirement(agent, space.id, {}).expect(200)
    ).body.data as Requirement;

    const presign = (
      await presignAttachment(agent, {
        targetType: "REQUIREMENT",
        targetId: draft.id,
        fileName: "设计图.png",
        mimeType: "image/png",
        size: 1024,
      }).expect(200)
    ).body.data as { expiresInSeconds: number; fileKey: string; uploadUrl: string };

    expect(presign).toMatchObject({
      expiresInSeconds: 600,
    });
    expect(presign.fileKey).toContain(`attachments/requirement/${draft.id}/`);
    expect(presign.uploadUrl).toContain("https://object-storage.local/upload/");

    const attachment = (
      await createAttachment(agent, {
        targetType: "REQUIREMENT",
        targetId: draft.id,
        fileName: "设计图.png",
        fileKey: presign.fileKey,
        mimeType: "image/png",
        size: 1024,
      }).expect(200)
    ).body.data as Attachment;

    expect(attachment).toMatchObject({
      targetType: "REQUIREMENT",
      targetId: draft.id,
      fileName: "设计图.png",
      fileKey: presign.fileKey,
      mimeType: "image/png",
      size: 1024,
      uploadedById: requirementUser.id,
    });

    await agent
      .get(`/api/v1/attachments/${attachment.id}/download-url`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.expiresInSeconds).toBe(300);
        expect(body.data.downloadUrl).toContain(
          "https://object-storage.local/download/",
        );
      });
    await viewerAgent
      .get(`/api/v1/attachments/${attachment.id}/download-url`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe("ATTACHMENT_TARGET_NOT_FOUND");
      });
  });

  it("validates attachment target, permission, size, MIME, draft status, and count limit", async () => {
    const { agent, outsiderAgent, space } = await setupRequirementSpace(
      "m1g_attachment_errors",
      "REQUIREMENT",
    );
    const draft = (
      await createRequirement(agent, space.id, {}).expect(200)
    ).body.data as Requirement;

    await presignAttachment(agent, {
      targetType: "REQUIREMENT",
      targetId: ulid(),
      fileName: "missing.png",
      mimeType: "image/png",
      size: 1024,
    })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe("ATTACHMENT_TARGET_NOT_FOUND");
      });
    await presignAttachment(outsiderAgent, {
      targetType: "REQUIREMENT",
      targetId: draft.id,
      fileName: "denied.png",
      mimeType: "image/png",
      size: 1024,
    })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe("ATTACHMENT_TARGET_NOT_FOUND");
      });
    await presignAttachment(agent, {
      targetType: "REQUIREMENT",
      targetId: draft.id,
      fileName: "large.png",
      mimeType: "image/png",
      size: AttachmentMaxSizeBytes + 1,
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("VALIDATION_ERROR");
      });
    await agent
      .post("/api/v1/attachments/presign")
      .set("Origin", ORIGIN)
      .send({
        targetType: "REQUIREMENT",
        targetId: draft.id,
        fileName: "bad.exe",
        mimeType: "application/x-msdownload",
        size: 1024,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("VALIDATION_ERROR");
      });

    await patchRequirement(agent, draft.id, {
      title: "已确认需求",
      contentJson: tiptapDoc("已确认需求"),
    }).expect(200);
    await presignAttachment(agent, {
      targetType: "REQUIREMENT",
      targetId: draft.id,
      fileName: "confirmed.png",
      mimeType: "image/png",
      size: 1024,
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("DRAFT_REQUIREMENT_REQUIRED");
      });

    const limitedDraft = (
      await createRequirement(agent, space.id, {}).expect(200)
    ).body.data as Requirement;
    attachments.seedTarget(
      limitedDraft.organizationId,
      limitedDraft.spaceId,
      "REQUIREMENT",
      limitedDraft.id,
      AttachmentMaxCountPerTarget,
    );
    await presignAttachment(agent, {
      targetType: "REQUIREMENT",
      targetId: limitedDraft.id,
      fileName: "overflow.png",
      mimeType: "image/png",
      size: 1024,
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe("ATTACHMENT_LIMIT_EXCEEDED");
      });
  });

  async function setupRequirementSpace(
    prefix: string,
    writerRole: SpaceRole,
  ) {
    const agent = await registeredAgent(`${prefix}_writer`, `${prefix}.1`);
    const viewerAgent = await registeredAgent(`${prefix}_viewer`, `${prefix}.2`);
    const outsiderAgent = await registeredAgent(
      `${prefix}_outsider`,
      `${prefix}.3`,
    );
    const assigneeAgent = await registeredAgent(
      `${prefix}_assignee`,
      `${prefix}.4`,
    );
    const developerAgent = await registeredAgent(
      `${prefix}_developer`,
      `${prefix}.5`,
    );
    const requirementUser = getUser(`${prefix}_writer`);
    const viewer = getUser(`${prefix}_viewer`);
    const outsider = getUser(`${prefix}_outsider`);
    const assignee = getUser(`${prefix}_assignee`);
    const developer = getUser(`${prefix}_developer`);
    const organization = organizations.createTestOrganization(
      requirementUser.id,
      `${prefix} Org`,
      `${prefix}-org`,
    );
    organizations.addTestMember(organization.id, viewer.id, "MEMBER");
    organizations.addTestMember(organization.id, assignee.id, "MEMBER");
    organizations.addTestMember(organization.id, outsider.id, "MEMBER");
    organizations.addTestMember(organization.id, developer.id, "MEMBER");
    const space = spaces.createTestSpace(
      organization.id,
      requirementUser.id,
      `${prefix} Space`,
    );
    spaces.updateTestMemberRole(space.id, requirementUser.id, writerRole);
    spaces.addTestMember(organization.id, space.id, viewer.id, "VIEWER");
    spaces.addTestMember(organization.id, space.id, assignee.id, "PM");
    spaces.addTestMember(organization.id, space.id, developer.id, "DEVELOPER");
    const version = versions.createTestVersion(
      organization.id,
      space.id,
      `${prefix} Version`,
    );
    return {
      agent,
      assigneeAgent,
      developerAgent,
      viewerAgent,
      outsiderAgent,
      requirementUser,
      assignee,
      organization,
      space,
      version,
    };
  }

  async function createSavedRequirement(
    agent: request.Agent,
    spaceId: string,
    input: {
      ownerId?: string;
      priority?: Priority;
      title: string;
      versionId?: string;
    },
  ): Promise<Requirement> {
    const draft = (await createRequirement(agent, spaceId, {}).expect(200)).body
      .data as Requirement;
    const response = await patchRequirement(agent, draft.id, {
      title: input.title,
      contentJson: tiptapDoc(input.title),
      ownerId: input.ownerId,
      priority: input.priority,
      versionId: input.versionId,
    }).expect(200);

    return response.body.data as Requirement;
  }

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

  function createRequirement(
    agent: request.Agent,
    spaceId: string,
    body: { versionId?: string },
  ) {
    return agent
      .post(`/api/v1/spaces/${spaceId}/requirements`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function listRequirements(
    agent: request.Agent,
    spaceId: string,
    query: {
      includeDrafts?: boolean;
      ownerId?: string;
      status?: RequirementStatus;
      versionId?: string;
    } = {},
  ) {
    return agent.get(`/api/v1/spaces/${spaceId}/requirements`).query(query);
  }

  function patchRequirement(
    agent: request.Agent,
    requirementId: string,
    body:
      | {
          contentJson: SaveRequirementRequest["contentJson"];
          contentMarkdownCache?: string;
          contentText?: string;
          ownerId?: string;
          priority?: Priority;
          summary?: string;
          title: string;
          versionId?: string;
        }
      | {
          status: "ARCHIVED";
        },
  ) {
    return agent
      .patch(`/api/v1/requirements/${requirementId}`)
      .set("Origin", ORIGIN)
      .send(body);
  }

  function deleteRequirement(agent: request.Agent, requirementId: string) {
    return agent
      .delete(`/api/v1/requirements/${requirementId}`)
      .set("Origin", ORIGIN);
  }

  function presignAttachment(
    agent: request.Agent,
    body: {
      fileName: string;
      mimeType: AttachmentMimeType;
      size: number;
      targetId: string;
      targetType: AttachmentTargetType;
    },
  ) {
    return agent
      .post("/api/v1/attachments/presign")
      .set("Origin", ORIGIN)
      .send(body);
  }

  function createAttachment(
    agent: request.Agent,
    body: {
      fileKey: string;
      fileName: string;
      mimeType: AttachmentMimeType;
      size: number;
      targetId: string;
      targetType: AttachmentTargetType;
    },
  ) {
    return agent.post("/api/v1/attachments").set("Origin", ORIGIN).send(body);
  }

  function getUser(username: string): IdentityUser {
    const user = users.getByUsername(username);

    if (!user) {
      throw new Error(`Missing test user ${username}`);
    }

    return user;
  }
});

function tiptapDoc(text: string): SaveRequirementRequest["contentJson"] {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text,
          },
        ],
      },
    ],
  };
}

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

  async listSessionSummaries() {
    return [];
  }

  async listSessionSpaceSummaries() {
    return [];
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

  updateTestMemberRole(spaceId: string, userId: string, role: SpaceRole): void {
    const member = this.members.find(
      (item) => item.spaceId === spaceId && item.userId === userId,
    );

    if (member) {
      member.role = role;
    }
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
  private readonly versions = new Map<string, Version>();

  createTestVersion(
    organizationId: string,
    spaceId: string,
    name: string,
  ): Version {
    const version: Version = {
      id: ulid(),
      organizationId,
      spaceId,
      name,
      status: "PLANNED",
      stats: {
        requirementCount: 0,
        taskCount: 0,
        bugCount: 0,
        blockedCount: 0,
      },
    };
    this.versions.set(version.id, version);

    return version;
  }

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

    return version;
  }

  async findById(versionId: string): Promise<Version | undefined> {
    return this.versions.get(versionId);
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
    const items = [...this.versions.values()].filter(
      (version) =>
        version.spaceId === spaceId &&
        (!input.ownerId || version.ownerId === input.ownerId) &&
        (!input.status || version.status === input.status),
    );

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

    return updated;
  }
}

type InternalRequirement = Requirement & {
  createdById: string;
};

type ObjectParticipantRecord = {
  relationType: "ASSIGNEE" | "CREATOR";
  targetId: string;
  userId: string;
};

class InMemoryRequirementRepository implements RequirementRepository {
  private readonly participants: ObjectParticipantRecord[] = [];
  private readonly records = new Map<string, InternalRequirement>();

  async createDraft(input: CreateRequirementDraftInput): Promise<Requirement> {
    const now = new Date().toISOString();
    const requirement: InternalRequirement = {
      id: input.id,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      versionId: input.versionId,
      title: "",
      contentJson: {},
      contentFormat: "TIPTAP_JSON",
      status: "DRAFT",
      attachments: [],
      relatedWorkItems: emptyRelatedWorkItems(),
      createdById: input.createdById,
      authorId: input.createdById,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(requirement.id, requirement);
    this.ensureParticipant(requirement.id, input.createdById, "CREATOR");

    return this.toPublic(requirement);
  }

  async findById(requirementId: string): Promise<Requirement | undefined> {
    const requirement = this.records.get(requirementId);

    return requirement ? this.toPublic(requirement) : undefined;
  }

  async isParticipant(
    _spaceId: string,
    requirementId: string,
    userId: string,
  ): Promise<boolean> {
    return this.participants.some(
      (participant) =>
        participant.targetId === requirementId && participant.userId === userId,
    );
  }

  async listBySpaceId(
    spaceId: string,
    input: RequirementListInput,
  ): Promise<RequirementListResult> {
    const items = [...this.records.values()].filter(
      (requirement) =>
        requirement.spaceId === spaceId &&
        (!input.versionId || requirement.versionId === input.versionId) &&
        (!input.ownerId || requirement.ownerId === input.ownerId) &&
        this.matchesStatusFilter(requirement, input) &&
        this.matchesVisibility(requirement, input),
    );

    return {
      items: items
        .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
        .map((requirement) => this.toPublic(requirement)),
      page: input.page,
      pageSize: input.pageSize,
      total: items.length,
    };
  }

  async save(input: SaveRequirementInput): Promise<Requirement | undefined> {
    const requirement = this.records.get(input.requirementId);

    if (!requirement) {
      return undefined;
    }

    requirement.title = input.title;
    requirement.summary = input.summary ?? requirement.summary;
    requirement.contentJson = input.contentJson;
    requirement.contentText = input.contentText ?? requirement.contentText;
    requirement.contentMarkdownCache =
      input.contentMarkdownCache ?? requirement.contentMarkdownCache;
    requirement.versionId = input.versionId ?? requirement.versionId;
    requirement.priority = input.priority ?? requirement.priority;
    requirement.status = "CONFIRMED";
    requirement.updatedAt = new Date().toISOString();
    if (input.shouldUpdateOwner) {
      requirement.ownerId = input.ownerId;
      if (input.ownerId) {
        this.removeParticipants(requirement.id, "ASSIGNEE", input.ownerId);
        this.ensureParticipant(requirement.id, input.ownerId, "ASSIGNEE");
      }
    }

    return this.toPublic(requirement);
  }

  async archive(input: ArchiveRequirementInput): Promise<Requirement | undefined> {
    const requirement = this.records.get(input.requirementId);

    if (!requirement) {
      return undefined;
    }

    requirement.status = "ARCHIVED";
    requirement.updatedAt = new Date().toISOString();
    return this.toPublic(requirement);
  }

  async deleteDraft(input: DeleteRequirementDraftInput): Promise<boolean> {
    const requirement = this.records.get(input.requirementId);

    if (!requirement || requirement.status !== "DRAFT") {
      return false;
    }

    this.records.delete(input.requirementId);
    for (let index = this.participants.length - 1; index >= 0; index -= 1) {
      if (this.participants[index]?.targetId === input.requirementId) {
        this.participants.splice(index, 1);
      }
    }

    return true;
  }

  participantsFor(requirementId: string) {
    return this.participants
      .filter((participant) => participant.targetId === requirementId)
      .map(({ relationType, userId }) => ({ relationType, userId }));
  }

  setDraftTitle(requirementId: string, title: string): void {
    const requirement = this.records.get(requirementId);

    if (requirement?.status === "DRAFT") {
      requirement.title = title;
    }
  }

  seedRelatedWorkItems(
    requirementId: string,
    relatedWorkItems: Requirement["relatedWorkItems"],
  ): void {
    const requirement = this.records.get(requirementId);

    if (requirement) {
      requirement.relatedWorkItems = cloneRelatedWorkItems(relatedWorkItems);
    }
  }

  private matchesStatusFilter(
    requirement: InternalRequirement,
    input: RequirementListInput,
  ): boolean {
    if (input.status) {
      return requirement.status === input.status;
    }
    if (input.includeDrafts) {
      return true;
    }

    return requirement.status !== "DRAFT";
  }

  private matchesVisibility(
    requirement: InternalRequirement,
    input: RequirementListInput,
  ): boolean {
    const isParticipant = this.isRequirementParticipant(
      requirement.id,
      input.actorUserId,
    );

    if (input.visibility === "ALL") {
      return requirement.status !== "DRAFT" || isParticipant;
    }

    if (input.visibility === "PARTICIPANT") {
      return isParticipant;
    }

    return requirement.status !== "DRAFT" || isParticipant;
  }

  private isRequirementParticipant(requirementId: string, userId: string) {
    return this.participants.some(
      (participant) =>
        participant.targetId === requirementId && participant.userId === userId,
    );
  }

  private ensureParticipant(
    targetId: string,
    userId: string,
    relationType: "ASSIGNEE" | "CREATOR",
  ): void {
    const existing = this.participants.some(
      (participant) =>
        participant.targetId === targetId &&
        participant.userId === userId &&
        participant.relationType === relationType,
    );

    if (!existing) {
      this.participants.push({
        targetId,
        userId,
        relationType,
      });
    }
  }

  private removeParticipants(
    targetId: string,
    relationType: "ASSIGNEE" | "CREATOR",
    exceptUserId: string,
  ): void {
    for (let index = this.participants.length - 1; index >= 0; index -= 1) {
      const participant = this.participants[index];

      if (
        participant.targetId === targetId &&
        participant.relationType === relationType &&
        participant.userId !== exceptUserId
      ) {
        this.participants.splice(index, 1);
      }
    }
  }

  private toPublic(requirement: InternalRequirement): Requirement {
    const { createdById: _createdById, ...publicRequirement } = requirement;

    return {
      ...publicRequirement,
      relatedWorkItems: cloneRelatedWorkItems(publicRequirement.relatedWorkItems),
    };
  }
}

class InMemoryAttachmentRepository implements AttachmentRepository {
  private readonly records = new Map<string, Attachment>();

  async countByTarget(
    targetType: AttachmentTargetType,
    targetId: string,
  ): Promise<number> {
    return [...this.records.values()].filter(
      (attachment) =>
        attachment.targetType === targetType && attachment.targetId === targetId,
    ).length;
  }

  async create(input: CreateAttachmentInput): Promise<Attachment> {
    const attachment: Attachment = {
      id: input.id,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetType: input.targetType,
      targetId: input.targetId,
      fileName: input.fileName,
      fileKey: input.fileKey,
      mimeType: input.mimeType,
      size: input.size,
      uploadedById: input.uploadedById,
      createdAt: new Date().toISOString(),
    };
    this.records.set(attachment.id, attachment);

    return attachment;
  }

  async findById(attachmentId: string): Promise<Attachment | undefined> {
    return this.records.get(attachmentId);
  }

  async listByTarget(input: {
    page: number;
    pageSize: number;
    targetId: string;
    targetType: AttachmentTargetType;
  }) {
    const matching = [...this.records.values()].filter(
      (attachment) =>
        attachment.targetType === input.targetType &&
        attachment.targetId === input.targetId,
    );

    return {
      items: matching.slice(
        (input.page - 1) * input.pageSize,
        input.page * input.pageSize,
      ),
      page: input.page,
      pageSize: input.pageSize,
      total: matching.length,
    };
  }

  seedTarget(
    organizationId: string,
    spaceId: string,
    targetType: AttachmentTargetType,
    targetId: string,
    count: number,
  ): void {
    for (let index = 0; index < count; index += 1) {
      const id = ulid();
      this.records.set(id, {
        id,
        organizationId,
        spaceId,
        targetType,
        targetId,
        fileName: `seed-${index}.png`,
        fileKey: `attachments/${targetType.toLowerCase()}/${targetId}/${id}.png`,
        mimeType: "image/png",
        size: 100,
        uploadedById: "seed-user",
        createdAt: new Date().toISOString(),
      });
    }
  }
}

function emptyRelatedWorkItems(): Requirement["relatedWorkItems"] {
  return {
    taskCount: 0,
    bugCount: 0,
    tasks: [],
    bugs: [],
  };
}

function cloneRelatedWorkItems(
  relatedWorkItems: Requirement["relatedWorkItems"],
): Requirement["relatedWorkItems"] {
  return {
    taskCount: relatedWorkItems.taskCount,
    bugCount: relatedWorkItems.bugCount,
    tasks: relatedWorkItems.tasks.map((item) => ({ ...item })),
    bugs: relatedWorkItems.bugs.map((item) => ({ ...item })),
  };
}
