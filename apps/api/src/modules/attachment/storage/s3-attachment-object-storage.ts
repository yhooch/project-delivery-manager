import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type CreateBucketConfiguration,
} from "@aws-sdk/client-s3";

import type {
  AttachmentGetObjectInput,
  AttachmentGetObjectResult,
  AttachmentObjectStorage,
  AttachmentPutObjectInput,
} from "./attachment-object-storage";

@Injectable()
export class S3AttachmentObjectStorage
  implements AttachmentObjectStorage, OnModuleInit
{
  private readonly bucket: string;
  private readonly internalClient: S3Client;
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
  }

  async onModuleInit(): Promise<void> {
    if (!this.autoCreateBucket) {
      return;
    }

    await this.createBucketIfMissing();
  }

  async putObject(input: AttachmentPutObjectInput): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Body: input.body,
        Bucket: this.bucket,
        ContentLength: input.size,
        ContentType: input.mimeType,
        Key: input.key,
      }),
    );
  }

  async getObject(
    input: AttachmentGetObjectInput,
  ): Promise<AttachmentGetObjectResult | undefined> {
    try {
      const object = await this.internalClient.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
        }),
      );

      if (
        !object.Body ||
        object.ContentLength === undefined ||
        !object.ContentType
      ) {
        return undefined;
      }

      const bytes = await object.Body.transformToByteArray();

      return {
        body: Buffer.from(bytes),
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
      LocationConstraint: this
        .region as CreateBucketConfiguration["LocationConstraint"],
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
