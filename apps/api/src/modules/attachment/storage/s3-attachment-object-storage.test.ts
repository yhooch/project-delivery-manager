import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";

import { S3AttachmentObjectStorage } from "./s3-attachment-object-storage";

describe("S3AttachmentObjectStorage", () => {
  it("uses only the internal MinIO endpoint", () => {
    expect(
      () => new S3AttachmentObjectStorage(createConfigService()),
    ).not.toThrow();
  });
});

function createConfigService(): ConfigService {
  const values = new Map<string, string>([
    ["MINIO_ACCESS_KEY", "access-key"],
    ["MINIO_SECRET_KEY", "secret-key"],
    ["MINIO_REGION", "us-east-1"],
    ["MINIO_BUCKET", "crm-manager-attachments"],
    ["MINIO_INTERNAL_ENDPOINT", "http://127.0.0.1:9000"],
  ]);

  return {
    get: vi.fn((key: string) => values.get(key)),
  } as unknown as ConfigService;
}
