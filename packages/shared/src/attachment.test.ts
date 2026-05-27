import { describe, expect, it } from "vitest";

import { UploadAttachmentRequestSchema } from "./attachment.ts";

const TARGET_ID = "01H00000000000000000000001";

describe("attachment schemas", () => {
  it("accepts structurally valid upload target metadata", () => {
    expect(
      UploadAttachmentRequestSchema.parse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
      }),
    ).toMatchObject({
      targetId: TARGET_ID,
      targetType: "REQUIREMENT",
    });
  });

  it("leaves MIME allow-list and max-size checks to the attachment domain service", () => {
    expect(
      UploadAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
      }).success,
    ).toBe(true);
  });

  it("still rejects structurally invalid upload target metadata", () => {
    expect(
      UploadAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: "not-an-id",
      }).success,
    ).toBe(false);

    expect(
      UploadAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
        fileName: "extra-field.txt",
      }).success,
    ).toBe(false);
  });
});
