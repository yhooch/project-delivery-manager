import type { TimelineEvent } from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import { getTimelineEventHref, getTimelineWorkItemType } from "./timeline-links";

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    actor: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      name: "Ada",
      username: "ada",
    },
    createdAt: "2026-05-13T10:00:00.000Z",
    eventType: "UPDATED",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
    organizationId: "01ARZ3NDEKTSV4RRFFQ69G5FA3",
    spaceId: "01ARZ3NDEKTSV4RRFFQ69G5FA4",
    target: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA5",
      title: "Target",
      type: "WORK_ITEM",
    },
    title: "Updated target",
    ...overrides,
  };
}

describe("timeline links", () => {
  it("routes work item events to bugs when metadata identifies a bug", () => {
    expect(
      getTimelineEventHref(makeEvent({ metadata: { workItemType: "BUG" } })),
    ).toBe("/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FA5");
  });

  it("routes work item events to tasks when metadata identifies a task", () => {
    expect(
      getTimelineEventHref(makeEvent({ metadata: { workItemType: "TASK" } })),
    ).toBe("/work-items?workItemId=01ARZ3NDEKTSV4RRFFQ69G5FA5");
  });

  it("infers bug events from bug-only timeline fields", () => {
    const event = makeEvent({ after: { severity: "HIGH" } });

    expect(getTimelineWorkItemType(event)).toBe("BUG");
    expect(getTimelineEventHref(event)).toBe(
      "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FA5",
    );
  });

  it("does not fabricate a work item link when the subtype is unknown", () => {
    expect(getTimelineEventHref(makeEvent())).toBeNull();
    expect(
      getTimelineEventHref(makeEvent(), { unknownWorkItemHref: "/overview" }),
    ).toBe("/overview");
  });

  it("routes non-work-item targets directly", () => {
    expect(
      getTimelineEventHref(
        makeEvent({
          target: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FA6",
            title: "Requirement",
            type: "REQUIREMENT",
          },
        }),
      ),
    ).toBe("/requirements/01ARZ3NDEKTSV4RRFFQ69G5FA6");
  });
});
