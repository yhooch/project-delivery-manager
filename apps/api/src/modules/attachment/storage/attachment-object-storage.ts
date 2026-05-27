export const ATTACHMENT_OBJECT_STORAGE = Symbol("ATTACHMENT_OBJECT_STORAGE");

export type AttachmentObjectMetadata = {
  mimeType: string;
  size: number;
};

export type AttachmentPutObjectInput = {
  body: Buffer;
  key: string;
  mimeType: string;
  size: number;
};

export type AttachmentGetObjectResult = AttachmentObjectMetadata & {
  body: Buffer;
};

export type AttachmentGetObjectInput = {
  key: string;
};

export type AttachmentObjectStorage = {
  deleteObjectIfExists(key: string): Promise<void>;
  getObject(
    input: AttachmentGetObjectInput,
  ): Promise<AttachmentGetObjectResult | undefined>;
  putObject(input: AttachmentPutObjectInput): Promise<void>;
};
