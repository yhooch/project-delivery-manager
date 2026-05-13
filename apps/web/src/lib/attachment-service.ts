import {
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  AttachmentMimeTypeSchema,
  CreateAttachmentResponseSchema,
  GetAttachmentDownloadUrlResponseSchema,
  PresignAttachmentResponseSchema,
  type Attachment,
  type AttachmentMimeType,
} from "@project-delivery/shared";

import { ApiClientError, apiClient, type ApiRequestInit } from "./api-client";

export type AttachmentApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

export type UploadObject = (
  uploadUrl: string,
  file: File,
  mimeType: AttachmentMimeType,
) => Promise<void>;

export type AttachmentUploadErrorCode =
  | "ATTACHMENT_LIMIT_EXCEEDED"
  | "DRAFT_REQUIRED"
  | "FILE_TOO_LARGE"
  | "TARGET_NOT_FOUND"
  | "UNSUPPORTED_MIME_TYPE"
  | "UPLOAD_FAILED"
  | "VALIDATION_FAILED";

export class AttachmentUploadError extends Error {
  readonly code: AttachmentUploadErrorCode;
  readonly retryable: boolean;

  constructor(code: AttachmentUploadErrorCode, retryable = false) {
    super(code);
    this.name = "AttachmentUploadError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type UploadRequirementImageInput = {
  existingAttachmentCount: number;
  file: File;
  requirementId: string;
};

export type UploadRequirementImageResult = {
  attachment: Attachment;
  imageUrl: string;
};

const defaultApi: AttachmentApiTransport = apiClient;
const defaultUploadObject: UploadObject = async (uploadUrl, file, mimeType) => {
  if (isM1PseudoObjectStorageUrl(uploadUrl)) {
    return;
  }

  const response = await fetch(uploadUrl, {
    body: file,
    headers: {
      "Content-Type": mimeType,
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new AttachmentUploadError("UPLOAD_FAILED", true);
  }
};

export async function uploadRequirementImage(
  input: UploadRequirementImageInput,
  api: AttachmentApiTransport = defaultApi,
  uploadObject: UploadObject = defaultUploadObject,
): Promise<UploadRequirementImageResult> {
  const mimeType = validateRequirementImageFile(input);

  try {
    const presignResponse = await api.post<unknown>("/attachments/presign", {
      fileName: input.file.name,
      mimeType,
      size: input.file.size,
      targetId: input.requirementId,
      targetType: "REQUIREMENT",
    });
    const presign = PresignAttachmentResponseSchema.parse(presignResponse.data);

    await uploadObject(presign.uploadUrl, input.file, mimeType);

    const attachmentResponse = await api.post<unknown>("/attachments", {
      fileKey: presign.fileKey,
      fileName: input.file.name,
      mimeType,
      size: input.file.size,
      targetId: input.requirementId,
      targetType: "REQUIREMENT",
    });
    const attachment = CreateAttachmentResponseSchema.parse(
      attachmentResponse.data,
    );
    const downloadResponse = await api.get<unknown>(
      `/attachments/${attachment.id}/download-url`,
    );
    const download = GetAttachmentDownloadUrlResponseSchema.parse(
      downloadResponse.data,
    );

    return {
      attachment,
      imageUrl: attachment.previewUrl ?? download.downloadUrl,
    };
  } catch (error) {
    throw mapAttachmentUploadError(error);
  }
}

export function validateRequirementImageFile(
  input: UploadRequirementImageInput,
): AttachmentMimeType {
  if (input.existingAttachmentCount >= AttachmentMaxCountPerTarget) {
    throw new AttachmentUploadError("ATTACHMENT_LIMIT_EXCEEDED");
  }

  if (input.file.size <= 0 || input.file.size > AttachmentMaxSizeBytes) {
    throw new AttachmentUploadError("FILE_TOO_LARGE");
  }

  const parsedMimeType = AttachmentMimeTypeSchema.safeParse(input.file.type);

  if (!parsedMimeType.success || !isImageMimeType(parsedMimeType.data)) {
    throw new AttachmentUploadError("UNSUPPORTED_MIME_TYPE");
  }

  return parsedMimeType.data;
}

function isImageMimeType(mimeType: AttachmentMimeType): boolean {
  return mimeType.startsWith("image/");
}

function isM1PseudoObjectStorageUrl(uploadUrl: string): boolean {
  try {
    return new URL(uploadUrl).hostname === "object-storage.local";
  } catch {
    return false;
  }
}

function mapAttachmentUploadError(error: unknown): AttachmentUploadError {
  if (error instanceof AttachmentUploadError) {
    return error;
  }

  if (error instanceof ApiClientError) {
    if (error.error.code === "DRAFT_REQUIREMENT_REQUIRED") {
      return new AttachmentUploadError("DRAFT_REQUIRED");
    }
    if (error.error.code === "ATTACHMENT_TARGET_NOT_FOUND") {
      return new AttachmentUploadError("TARGET_NOT_FOUND");
    }
    if (error.error.code === "VALIDATION_ERROR") {
      return new AttachmentUploadError("VALIDATION_FAILED");
    }
  }

  return new AttachmentUploadError("UPLOAD_FAILED", true);
}
