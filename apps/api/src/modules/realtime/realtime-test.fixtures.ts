import type { RealtimeEvent } from "@project-delivery/shared";
import { ulid } from "ulid";

export const REALTIME_ACTOR_ID = "01H00000000000000000000001";
export const REALTIME_ORGANIZATION_ID = "01H00000000000000000000002";
export const REALTIME_SPACE_ID = "01H00000000000000000000003";
export const REALTIME_TARGET_ID = "01H00000000000000000000004";

export function createRealtimeEventFixture(
  sequence: number,
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent {
  return {
    actorId: REALTIME_ACTOR_ID,
    hints: {
      changedFields: ["statusId"],
      workItemId: REALTIME_TARGET_ID,
      workItemType: "TASK",
    },
    id: ulid(),
    invalidates: ["work-item-list"],
    occurredAt: "2026-05-21T12:00:00.000Z",
    operation: "UPDATED",
    organizationId: REALTIME_ORGANIZATION_ID,
    sequence,
    spaceId: REALTIME_SPACE_ID,
    target: {
      id: REALTIME_TARGET_ID,
      type: "WORK_ITEM",
    },
    ...overrides,
  };
}
