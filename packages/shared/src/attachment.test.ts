import { describe, expect, it } from "vitest";

import {
  AttachmentMaxSizeBytes,
  CreateAttachmentRequestSchema,
  PresignAttachmentRequestSchema,
} from "./attachment.ts";

const TARGET_ID = "01H00000000000000000000001";

describe("attachment schemas", () => {
  it("accepts allowed MIME types up to the shared 20MB limit", () => {
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

  it("rejects unsupported MIME types and files larger than 20MB", () => {
    expect(
      PresignAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: TARGET_ID,
        fileName: "archive.bin",
        mimeType: "application/octet-stream",
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
        size: AttachmentMaxSizeBytes + 1,
      }).success,
    ).toBe(false);
  });
});
