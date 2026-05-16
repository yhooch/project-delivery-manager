export const ATTACHMENT_OBJECT_STORAGE = Symbol("ATTACHMENT_OBJECT_STORAGE");

export type AttachmentObjectMetadata = {
  mimeType: string;
  size: number;
};

export type AttachmentPresignUploadInput = {
  expiresInSeconds: number;
  key: string;
  mimeType: string;
};

export type AttachmentPresignDownloadInput = {
  expiresInSeconds: number;
  key: string;
};

export type AttachmentObjectStorage = {
  createPresignedDownloadUrl(
    input: AttachmentPresignDownloadInput,
  ): Promise<string>;
  createPresignedUploadUrl(input: AttachmentPresignUploadInput): Promise<string>;
  deleteObjectIfExists(key: string): Promise<void>;
  statObject(key: string): Promise<AttachmentObjectMetadata | undefined>;
};
