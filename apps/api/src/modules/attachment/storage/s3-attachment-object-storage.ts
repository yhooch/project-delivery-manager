import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type CreateBucketConfiguration,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  AttachmentObjectMetadata,
  AttachmentObjectStorage,
  AttachmentPresignDownloadInput,
  AttachmentPresignUploadInput,
} from "./attachment-object-storage";

@Injectable()
export class S3AttachmentObjectStorage
  implements AttachmentObjectStorage, OnModuleInit
{
  private readonly bucket: string;
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;
  private readonly autoCreateBucket: boolean;
  private readonly region: string;

  constructor(
    @Inject(ConfigService)
    config: ConfigService,
  ) {
    const credentials = {
      accessKeyId: requireConfig(config, "MINIO_ACCESS_KEY"),
      secretAccessKey: requireConfig(config, "MINIO_SECRET_KEY"),
    };
    const forcePathStyle =
      config.get<boolean>("MINIO_FORCE_PATH_STYLE") ?? true;
    this.region = requireConfig(config, "MINIO_REGION");
    const clientConfig = {
      credentials,
      forcePathStyle,
      region: this.region,
      requestChecksumCalculation: "WHEN_REQUIRED" as const,
    };

    this.bucket = requireConfig(config, "MINIO_BUCKET");
    this.autoCreateBucket =
      config.get<boolean>("MINIO_AUTO_CREATE_BUCKET") ?? false;
    this.internalClient = new S3Client({
      ...clientConfig,
      endpoint: requireConfig(config, "MINIO_INTERNAL_ENDPOINT"),
    });
    this.publicClient = new S3Client({
      ...clientConfig,
      endpoint: requireConfig(config, "MINIO_PUBLIC_ENDPOINT"),
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.autoCreateBucket) {
      return;
    }

    await this.createBucketIfMissing();
  }

  async createPresignedUploadUrl(
    input: AttachmentPresignUploadInput,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        ContentType: input.mimeType,
        Key: input.key,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async createPresignedDownloadUrl(
    input: AttachmentPresignDownloadInput,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async statObject(key: string): Promise<AttachmentObjectMetadata | undefined> {
    try {
      const object = await this.internalClient.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      if (object.ContentLength === undefined || !object.ContentType) {
        return undefined;
      }

      return {
        mimeType: object.ContentType,
        size: object.ContentLength,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }

      throw error;
    }
  }

  async deleteObjectIfExists(key: string): Promise<void> {
    try {
      await this.internalClient.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  private async createBucketIfMissing(): Promise<void> {
    try {
      await this.internalClient.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        }),
      );
      return;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    await this.internalClient.send(
      new CreateBucketCommand({
        Bucket: this.bucket,
        CreateBucketConfiguration: this.createBucketConfiguration(),
      }),
    );
  }

  private createBucketConfiguration(): CreateBucketConfiguration | undefined {
    if (this.region === "us-east-1") {
      return undefined;
    }

    return {
      LocationConstraint:
        this.region as CreateBucketConfiguration["LocationConstraint"],
    };
  }
}

function requireConfig(config: ConfigService, key: string): string {
  const value = config.get<string>(key);

  if (!value) {
    throw new Error(`Missing required configuration: ${key}`);
  }

  return value;
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof NotFound) {
    return true;
  }
  if (error instanceof S3ServiceException) {
    return (
      error.$metadata.httpStatusCode === 404 ||
      error.name === "NoSuchBucket" ||
      error.name === "NoSuchKey" ||
      error.name === "NotFound"
    );
  }

  return false;
}
