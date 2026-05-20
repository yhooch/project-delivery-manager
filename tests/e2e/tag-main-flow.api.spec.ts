import { expect, test, type APIResponse } from "@playwright/test";

import {
  CreateOrganizationResponseSchema,
  CreateSpaceResponseSchema,
  CreateTagResponseSchema,
  CreateWorkItemResponseSchema,
  DeleteTagResponseSchema,
  ListTagsResponseSchema,
  ListWorkItemsResponseSchema,
  ReplaceTagAssignmentsResponseSchema,
} from "../../packages/shared/src/index";
import {
  addOrganizationMember,
  addSpaceMember,
  buildM3RunId,
  expectData,
  expectRejected,
  get,
  m3UnsafeAuthHeaders,
  patch,
  post,
  registerAndLoginUser,
  skipWhenM3EnvironmentUnavailable,
  type M3User,
} from "./support/m3-env";
import { apiPath } from "./support/m0-env";

test.describe.configure({ mode: "serial" });

test.describe("TAG-G 标签 API 关键路径", () => {
  const runId = `tag_${buildM3RunId()}`.slice(0, 28);
  const password = `TAG-e2e-${runId}-Pass1`;
  const users: M3User[] = [];

  test.afterAll(async () => {
    await Promise.all(users.map((user) => user.context.dispose()));
  });

  test("覆盖创建幂等、权限、跨空间拒绝、对象替换、筛选计数和孤儿删除", async () => {
    await skipWhenM3EnvironmentUnavailable();

    const owner = await registerUser("owner");
    const pm = await registerUser("pm");
    const viewer = await registerUser("viewer");

    const organization = await expectData(
      await post(owner, "/organizations", {
        code: `${runId}_org`.slice(0, 32),
        name: `TAG Org ${runId}`,
      }),
      CreateOrganizationResponseSchema,
      "POST /organizations",
    );
    const space = await expectData(
      await post(owner, `/organizations/${organization.id}/spaces`, {
        code: `${runId}_main`.slice(0, 32),
        name: `TAG main ${runId}`,
      }),
      CreateSpaceResponseSchema,
      "POST /organizations/:organizationId/spaces",
    );
    const otherSpace = await expectData(
      await post(owner, `/organizations/${organization.id}/spaces`, {
        code: `${runId}_other`.slice(0, 32),
        name: `TAG other ${runId}`,
      }),
      CreateSpaceResponseSchema,
      "POST /organizations/:organizationId/spaces",
    );

    for (const user of [pm, viewer]) {
      await addOrganizationMember(owner, organization.id, user.username);
    }

    await addSpaceMember(owner, space.id, pm.id, "PM");
    await addSpaceMember(owner, space.id, viewer.id, "VIEWER");

    const releaseTag = await createTag(pm, space.id, "#release");
    const idempotentReleaseTag = await createTag(pm, space.id, " release ");
    const qaTag = await createTag(pm, space.id, "#qa");
    const crossSpaceTag = await createTag(owner, otherSpace.id, "#release");

    expect(idempotentReleaseTag.id).toBe(releaseTag.id);
    await expectRejected(
      await post(viewer, `/spaces/${space.id}/tags`, { name: "#viewer" }),
      "VIEWER 创建标签",
      [403],
    );

    const task = await expectData(
      await post(pm, `/spaces/${space.id}/work-items`, {
        priority: "HIGH",
        tagIds: [releaseTag.id],
        title: `Tagged task ${runId}`,
        type: "TASK",
      }),
      CreateWorkItemResponseSchema,
      "POST /spaces/:spaceId/work-items",
    );

    await expectRejected(
      await patch(pm, "/tag-assignments", {
        tagIds: [crossSpaceTag.id],
        targetId: task.id,
        targetType: "WORK_ITEM",
      }),
      "跨空间标签替换",
      [404],
    );

    const replaced = await expectData(
      await patch(pm, "/tag-assignments", {
        tagIds: [qaTag.id],
        targetId: task.id,
        targetType: "WORK_ITEM",
      }),
      ReplaceTagAssignmentsResponseSchema,
      "PATCH /tag-assignments",
    );

    expect(replaced.tags.map((tag) => tag.id)).toEqual([qaTag.id]);

    const taggedTasks = await expectData(
      await get(
        pm,
        `/spaces/${space.id}/work-items?type=TASK&tagIds=${qaTag.id}&tagMatch=ANY`,
      ),
      ListWorkItemsResponseSchema,
      "GET /spaces/:spaceId/work-items tag filter",
    );
    const oldTagTasks = await expectData(
      await get(
        pm,
        `/spaces/${space.id}/work-items?type=TASK&tagIds=${releaseTag.id}&tagMatch=ANY`,
      ),
      ListWorkItemsResponseSchema,
      "GET /spaces/:spaceId/work-items old tag filter",
    );

    expect(taggedTasks.items.map((item) => item.id)).toContain(task.id);
    expect(taggedTasks.statusCategoryCounts).toEqual(
      expect.arrayContaining([
        {
          count: expect.any(Number),
          statusCategory: task.statusCategory,
        },
      ]),
    );
    expect(oldTagTasks.items.map((item) => item.id)).not.toContain(task.id);

    const tagsWithUsage = await expectData(
      await get(pm, `/spaces/${space.id}/tags?includeUsage=true&pageSize=50`),
      ListTagsResponseSchema,
      "GET /spaces/:spaceId/tags",
    );
    const releaseUsage = tagsWithUsage.items.find(
      (tag) => tag.id === releaseTag.id,
    );
    const qaUsage = tagsWithUsage.items.find((tag) => tag.id === qaTag.id);

    expect(releaseUsage).toMatchObject({ isOrphan: true, usageCount: 0 });
    expect(qaUsage).toMatchObject({ isOrphan: false, usageCount: 1 });

    await expectRejected(
      await deleteTag(pm, qaTag.id),
      "删除仍被对象使用的标签",
      [409],
    );
    await expectData(
      await deleteTag(pm, releaseTag.id),
      DeleteTagResponseSchema,
      "DELETE /tags/:tagId",
    );

    const tagsAfterDelete = await expectData(
      await get(pm, `/spaces/${space.id}/tags?includeUsage=true&pageSize=50`),
      ListTagsResponseSchema,
      "GET /spaces/:spaceId/tags after delete",
    );

    expect(tagsAfterDelete.items.map((tag) => tag.id)).not.toContain(
      releaseTag.id,
    );
  });

  async function registerUser(suffix: string): Promise<M3User> {
    const user = await registerAndLoginUser(
      `${runId}_${suffix}`.slice(0, 32),
      password,
    );

    users.push(user);

    return user;
  }
});

async function createTag(actor: M3User, spaceId: string, name: string) {
  return expectData(
    await post(actor, `/spaces/${spaceId}/tags`, { name }),
    CreateTagResponseSchema,
    "POST /spaces/:spaceId/tags",
  );
}

function deleteTag(actor: M3User, tagId: string): Promise<APIResponse> {
  return actor.context.delete(apiPath(`/tags/${tagId}`), {
    headers: m3UnsafeAuthHeaders(actor),
  });
}
