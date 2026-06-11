import type { TimelineEvent } from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import {
  getTimelineEventHref,
  getTimelineWorkItemType,
} from "./timeline-links";

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
    ).toBe(
      "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FA5&spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4&eventId=01ARZ3NDEKTSV4RRFFQ69G5FA2&panel=timeline",
    );
  });

  it("routes work item events to tasks when metadata identifies a task", () => {
    expect(
      getTimelineEventHref(makeEvent({ metadata: { workItemType: "TASK" } })),
    ).toBe(
      "/work-items?workItemId=01ARZ3NDEKTSV4RRFFQ69G5FA5&spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4&eventId=01ARZ3NDEKTSV4RRFFQ69G5FA2&panel=timeline",
    );
  });

  it("infers bug events from bug-only timeline fields", () => {
    const event = makeEvent({ after: { severity: "HIGH" } });

    expect(getTimelineWorkItemType(event)).toBe("BUG");
    expect(getTimelineEventHref(event)).toBe(
      "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FA5&spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4&eventId=01ARZ3NDEKTSV4RRFFQ69G5FA2&panel=timeline",
    );
  });

  it("routes comment events to the comments panel and target comment", () => {
    expect(
      getTimelineEventHref(
        makeEvent({
          eventType: "COMMENTED",
          metadata: {
            commentId: "01ARZ3NDEKTSV4RRFFQ69G5FCM1",
            workItemType: "TASK",
          },
        }),
      ),
    ).toBe(
      "/work-items?workItemId=01ARZ3NDEKTSV4RRFFQ69G5FA5&spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4&commentId=01ARZ3NDEKTSV4RRFFQ69G5FCM1&panel=comments",
    );
  });

  it("routes attachment events to the attachments panel and target attachment", () => {
    expect(
      getTimelineEventHref(
        makeEvent({
          eventType: "ATTACHMENT_ADDED",
          metadata: {
            attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAT1",
            workItemType: "BUG",
          },
        }),
      ),
    ).toBe(
      "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FA5&spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4&attachmentId=01ARZ3NDEKTSV4RRFFQ69G5FAT1&panel=attachments",
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
            displayCode: "REQ-12",
            id: "01ARZ3NDEKTSV4RRFFQ69G5FA6",
            title: "Requirement",
            type: "DOCUMENT",
          },
        }),
      ),
    ).toBe(
      "/requirements/01ARZ3NDEKTSV4RRFFQ69G5FA6?spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4",
    );
  });

  it("routes requirement document comments to document comments", () => {
    expect(
      getTimelineEventHref(
        makeEvent({
          eventType: "COMMENTED",
          metadata: {
            commentId: "01ARZ3NDEKTSV4RRFFQ69G5FCM1",
            targetKind: "REQUIREMENT",
          },
          target: {
            displayCode: "REQ-12",
            id: "01ARZ3NDEKTSV4RRFFQ69G5FA6",
            title: "Requirement",
            type: "DOCUMENT",
          },
        }),
      ),
    ).toBe(
      "/documents/01ARZ3NDEKTSV4RRFFQ69G5FA6?spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4&commentId=01ARZ3NDEKTSV4RRFFQ69G5FCM1&panel=comments",
    );
  });

  it("routes intake and version events to their timeline event", () => {
    expect(
      getTimelineEventHref(
        makeEvent({
          target: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FA7",
            title: "Intake",
            type: "INTAKE_ITEM",
          },
        }),
      ),
    ).toBe(
      "/intake-items?id=01ARZ3NDEKTSV4RRFFQ69G5FA7&spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4&eventId=01ARZ3NDEKTSV4RRFFQ69G5FA2&panel=timeline",
    );

    expect(
      getTimelineEventHref(
        makeEvent({
          target: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FA8",
            title: "Version",
            type: "VERSION",
          },
        }),
      ),
    ).toBe(
      "/versions?versionId=01ARZ3NDEKTSV4RRFFQ69G5FA8&eventId=01ARZ3NDEKTSV4RRFFQ69G5FA2&panel=timeline&spaceId=01ARZ3NDEKTSV4RRFFQ69G5FA4",
    );
  });
});
