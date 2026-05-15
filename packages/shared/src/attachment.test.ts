import { describe, expect, it } from "vitest";

import {
  AttachmentMaxSizeBytes,
  CreateAttachmentRequestSchema,
  PresignAttachmentRequestSchema,
} from "./attachment.ts";

const TARGET_ID = "01H00000000000000000000001";

describe("attachment schemas", () => {
  it("accepts structurally valid upload metadata for presign requests", () => {
    expect(
      PresignAttachmentRequestSchema.parse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
        fileName: "spec.pdf",
        mimeType: "application/pdf",
        size: AttachmentMaxSizeBytes,
      }),
    ).toMatchObject({
      mimeType: "application/pdf",
      size: AttachmentMaxSizeBytes,
    });
  });

  it("leaves MIME allow-list and max-size checks to the attachment domain service", () => {
    expect(
      PresignAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
        fileName: "archive.bin",
        mimeType: "application/octet-stream",
        size: 1024,
      }).success,
    ).toBe(true);

    expect(
      CreateAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
        fileName: "spec.pdf",
        fileKey: `attachments/requirement/${TARGET_ID}/spec.pdf`,
        mimeType: "application/pdf",
        size: AttachmentMaxSizeBytes + 1,
      }).success,
    ).toBe(true);
  });

  it("still rejects structurally invalid upload metadata", () => {
    expect(
      PresignAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
        fileName: "empty.txt",
        mimeType: "",
        size: 1024,
      }).success,
    ).toBe(false);

    expect(
      CreateAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
        fileName: "spec.pdf",
        fileKey: `attachments/requirement/${TARGET_ID}/spec.pdf`,
        mimeType: "application/pdf",
        size: 0,
      }).success,
    ).toBe(false);

    expect(
      CreateAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
        fileName: "spec.pdf",
        fileKey: `attachments/requirement/${TARGET_ID}/spec.pdf`,
        mimeType: "application/pdf",
        size: 1024.5,
      }).success,
    ).toBe(false);
  });
});
