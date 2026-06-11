import {
  AttachmentMaxCountPerTarget,
  AttachmentMaxSizeBytes,
  AttachmentListQuerySchema,
  AttachmentMimeTypeSchema,
  CreateAttachmentResponseSchema,
  ListAttachmentsResponseSchema,
  type Attachment,
  type AttachmentTargetType,
  type AttachmentMimeType,
  type PageResult,
} from "@project-delivery/shared";
import { z } from "zod";

import {
  API_BASE_PATH,
  ApiClientError,
  apiClient,
  type ApiRequestInit,
} from "./api-client";
import {
  getApiErrorMessageDetails,
  type ApiErrorMessageDetails,
} from "./api-error-messages";

export type AttachmentApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

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
  readonly sourceError?: unknown;

  constructor(
    code: AttachmentUploadErrorCode,
    retryableOrOptions: boolean | AttachmentUploadErrorOptions = false,
    sourceError?: unknown,
  ) {
    const options =
      typeof retryableOrOptions === "boolean"
        ? { retryable: retryableOrOptions, sourceError }
        : retryableOrOptions;

    super(
      code,
      options.sourceError === undefined
        ? undefined
        : { cause: options.sourceError },
    );
    this.name = "AttachmentUploadError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.sourceError !== undefined) {
      this.sourceError = options.sourceError;
    }
  }
}

export type AttachmentUploadErrorOptions = {
  retryable?: boolean;
  sourceError?: unknown;
};

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

export async function uploadRequirementImage(
  input: UploadRequirementImageInput,
  api: AttachmentApiTransport = defaultApi,
): Promise<UploadRequirementImageResult> {
  const result = await uploadAttachment(
    {
      existingAttachmentCount: input.existingAttachmentCount,
      file: input.file,
      imageOnly: true,
      targetId: input.requirementId,
      targetType: "DOCUMENT",
    },
    api,
  );

  return {
    attachment: result.attachment,
    imageUrl: result.attachment.previewUrl ?? result.downloadUrl,
  };
}

export async function uploadAttachment(
  input: UploadAttachmentInput,
  api: AttachmentApiTransport = defaultApi,
): Promise<UploadAttachmentResult> {
  validateAttachmentFile(input);

  try {
    const formData = new FormData();
    formData.set("targetId", input.targetId);
    formData.set("targetType", input.targetType);
    formData.set("file", input.file, input.file.name);

    const attachmentResponse = await api.post<unknown>(
      "/attachments",
      formData,
    );
    const attachment = CreateAttachmentResponseSchema.parse(
      attachmentResponse.data,
    );

    return {
      attachment,
      downloadUrl: createAttachmentDownloadUrl(attachment.id),
    };
  } catch (error) {
    throw mapAttachmentUploadError(error);
  }
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
    targetType: "DOCUMENT",
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

export function getAttachmentUploadErrorDetails(
  error: unknown,
): ApiErrorMessageDetails | undefined {
  if (!(error instanceof AttachmentUploadError)) {
    return undefined;
  }

  const sourceError = error.sourceError ?? error.cause;

  return sourceError instanceof ApiClientError
    ? getApiErrorMessageDetails(sourceError)
    : undefined;
}

function isImageMimeType(mimeType: AttachmentMimeType): boolean {
  return mimeType.startsWith("image/");
}

export function createAttachmentDownloadUrl(attachmentId: string): string {
  return `${API_BASE_PATH}/attachments/${encodeURIComponent(attachmentId)}/download`;
}

function mapAttachmentUploadError(error: unknown): AttachmentUploadError {
  if (error instanceof AttachmentUploadError) {
    return error;
  }

  if (error instanceof ApiClientError) {
    if (
      error.error.code === "ATTACHMENT_LIMIT_EXCEEDED" ||
      error.error.code === "FILE_TOO_LARGE" ||
      error.error.code === "UNSUPPORTED_MIME_TYPE"
    ) {
      return new AttachmentUploadError(error.error.code, {
        sourceError: error,
      });
    }
    if (
      error.error.code === "FORBIDDEN" ||
      error.error.code === "SPACE_ACCESS_DENIED"
    ) {
      return new AttachmentUploadError("ACCESS_DENIED", {
        sourceError: error,
      });
    }
    if (error.error.code === "DRAFT_REQUIREMENT_REQUIRED") {
      return new AttachmentUploadError("DRAFT_REQUIRED", {
        sourceError: error,
      });
    }
    if (error.error.code === "ATTACHMENT_TARGET_NOT_FOUND") {
      return new AttachmentUploadError("TARGET_NOT_FOUND", {
        sourceError: error,
      });
    }
    if (error.error.code === "VALIDATION_ERROR") {
      return new AttachmentUploadError("VALIDATION_FAILED", {
        sourceError: error,
      });
    }
  }

  return new AttachmentUploadError("UPLOAD_FAILED", {
    retryable: true,
    sourceError: error,
  });
}
