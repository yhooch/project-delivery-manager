import {
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  AttachmentListQuerySchema,
  AttachmentMimeTypeSchema,
  CreateAttachmentResponseSchema,
  GetAttachmentDownloadUrlResponseSchema,
  ListAttachmentsResponseSchema,
  PresignAttachmentResponseSchema,
  type Attachment,
  type AttachmentTargetType,
  type GetAttachmentDownloadUrlResponse,
  type AttachmentMimeType,
  type PageResult,
} from "@project-delivery/shared";
import { z } from "zod";

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
  | "ACCESS_DENIED"
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

export type UploadAttachmentInput = {
  existingAttachmentCount: number;
  file: File;
  imageOnly?: boolean;
  targetId: string;
  targetType: AttachmentTargetType;
};

export type ListAttachmentsInput = z.input<typeof AttachmentListQuerySchema> & {
  organizationId?: string;
  spaceId: string;
};

export type GetAttachmentDownloadUrlInput = {
  attachmentId: string;
  organizationId?: string;
  spaceId?: string;
};

export type AttachmentUploadFailure = {
  code: AttachmentUploadErrorCode;
  fileName: string;
  retryable: boolean;
};

export type UploadRequirementImageResult = {
  attachment: Attachment;
  imageUrl: string;
};

export type UploadAttachmentResult = {
  attachment: Attachment;
  downloadUrl: string;
};

export const attachmentUploadFailureSchema = z
  .object({
    code: z.enum([
      "ACCESS_DENIED",
      "ATTACHMENT_LIMIT_EXCEEDED",
      "DRAFT_REQUIRED",
      "FILE_TOO_LARGE",
      "TARGET_NOT_FOUND",
      "UNSUPPORTED_MIME_TYPE",
      "UPLOAD_FAILED",
      "VALIDATION_FAILED",
    ]),
    fileName: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

const defaultApi: AttachmentApiTransport = apiClient;
const defaultUploadObject: UploadObject = async (uploadUrl, file, mimeType) => {
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
  const result = await uploadAttachment(
    {
      existingAttachmentCount: input.existingAttachmentCount,
      file: input.file,
      imageOnly: true,
      targetId: input.requirementId,
      targetType: "REQUIREMENT",
    },
    api,
    uploadObject,
  );

  return {
    attachment: result.attachment,
    imageUrl: result.attachment.previewUrl ?? result.downloadUrl,
  };
}

export async function uploadAttachment(
  input: UploadAttachmentInput,
  api: AttachmentApiTransport = defaultApi,
  uploadObject: UploadObject = defaultUploadObject,
): Promise<UploadAttachmentResult> {
  const mimeType = validateAttachmentFile(input);

  try {
    const presignResponse = await api.post<unknown>("/attachments/presign", {
      fileName: input.file.name,
      mimeType,
      size: input.file.size,
      targetId: input.targetId,
      targetType: input.targetType,
    });
    const presign = PresignAttachmentResponseSchema.parse(presignResponse.data);

    await uploadObject(presign.uploadUrl, input.file, mimeType);

    const attachmentResponse = await api.post<unknown>("/attachments", {
      fileKey: presign.fileKey,
      fileName: input.file.name,
      mimeType,
      size: input.file.size,
      targetId: input.targetId,
      targetType: input.targetType,
    });
    const attachment = CreateAttachmentResponseSchema.parse(
      attachmentResponse.data,
    );
    const download = await getAttachmentDownloadUrl(
      { attachmentId: attachment.id },
      api,
    );

    return {
      attachment,
      downloadUrl: download.downloadUrl,
    };
  } catch (error) {
    throw mapAttachmentUploadError(error);
  }
}

export async function getAttachmentDownloadUrl(
  input: GetAttachmentDownloadUrlInput,
  api: AttachmentApiTransport = defaultApi,
): Promise<GetAttachmentDownloadUrlResponse> {
  const {
    attachmentId,
    organizationId: _organizationId,
    spaceId: _spaceId,
  } = input;
  const response = await api.get<unknown>(
    `/attachments/${attachmentId}/download-url`,
  );

  return GetAttachmentDownloadUrlResponseSchema.parse(response.data);
}

export async function listAttachments(
  input: ListAttachmentsInput,
  api: AttachmentApiTransport = defaultApi,
): Promise<PageResult<Attachment>> {
  const {
    organizationId: _organizationId,
    spaceId: _spaceId,
    ...query
  } = input;
  const filters = AttachmentListQuerySchema.parse(query);
  const response = await api.get<unknown>("/attachments", {
    query: filters,
  });

  return ListAttachmentsResponseSchema.parse(response.data);
}

export function validateRequirementImageFile(
  input: UploadRequirementImageInput,
): AttachmentMimeType {
  return validateAttachmentFile({
    existingAttachmentCount: input.existingAttachmentCount,
    file: input.file,
    imageOnly: true,
    targetId: input.requirementId,
    targetType: "REQUIREMENT",
  });
}

export function validateAttachmentFile(
  input: UploadAttachmentInput,
): AttachmentMimeType {
  if (input.existingAttachmentCount >= AttachmentMaxCountPerTarget) {
    throw new AttachmentUploadError("ATTACHMENT_LIMIT_EXCEEDED");
  }

  if (input.file.size <= 0 || input.file.size > AttachmentMaxSizeBytes) {
    throw new AttachmentUploadError("FILE_TOO_LARGE");
  }

  const parsedMimeType = AttachmentMimeTypeSchema.safeParse(input.file.type);

  if (
    !parsedMimeType.success ||
    (input.imageOnly === true && !isImageMimeType(parsedMimeType.data))
  ) {
    throw new AttachmentUploadError("UNSUPPORTED_MIME_TYPE");
  }

  return parsedMimeType.data;
}

export function createAttachmentUploadFailure(
  file: File,
  error: unknown,
): AttachmentUploadFailure {
  const uploadError = mapAttachmentUploadError(error);

  return attachmentUploadFailureSchema.parse({
    code: uploadError.code,
    fileName: file.name,
    retryable: uploadError.retryable,
  });
}

function isImageMimeType(mimeType: AttachmentMimeType): boolean {
  return mimeType.startsWith("image/");
}

function mapAttachmentUploadError(error: unknown): AttachmentUploadError {
  if (error instanceof AttachmentUploadError) {
    return error;
  }

  if (error instanceof ApiClientError) {
    if (
      error.error.code === "FORBIDDEN" ||
      error.error.code === "SPACE_ACCESS_DENIED"
    ) {
      return new AttachmentUploadError("ACCESS_DENIED");
    }
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
