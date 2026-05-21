import { Injectable } from "@nestjs/common";
import type { ObjectCodeType } from "@project-delivery/shared";
import { ulid } from "ulid";

import type { Prisma } from "../../generated/prisma/client";

type AllocationInput = {
  actorUserId?: string;
  count: number;
  objectType: ObjectCodeType;
  organizationId: string;
  spaceId: string;
};

type AllocationRange = {
  firstValue: number;
  lastValue: number;
};

@Injectable()
export class ObjectCodeAllocator {
  async allocateOne(
    tx: Prisma.TransactionClient,
    input: Omit<AllocationInput, "count">,
  ): Promise<number> {
    const range = await this.allocateRange(tx, { ...input, count: 1 });

    return range.firstValue;
  }

  async allocateRange(
    tx: Prisma.TransactionClient,
    input: AllocationInput,
  ): Promise<AllocationRange> {
    if (!Number.isInteger(input.count) || input.count < 1) {
      throw new Error("Object sequence allocation count must be positive");
    }

    const actorUserId = input.actorUserId ?? null;
    const rows = await tx.$queryRaw<{ first_value: number }[]>`
      INSERT INTO "object_sequence_counters" (
        "id",
        "organization_id",
        "space_id",
        "object_type",
        "next_value",
        "created_at",
        "updated_at",
        "created_by_id",
        "updated_by_id"
      )
      VALUES (
        ${ulid()},
        ${input.organizationId},
        ${input.spaceId},
        ${input.objectType}::"ObjectSequenceObjectType",
        ${input.count + 1},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        ${actorUserId},
        ${actorUserId}
      )
      ON CONFLICT ("space_id", "object_type")
      DO UPDATE SET
        "next_value" = "object_sequence_counters"."next_value" + ${input.count},
        "updated_at" = CURRENT_TIMESTAMP,
        "updated_by_id" = ${actorUserId}
      RETURNING "next_value" - ${input.count} AS "first_value"
    `;
    const firstValue = rows[0]?.first_value;

    if (typeof firstValue !== "number") {
      throw new Error("Object sequence allocation did not return a value");
    }

    return {
      firstValue,
      lastValue: firstValue + input.count - 1,
    };
  }
}
