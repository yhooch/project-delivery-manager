import {
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  type Attachment,
  type PageResult,
} from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "./api-client";
import {
  AttachmentUploadError,
  createAttachmentDownloadUrl,
  createAttachmentUploadFailure,
  getAttachmentUploadErrorDetails,
  listAttachments,
  uploadAttachment,
  uploadRequirementImage,
  validateAttachmentFile,
  validateRequirementImageFile,
  type AttachmentApiTransport,
} from "./attachment-service";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const requirementId = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const attachmentId = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const fileKey = `attachments/requirement/${requirementId}/01ARZ3NDEKTSV4RRFFQ69G5FB1-wireframe.png`;
const downloadUrl = `/api/v1/attachments/${attachmentId}/download`;

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
    targetType: "DOCUMENT",
    uploadedById: "01ARZ3NDEKTSV4RRFFQ69G5FB2",
  };
}

function createPage(items: Attachment[]): PageResult<Attachment> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
  };
}

function createApi(): AttachmentApiTransport {
  return {
    get: vi.fn(async () => ({
      data: createPage([createAttachmentFixture()]) as unknown,
    })) as AttachmentApiTransport["get"],
    post: vi.fn(async () => ({
      data: createAttachmentFixture() as unknown,
    })) as AttachmentApiTransport["post"],
  };
}

