import {
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  type Attachment,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  AttachmentUploadError,
  uploadRequirementImage,
  validateRequirementImageFile,
  type AttachmentApiTransport,
} from "./attachment-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const attachmentId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const fileKey = `attachments/requirement/${requirementId}/01ARZ3NDEKTSV4RRFFQ69G5FB1-wireframe.png`;
const uploadUrl = `https://object-storage.local/upload/${encodeURIComponent(fileKey)}`;
const downloadUrl = `https://object-storage.local/download/${encodeURIComponent(fileKey)}`;

function createImageFile() {
  return new File(["image"], "wireframe.png", {
    type: "image/png",
  });
}

function createAttachmentFixture(): Attachment {
  return {
    createdAt: "2026-05-13T10:00:00.000Z",
    fileKey,
    fileName: "wireframe.png",
    id: attachmentId,
    mimeType: "image/png",
    organizationId,
    size: 5,
    spaceId,
    targetId: requirementId,
    targetType: "REQUIREMENT",
    uploadedById: "01ARZ3NDEKTSV4RRFFQ69G5FB2",
  };
}

function createApi(): AttachmentApiTransport {
  return {
    get: vi.fn(async () => ({
      data: {
        downloadUrl,
        expiresInSeconds: 300,
      } as unknown,
    })) as AttachmentApiTransport["get"],
    post: vi.fn(async (path: string) => {
      if (path === "/attachments/presign") {
        return {
          data: {
            expiresInSeconds: 600,
            fileKey,
            uploadUrl,
          } as unknown,
        };
      }

      return {
        data: createAttachmentFixture() as unknown,
      };
    }) as AttachmentApiTransport["post"],
  };
}

describe("attachment service", () => {
  it("uploads requirement images through presign, object upload, register, and download-url", async () => {
    const api = createApi();
    const uploadObject = vi.fn(async () => undefined);
    const file = createImageFile();

    await expect(
      uploadRequirementImage(
        {
          existingAttachmentCount: 0,
          file,
          requirementId,
        },
        api,
        uploadObject,
      ),
    ).resolves.toEqual({
      attachment: createAttachmentFixture(),
      imageUrl: downloadUrl,
    });

    expect(api.post).toHaveBeenNthCalledWith(1, "/attachments/presign", {
      fileName: "wireframe.png",
      mimeType: "image/png",
      size: file.size,
      targetId: requirementId,
      targetType: "REQUIREMENT",
    });
    expect(uploadObject).toHaveBeenCalledWith(uploadUrl, file, "image/png");
    expect(api.post).toHaveBeenNthCalledWith(2, "/attachments", {
      fileKey,
      fileName: "wireframe.png",
      mimeType: "image/png",
      size: file.size,
      targetId: requirementId,
      targetType: "REQUIREMENT",
    });
    expect(api.get).toHaveBeenCalledWith(`/attachments/${attachmentId}/download-url`);
  });

  it("treats the M1 pseudo object-storage origin as an accepted local upload", async () => {
    const api = createApi();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await uploadRequirementImage({
      existingAttachmentCount: 0,
      file: createImageFile(),
      requirementId,
    }, api);

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects image files that exceed size, MIME, or count limits", () => {
    const largeFile = {
      name: "large.png",
      size: AttachmentMaxSizeBytes + 1,
      type: "image/png",
    } as File;
    const textFile = new File(["note"], "note.txt", {
      type: "text/plain",
    });

    expect(() =>
      validateRequirementImageFile({
        existingAttachmentCount: 0,
        file: largeFile,
        requirementId,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "FILE_TOO_LARGE",
      }),
    );
    expect(() =>
      validateRequirementImageFile({
        existingAttachmentCount: 0,
        file: textFile,
        requirementId,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "UNSUPPORTED_MIME_TYPE",
      }),
    );
    expect(() =>
      validateRequirementImageFile({
        existingAttachmentCount: AttachmentMaxCountPerTarget,
        file: createImageFile(),
        requirementId,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "ATTACHMENT_LIMIT_EXCEEDED",
      }),
    );
  });

  it("keeps failed object uploads retryable and does not register the attachment", async () => {
    const api = createApi();
    const uploadObject = vi.fn(async () => {
      throw new Error("object storage unavailable");
    });

    await expect(
      uploadRequirementImage(
        {
          existingAttachmentCount: 0,
          file: createImageFile(),
          requirementId,
        },
        api,
        uploadObject,
      ),
    ).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
      retryable: true,
    } satisfies Partial<AttachmentUploadError>);

    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
