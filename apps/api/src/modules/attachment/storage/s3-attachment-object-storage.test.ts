import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import { S3AttachmentObjectStorage } from "./s3-attachment-object-storage";

describe("S3AttachmentObjectStorage", () => {
  it("signs uploaded object size and MIME type into presigned PUT URLs", async () => {
    const storage = new S3AttachmentObjectStorage(createConfigService());

    const uploadUrl = await storage.createPresignedUploadUrl({
      expiresInSeconds: 600,
      key: "attachments/work_item/01ARZ3NDEKTSV4RRFFQ69G5FAV/01ARZ3NDEKTSV4RRFFQ69G5FB1-spec.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });

    const signedHeaders = new URL(uploadUrl).searchParams.get(
      "X-Amz-SignedHeaders",
    );

    expect(signedHeaders?.split(";")).toEqual([
      "content-length",
      "content-type",
      "host",
    ]);
  });
});

function createConfigService(): ConfigService {
  const values = new Map<string, string>([
    ["MINIO_ACCESS_KEY", "access-key"],
    ["MINIO_SECRET_KEY", "secret-key"],
    ["MINIO_REGION", "us-east-1"],
    ["MINIO_BUCKET", "crm-manager-attachments"],
    ["MINIO_INTERNAL_ENDPOINT", "http://127.0.0.1:9000"],
    ["MINIO_PUBLIC_ENDPOINT", "http://127.0.0.1:9000"],
  ]);

  return {
    get: vi.fn((key: string) => values.get(key)),
  } as unknown as ConfigService;
}