describe("attachment service", () => {
  it("uploads requirement images through the API", async () => {
    const api = createApi();
    const file = createImageFile();

    await expect(
      uploadRequirementImage(
        {
          existingAttachmentCount: 0,
          file,
          requirementId,
        },
        api,
      ),
    ).resolves.toEqual({
      attachment: createAttachmentFixture(),
      imageUrl: downloadUrl,
    });

    const formData = vi.mocked(api.post).mock.calls[0]?.[1];
    expect(api.post).toHaveBeenCalledWith("/attachments", expect.any(FormData));
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get("targetId")).toBe(requirementId);
    expect((formData as FormData).get("targetType")).toBe("DOCUMENT");
    expect((formData as FormData).get("file")).toMatchObject({
      name: file.name,
      size: file.size,
      type: file.type,
    });
  });

  it("uploads WORK_ITEM attachments through the same API endpoint", async () => {
    const api = createApi();
    const file = new File(["note"], "note.md", {
      type: "text/markdown",
    });
    const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
    const workItemAttachment = {
      ...createAttachmentFixture(),
      fileName: "note.md",
      mimeType: "text/markdown",
      size: file.size,
      targetId: workItemId,
      targetType: "WORK_ITEM",
    } satisfies Attachment;
    const workItemApi = {
      ...api,
      post: vi.fn(async () => ({
        data: workItemAttachment as unknown,
      })) as AttachmentApiTransport["post"],
    };

    await expect(
      uploadAttachment(
        {
          existingAttachmentCount: 0,
          file,
          targetId: workItemId,
          targetType: "WORK_ITEM",
        },
        workItemApi,
      ),
    ).resolves.toEqual({
      attachment: workItemAttachment,
      downloadUrl: `/api/v1/attachments/${workItemAttachment.id}/download`,
    });

    const formData = vi.mocked(workItemApi.post).mock.calls[0]?.[1];
    expect(workItemApi.post).toHaveBeenCalledWith(
      "/attachments",
      expect.any(FormData),
    );
    expect((formData as FormData).get("targetId")).toBe(workItemId);
    expect((formData as FormData).get("targetType")).toBe("WORK_ITEM");
    expect((formData as FormData).get("file")).toMatchObject({
      name: file.name,
      size: file.size,
      type: file.type,
    });
  });

  it("lists attachments by target with a required space context", async () => {
    const page = createPage([createAttachmentFixture()]);
    const get = vi.fn(async () => ({
      data: page as unknown,
    })) as AttachmentApiTransport["get"];
    const api = {
      ...createApi(),
      get,
    } as AttachmentApiTransport;

    await expect(
      listAttachments(
        {
          organizationId,
          page: 1,
          pageSize: 20,
          spaceId,
          targetId: requirementId,
          targetType: "DOCUMENT",
        },
        api,
      ),
    ).resolves.toEqual(page);

    expect(get).toHaveBeenCalledWith("/attachments", {
      query: {
        page: 1,
        pageSize: 20,
        targetId: requirementId,
        targetType: "DOCUMENT",
      },
    });
  });

  it("builds same-origin attachment download URLs by attachment id", () => {
    expect(createAttachmentDownloadUrl(attachmentId)).toBe(downloadUrl);
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
    expect(
      validateAttachmentFile({
        existingAttachmentCount: 0,
        file: textFile,
        targetId: requirementId,
        targetType: "WORK_ITEM",
      }),
    ).toBe("text/plain");
  });

  it("keeps API upload failures retryable", async () => {
    const file = createImageFile();
    const api = {
      ...createApi(),
      post: vi.fn(async () => {
        throw new ApiClientError(
          {
            code: "INTERNAL_SERVER_ERROR",
            message: "Upload failed",
            requestId: "req_attachment",
          },
          new Response(null, { status: 500 }),
        );
      }) as AttachmentApiTransport["post"],
    };

    await expect(
      uploadRequirementImage(
        {
          existingAttachmentCount: 0,
          file,
          requirementId,
        },
        api,
      ),
    ).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
      retryable: true,
    } satisfies Partial<AttachmentUploadError>);
  });

  it("preserves server-side FILE_TOO_LARGE upload errors", async () => {
    const file = createImageFile();
    const apiError = new ApiClientError(
      {
        code: "FILE_TOO_LARGE",
        details: {
          field: "file",
          issues: [
            {
              code: "too_big",
              message: "Max 10 MB",
              path: ["file"],
            },
          ],
          reason: "backend-limit",
          requestId: "req_attachment_details",
        },
        message: "File exceeds backend limit",
        requestId: "req_attachment",
      },
      new Response(null, { status: 413 }),
    );
    const api = {
      ...createApi(),
      post: vi.fn(async () => {
        throw apiError;
      }) as AttachmentApiTransport["post"],
    };

    let caught: unknown;
    try {
      await uploadAttachment(
        {
          existingAttachmentCount: 0,
          file,
          targetId: requirementId,
          targetType: "WORK_ITEM",
        },
        api,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AttachmentUploadError);
    expect(caught).toMatchObject({
      code: "FILE_TOO_LARGE",
      retryable: false,
    } satisfies Partial<AttachmentUploadError>);
    expect(caught).toHaveProperty("sourceError", apiError);
    expect(caught).toHaveProperty("cause", apiError);
    expect(getAttachmentUploadErrorDetails(caught)).toEqual({
      details: {
        field: "file",
        issues: [
          {
            code: "too_big",
            message: "Max 10 MB",
            path: "file",
          },
        ],
        reason: "backend-limit",
        requestId: "req_attachment_details",
        summary: [
          {
            key: "field",
            value: "file",
          },
          {
            key: "reason",
            value: "backend-limit",
          },
          {
            key: "requestId",
            value: "req_attachment_details",
          },
        ],
      },
      messageKey: "errors.api.FILE_TOO_LARGE",
      requestId: "req_attachment",
      serverMessage: "File exceeds backend limit",
    });
  });

  it("maps upload failures into retryable localized form state", () => {
    const file = createImageFile();
    const failure = createAttachmentUploadFailure(
      file,
      new ApiClientError(
        {
          code: "SPACE_ACCESS_DENIED",
          message: "No access",
          requestId: "req_attachment",
        },
        new Response(null, { status: 403 }),
      ),
    );

    expect(failure).toEqual({
      code: "ACCESS_DENIED",
      fileName: "wireframe.png",
      retryable: false,
    });
  });
});
