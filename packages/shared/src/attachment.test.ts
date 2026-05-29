import { describe, expect, it } from "vitest";

import { UploadAttachmentRequestSchema } from "./attachment.ts";
import { LegacyAttachmentTargetTypeInputSchema } from "./enums.ts";

const TARGET_ID = "01H00000000000000000000001";

describe("attachment schemas", () => {
  it("accepts structurally valid upload target metadata", () => {
    expect(
      UploadAttachmentRequestSchema.parse({
        targetType: "DOCUMENT",
        targetId: TARGET_ID,
      }),
    ).toMatchObject({
      targetId: TARGET_ID,
      targetType: "DOCUMENT",
    });
  });

  it("leaves MIME allow-list and max-size checks to the attachment domain service", () => {
    expect(
      UploadAttachmentRequestSchema.safeParse({
        targetType: "DOCUMENT",
        targetId: TARGET_ID,
      }).success,
    ).toBe(true);
  });

  it("keeps legacy REQUIREMENT target parsing out of new upload requests", () => {
    expect(LegacyAttachmentTargetTypeInputSchema.parse("REQUIREMENT")).toBe(
      "REQUIREMENT",
    );
    expect(
      UploadAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
      }).success,
    ).toBe(false);
  });

  it("still rejects structurally invalid upload target metadata", () => {
    expect(
      UploadAttachmentRequestSchema.safeParse({
        targetType: "DOCUMENT",
        targetId: "not-an-id",
      }).success,
    ).toBe(false);

    expect(
      UploadAttachmentRequestSchema.safeParse({
        targetType: "DOCUMENT",
        targetId: TARGET_ID,
        fileName: "extra-field.txt",
      }).success,
    ).toBe(false);
  });
});
