import type { SpaceRole } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { RealtimePermissionService } from "./realtime-permission.service";
import {
  REALTIME_ACTOR_ID,
  createRealtimeEventFixture,
} from "./realtime-test.fixtures";

describe("RealtimePermissionService", () => {
  it("rejects events when the user has no active organization or space access", async () => {
    const { client, service } = createSubject();
    client.organizationMember.findFirst.mockResolvedValue(undefined);

    await expect(
      service.canReadEvent(REALTIME_ACTOR_ID, createRealtimeEventFixture(1)),
    ).resolves.toBe(false);

    expect(client.workItem.findFirst).not.toHaveBeenCalled();
  });

  it("rejects events whose target is not in the event organization and space", async () => {
    const { client, service } = createSubject("PM");
    client.workItem.findFirst.mockResolvedValue(undefined);

    await expect(
      service.canReadEvent(REALTIME_ACTOR_ID, createRealtimeEventFixture(1)),
    ).resolves.toBe(false);

    expect(client.workItem.findFirst).toHaveBeenCalledWith({
      select: {
        id: true,
        statusCategory: true,
        type: true,
      },
      where: expect.objectContaining({
        organizationId: "01H00000000000000000000002",
        spaceId: "01H00000000000000000000003",
      }),
    });
  });

  it("allows space-wide work item readers without checking object participation", async () => {
    const { client, service } = createSubject("PM");
    client.workItem.findFirst.mockResolvedValue({
      id: "work-item",
      statusCategory: "IN_PROGRESS",
      type: "TASK",
    });

    await expect(
      service.canReadEvent(REALTIME_ACTOR_ID, createRealtimeEventFixture(1)),
    ).resolves.toBe(true);

    expect(client.objectParticipant.findFirst).not.toHaveBeenCalled();
  });

  it("uses object participants for restricted work item visibility", async () => {
    const { client, service } = createSubject("DEVELOPER");
    client.workItem.findFirst.mockResolvedValue({
      id: "work-item",
      statusCategory: "IN_PROGRESS",
      type: "TASK",
    });
    client.objectParticipant.findFirst.mockResolvedValueOnce(undefined);

    await expect(
      service.canReadEvent(REALTIME_ACTOR_ID, createRealtimeEventFixture(1)),
    ).resolves.toBe(false);

    client.objectParticipant.findFirst.mockResolvedValueOnce({
      id: "participant",
    });

    await expect(
      service.canReadEvent(REALTIME_ACTOR_ID, createRealtimeEventFixture(2)),
    ).resolves.toBe(true);
  });

  it("allows recently removed work item participants to receive the invalidation", async () => {
    const { client, service } = createSubject("DEVELOPER");
    client.workItem.findFirst.mockResolvedValue({
      id: "work-item",
      statusCategory: "IN_PROGRESS",
      type: "TASK",
    });
    client.objectParticipant.findFirst.mockResolvedValueOnce({
      id: "removed-participant",
    });

    await expect(
      service.canReadEvent(REALTIME_ACTOR_ID, createRealtimeEventFixture(1)),
    ).resolves.toBe(true);

    expect(client.objectParticipant.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        OR: [
          { deletedAt: null },
          {
            deletedAt: {
              gte: new Date("2026-05-21T11:55:00.000Z"),
              lte: new Date("2026-05-21T12:00:00.000Z"),
            },
            updatedById: REALTIME_ACTOR_ID,
          },
        ],
        targetType: "WORK_ITEM",
      }),
    });
  });

  it("requires participant visibility for draft requirements even for privileged roles", async () => {
    const { client, service } = createSubject("PM");
    client.requirement.findFirst.mockResolvedValue({
      deletedAt: null,
      id: "requirement",
      status: "DRAFT",
    });
    client.objectParticipant.findFirst.mockResolvedValueOnce(undefined);

    await expect(
      service.canReadEvent(
        REALTIME_ACTOR_ID,
        createRealtimeEventFixture(1, {
          target: {
            id: "01H00000000000000000000004",
            type: "REQUIREMENT",
          },
        }),
      ),
    ).resolves.toBe(false);

    client.objectParticipant.findFirst.mockResolvedValueOnce({
      id: "participant",
    });

    await expect(
      service.canReadEvent(
        REALTIME_ACTOR_ID,
        createRealtimeEventFixture(2, {
          target: {
            id: "01H00000000000000000000004",
            type: "REQUIREMENT",
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it("allows recently removed draft requirement participants to receive the invalidation", async () => {
    const { client, service } = createSubject("PM");
    client.requirement.findFirst.mockResolvedValue({
      deletedAt: null,
      id: "requirement",
      status: "DRAFT",
    });
    client.objectParticipant.findFirst.mockResolvedValueOnce({
      id: "removed-participant",
    });

    await expect(
      service.canReadEvent(
        REALTIME_ACTOR_ID,
        createRealtimeEventFixture(1, {
          target: {
            id: "01H00000000000000000000004",
            type: "REQUIREMENT",
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(client.objectParticipant.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        OR: [
          { deletedAt: null },
          {
            deletedAt: {
              gte: new Date("2026-05-21T11:55:00.000Z"),
              lte: new Date("2026-05-21T12:00:00.000Z"),
            },
            updatedById: REALTIME_ACTOR_ID,
          },
        ],
        targetType: "REQUIREMENT",
      }),
    });
  });

  it("allows recently removed intake participants to receive the invalidation", async () => {
    const { client, service } = createSubject("DEVELOPER");
    client.intakeItem.findFirst.mockResolvedValue({
      id: "intake-item",
    });
    client.objectParticipant.findFirst.mockResolvedValueOnce({
      id: "removed-participant",
    });

    await expect(
      service.canReadEvent(
        REALTIME_ACTOR_ID,
        createRealtimeEventFixture(1, {
          target: {
            id: "01H00000000000000000000004",
            type: "INTAKE_ITEM",
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(client.objectParticipant.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        OR: [
          { deletedAt: null },
          {
            deletedAt: {
              gte: new Date("2026-05-21T11:55:00.000Z"),
              lte: new Date("2026-05-21T12:00:00.000Z"),
            },
            updatedById: REALTIME_ACTOR_ID,
          },
        ],
        targetType: "INTAKE_ITEM",
      }),
    });
  });

  it("allows deleted draft requirement events for participants removed by the same soft delete", async () => {
    const deletedAt = new Date("2026-05-21T12:30:00.000Z");
    const { client, service } = createSubject("PM");
    client.requirement.findFirst.mockResolvedValue({
      deletedAt,
      id: "requirement",
      status: "DRAFT",
    });
    client.objectParticipant.findFirst.mockResolvedValueOnce({
      id: "participant",
    });

    await expect(
      service.canReadEvent(
        REALTIME_ACTOR_ID,
        createRealtimeEventFixture(1, {
          operation: "DELETED",
          target: {
            id: "01H00000000000000000000004",
            type: "REQUIREMENT",
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(client.requirement.findFirst).toHaveBeenCalledWith({
      select: {
        deletedAt: true,
        id: true,
        status: true,
      },
      where: expect.not.objectContaining({
        deletedAt: null,
      }),
    });
    expect(client.objectParticipant.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        deletedAt,
        targetType: "REQUIREMENT",
      }),
    });
  });
});

function createSubject(role: SpaceRole = "DEVELOPER") {
  const client = {
    intakeItem: {
      findFirst: vi.fn(),
    },
    objectParticipant: {
      findFirst: vi.fn(),
    },
    organizationMember: {
      findFirst: vi.fn().mockResolvedValue({ id: "organization-member" }),
    },
    requirement: {
      findFirst: vi.fn(),
    },
    space: {
      findFirst: vi.fn(),
    },
    spaceMember: {
      findFirst: vi.fn().mockResolvedValue({ role }),
    },
    version: {
      findFirst: vi.fn(),
    },
    workItem: {
      findFirst: vi.fn(),
    },
  };
  const service = new RealtimePermissionService({
    client,
  } as unknown as PrismaService);

  return { client, service };
}
