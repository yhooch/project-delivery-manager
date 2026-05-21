import { describe, expect, it } from "vitest";

import { toTimelineEvent } from "./timeline.mappers";

describe("timeline mappers", () => {
  it("maps target display code for work item targets from concrete type", () => {
    const event = toTimelineEvent(timelineEvent(), {
      sequence: 6,
      title: "Fix checkout",
      workItemType: "BUG",
    });

    expect(event.target).toEqual({
      id: "01H00000000000000000000001",
      type: "WORK_ITEM",
      title: "Fix checkout",
      sequence: 6,
      displayCode: "BUG-6",
    });
  });
});

function timelineEvent(): Parameters<typeof toTimelineEvent>[0] {
  return {
    actor: {
      avatar: null,
      id: "01H00000000000000000000002",
      name: "Taylor",
      username: "taylor",
    },
    after: null,
    before: null,
    createdAt: new Date("2026-05-13T12:00:00.000Z"),
    detail: null,
    eventType: "UPDATED",
    id: "01H00000000000000000000003",
    metadata: null,
    organizationId: "01H00000000000000000000004",
    spaceId: "01H00000000000000000000005",
    targetId: "01H00000000000000000000001",
    targetType: "WORK_ITEM",
    title: "Updated",
  };
}
