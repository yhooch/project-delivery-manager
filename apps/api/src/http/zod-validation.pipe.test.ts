import type { ArgumentMetadata } from "@nestjs/common";
import { HttpStatus } from "@nestjs/common";
import { UlidSchema } from "@project-delivery/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiException } from "./api-exception";
import { ZodValidationPipe } from "./zod-validation.pipe";

const metadata: ArgumentMetadata = {
  data: undefined,
  metatype: undefined,
  type: "body",
};

describe("ZodValidationPipe", () => {
  it("returns parsed values from shared-compatible schemas", () => {
    const pipe = new ZodValidationPipe(
      z.object({
        id: UlidSchema,
      }),
    );

    expect(
      pipe.transform(
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        },
        metadata,
      ),
    ).toEqual({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
  });

  it("throws ApiException with VALIDATION_ERROR details", () => {
    const pipe = new ZodValidationPipe(
      z.object({
        id: UlidSchema,
      }),
    );

    expect(() => pipe.transform({ id: "not-a-ulid" }, metadata)).toThrow(
      ApiException,
    );

    try {
      pipe.transform({ id: "not-a-ulid" }, metadata);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).code).toBe("VALIDATION_ERROR");
      expect((error as ApiException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((error as ApiException).details).toEqual({
        issues: [
          expect.objectContaining({
            path: ["id"],
          }),
        ],
      });
    }
  });
});
