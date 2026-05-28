import { describe, expect, it } from "vitest";
import {
  RealtimeEventSchema,
  RealtimeEventsQuerySchema,
  RealtimeHeartbeatSchema,
  RealtimeInvalidationKeySchema,
  RealtimeOperationSchema,
  RealtimePayloadHintsSchema,
  RealtimeResyncEventSchema,
  RealtimeResyncReasonSchema,
  RealtimeSseEventNameSchema,
  RealtimeSseRealtimeMessageSchema,
  apiContracts,
  generateOpenApiDocument,
} from "./index.ts";

const eventId = "01VRZ3NDEKTSV4RRFFQ69G5FAV";
const actorId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const organizationId = "01BRZ3NDEKTSV4RRFFQ69G5FAA";
const spaceId = "01DRZ3NDEKTSV4RRFFQ69G5FAC";
const workItemId = "01GRZ3NDEKTSV4RRFFQ69G5FAG";
const realtimeStreamId = "01HRZ3NDEKTSV4RRFFQ69G5FAH";
const occurredAt = "2026-05-21T10:30:00.000Z";

function realtimeEventFixture() {
  return {
    id: eventId,
    sequence: 42,
    occurredAt,
    actorId,
    organizationId,
    spaceId,
    target: {
      type: "WORK_ITEM",
      id: workItemId,
    },
    operation: "STATUS_CHANGED",
    invalidates: ["work-item-list", "version-board", "timeline"],
    hints: {
      targetType: "WORK_ITEM",
      targetId: workItemId,
      spaceId,
      workItemType: "TASK",
      changedFields: ["statusCategory", "currentStateId"],
      suggestFullRefresh: false,
      customRoutingHint: "kanban-column",
    },
  };
}

describe("realtime shared contracts", () => {
  it("freezes SSE event names, operations, invalidation keys and resync reasons", () => {
    expect(RealtimeSseEventNameSchema.options).toEqual([
      "realtime",
      "heartbeat",
      "realtime-resync",
    ]);
    expect(RealtimeOperationSchema.options).toEqual([
      "CREATED",
      "UPDATED",
      "DELETED",
      "STATUS_CHANGED",
      "COMMENTED",
      "ATTACHMENT_CHANGED",
      "TAG_CHANGED",
      "ASSIGNEE_CHANGED",
      "VERSION_CHANGED",
    ]);
    expect(RealtimeInvalidationKeySchema.options).toEqual([
      "workbench",
      "space-overview",
      "version-board",
      "work-item-list",
      "bug-list",
      "requirement-list",
      "requirement-detail",
      "intake-list",
      "exception-view",
      "timeline",
      "comments",
      "attachments",
      "document-list",
      "document-directory",
      "document-detail",
      "document-links",
      "document-comments",
      "document-attachments",
      "document-timeline",
      "resource-documents",
    ]);
    expect(RealtimeResyncReasonSchema.options).toEqual([
      "REPLAY_MISS",
      "REPLAY_EXPIRED",
      "SEQUENCE_GAP",
      "SERVER_RESTART",
    ]);
  });

  it("parses realtime event payloads as invalidation notices", () => {
    const event = RealtimeEventSchema.parse(realtimeEventFixture());

    expect(event.sequence).toBe(42);
    expect(event.target).toEqual({
      type: "WORK_ITEM",
      id: workItemId,
    });
    expect(event.invalidates).toEqual(
      expect.arrayContaining(["work-item-list", "version-board", "timeline"]),
    );
    expect(event.hints).toMatchObject({
      targetId: workItemId,
      suggestFullRefresh: false,
    });
  });

  it("rejects business content and attachment names in realtime hints", () => {
    expect(() =>
      RealtimePayloadHintsSchema.parse({
        targetId: workItemId,
        title: "Implement realtime",
      }),
    ).toThrow();
    expect(() =>
      RealtimePayloadHintsSchema.parse({
        targetId: workItemId,
        fileName: "incident-report.pdf",
      }),
    ).toThrow();
    expect(() =>
      RealtimePayloadHintsSchema.parse({
        targetId: workItemId,
        commentPreview: "looks good",
      }),
    ).toThrow();
  });

  it("freezes sequence cursor semantics for query and SSE id", () => {
    expect(RealtimeEventsQuerySchema.parse({ lastEventId: "42" })).toEqual({
      lastEventId: "42",
    });
    expect(
      RealtimeEventsQuerySchema.parse({
        lastEventId: `${realtimeStreamId}:42`,
      }),
    ).toEqual({
      lastEventId: `${realtimeStreamId}:42`,
    });
    expect(RealtimeEventsQuerySchema.parse({})).toEqual({});
    expect(() =>
      RealtimeEventsQuerySchema.parse({ lastEventId: "0" }),
    ).toThrow();
    expect(() =>
      RealtimeEventsQuerySchema.parse({ lastEventId: "01" }),
    ).toThrow();

    expect(
      RealtimeSseRealtimeMessageSchema.parse({
        event: "realtime",
        id: "42",
        data: realtimeEventFixture(),
      }).id,
    ).toBe("42");
    expect(
      RealtimeSseRealtimeMessageSchema.parse({
        event: "realtime",
        id: `${realtimeStreamId}:42`,
        data: realtimeEventFixture(),
      }).id,
    ).toBe(`${realtimeStreamId}:42`);
    expect(() =>
      RealtimeSseRealtimeMessageSchema.parse({
        event: "realtime",
        id: "43",
        data: realtimeEventFixture(),
      }),
    ).toThrow();
  });

  it("parses heartbeat and resync control events", () => {
    expect(RealtimeHeartbeatSchema.parse({ occurredAt })).toEqual({
      occurredAt,
    });
    expect(
      RealtimeResyncEventSchema.parse({
        reason: "SEQUENCE_GAP",
        occurredAt,
        invalidates: [],
        scope: {
          organizationId,
          spaceId,
        },
      }),
    ).toMatchObject({
      reason: "SEQUENCE_GAP",
      invalidates: [],
      scope: {
        organizationId,
        spaceId,
      },
    });
    expect(() =>
      RealtimeResyncEventSchema.parse({
        reason: "SEQUENCE_GAP",
        occurredAt,
        invalidates: [],
        scope: {
          organizationId,
          targetId: workItemId,
        },
      }),
    ).toThrow();
  });

  it("registers the SSE endpoint without JSON response wrapping", () => {
    const contract = apiContracts.find(
      (entry) => entry.operationId === "getRealtimeEvents",
    );
    expect(contract).toMatchObject({
      method: "get",
      path: "/realtime/events",
      responseContentType: "text/event-stream",
      responseWrapped: false,
      errorCodes: ["UNAUTHORIZED", "VALIDATION_ERROR"],
    });

    const document = generateOpenApiDocument();
    const operation = document.paths["/realtime/events"]?.get;
    const successContent = operation?.responses["200"] as
      | { content?: Record<string, unknown> }
      | undefined;

    expect(successContent?.content?.["text/event-stream"]).toBeDefined();
    expect(successContent?.content?.["application/json"]).toBeUndefined();
  });
});
