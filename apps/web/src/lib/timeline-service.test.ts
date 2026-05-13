import type { PageResult, TimelineEvent } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  listTimeline,
  listWorkItemTimeline,
  type TimelineApiTransport,
} from "./timeline-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const targetId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const eventId = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const actorId = "01ARZ3NDEKTSV4RRFFQ69G5FB2";

function createTimelineEventFixture(
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    actor: {
      id: actorId,
      name: "Ada",
      username: "ada",
    },
    createdAt: "2026-05-13T10:00:00.000Z",
    eventType: "UPDATED",
    id: eventId,
    organizationId,
    spaceId,
    target: {
      id: targetId,
      title: "Implement checkout scope",
      type: "WORK_ITEM",
    },
    title: "Updated work item",
    ...overrides,
  };
}

function createPage(items: TimelineEvent[]): PageResult<TimelineEvent> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function createApi(
  overrides: Partial<Record<keyof TimelineApiTransport, unknown>>,
): TimelineApiTransport {
  return {
    get: vi.fn(),
    ...overrides,
  } as TimelineApiTransport;
}

describe("timeline service", () => {
  it("lists timeline events by generic target", async () => {
    const page = createPage([createTimelineEventFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listTimeline(
        {
          organizationId,
          page: 1,
          pageSize: 20,
          spaceId,
          targetId,
          targetType: "WORK_ITEM",
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith("/timeline", {
      query: {
        page: 1,
        pageSize: 20,
        targetId,
        targetType: "WORK_ITEM",
      },
    });
  });

  it("lists work item timeline with a space context", async () => {
    const page = createPage([createTimelineEventFixture()]);
    const api = createApi({
      get: vi.fn(async () => ({ data: page })),
    });

    await expect(
      listWorkItemTimeline(
        {
          organizationId,
          page: 2,
          pageSize: 10,
          spaceId,
          workItemId: targetId,
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(api.get).toHaveBeenCalledWith(`/work-items/${targetId}/timeline`, {
      query: {
        page: 2,
        pageSize: 10,
      },
    });
  });
});
