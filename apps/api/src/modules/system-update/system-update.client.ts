import { HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CheckUpdateResponseSchema,
  CreateUpdateJobResponseSchema,
  GetUpdateJobResponseSchema,
  GetUpdateStatusResponseSchema,
  RollbackUpdateJobResponseSchema,
  UpdateErrorCodeSchema,
  type CheckUpdateRequest,
  type CheckUpdateResponse,
  type CreateUpdateJobRequest,
  type CreateUpdateJobResponse,
  type GetUpdateJobResponse,
  type GetUpdateStatusResponse,
  type RollbackUpdateJobRequest,
  type RollbackUpdateJobResponse,
} from "@project-delivery/shared";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

import { ApiException } from "../../http/api-exception";

export const SYSTEM_UPDATE_CLIENT = Symbol("SYSTEM_UPDATE_CLIENT");
export const DEFAULT_SYSTEM_UPDATE_STATE_DIR = "/tmp/pdm-updater/state";
export const UPDATER_SECRET_HEADER = "x-pdm-updater-secret";

export type SystemUpdateClient = {
  check(request: CheckUpdateRequest): Promise<CheckUpdateResponse>;
  createJob(request: CreateUpdateJobRequest): Promise<CreateUpdateJobResponse>;
  getJob(jobId: string): Promise<GetUpdateJobResponse>;
  getStatus(): Promise<GetUpdateStatusResponse>;
  rollbackJob(
    jobId: string,
    request: RollbackUpdateJobRequest,
  ): Promise<RollbackUpdateJobResponse>;
};

export class UpdaterHttpClient implements SystemUpdateClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    assertLocalUpdaterUrl(baseUrl);
  }

  async getStatus(): Promise<GetUpdateStatusResponse> {
    return this.request("GET", "/status", undefined, GetUpdateStatusResponseSchema);
  }

  async check(request: CheckUpdateRequest): Promise<CheckUpdateResponse> {
    return this.request("POST", "/check", request, CheckUpdateResponseSchema);
  }

  async createJob(
    request: CreateUpdateJobRequest,
  ): Promise<CreateUpdateJobResponse> {
    return this.request("POST", "/jobs", request, CreateUpdateJobResponseSchema);
  }

  async getJob(jobId: string): Promise<GetUpdateJobResponse> {
    return this.request(
      "GET",
      `/jobs/${encodeURIComponent(jobId)}`,
      undefined,
      GetUpdateJobResponseSchema,
    );
  }

  async rollbackJob(
    jobId: string,
    request: RollbackUpdateJobRequest,
  ): Promise<RollbackUpdateJobResponse> {
    return this.request(
      "POST",
      `/jobs/${encodeURIComponent(jobId)}/rollback`,
      request,
      RollbackUpdateJobResponseSchema,
    );
  }

  private async request<TSchema extends z.ZodType>(
    method: "GET" | "POST",
    pathname: string,
    body: unknown,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    let response: Response;

    try {
      response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          [UPDATER_SECRET_HEADER]: this.sharedSecret,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new ApiException(
        "UPDATE_PROVIDER_UNAVAILABLE",
        "Updater provider is unavailable",
        HttpStatus.SERVICE_UNAVAILABLE,
        error instanceof Error ? error.message : error,
      );
    }

    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw mapUpdaterError(response.status, payload);
    }

    const data = unwrapData(payload);
    const parsed = schema.safeParse(data);

    if (!parsed.success) {
      throw new ApiException(
        "UPDATE_PROVIDER_UNAVAILABLE",
        "Updater provider returned an invalid response",
        HttpStatus.BAD_GATEWAY,
        {
          issues: parsed.error.issues,
        },
      );
    }

    return parsed.data;
  }
}

export class StateFileSystemUpdateClient implements SystemUpdateClient {
  constructor(private readonly stateDir = DEFAULT_SYSTEM_UPDATE_STATE_DIR) {}

  async getStatus(): Promise<GetUpdateStatusResponse> {
    return readPersistedJson(
      path.join(this.stateDir, "status.json"),
      GetUpdateStatusResponseSchema,
    );
  }

  async getJob(jobId: string): Promise<GetUpdateJobResponse> {
    return readPersistedJson(
      path.join(this.stateDir, "jobs", `${jobId}.json`),
      GetUpdateJobResponseSchema,
      "UPDATE_JOB_NOT_FOUND",
    );
  }

  async check(_request: CheckUpdateRequest): Promise<CheckUpdateResponse> {
    throwProviderUnavailable();
  }

  async createJob(
    _request: CreateUpdateJobRequest,
  ): Promise<CreateUpdateJobResponse> {
    throwProviderUnavailable();
  }

  async rollbackJob(
    _jobId: string,
    _request: RollbackUpdateJobRequest,
  ): Promise<RollbackUpdateJobResponse> {
    throwProviderUnavailable();
  }
}

export function createSystemUpdateClient(
  config: ConfigService,
): SystemUpdateClient {
  const baseUrl = config.get<string>("SYSTEM_UPDATE_UPDATER_BASE_URL");
  const sharedSecret = config.get<string>("SYSTEM_UPDATE_UPDATER_SHARED_SECRET");

  if (baseUrl || sharedSecret) {
    if (!baseUrl || !sharedSecret) {
      throw new ApiException(
        "UPDATE_ACCESS_DENIED",
        "Updater base URL and shared secret must be configured together",
        HttpStatus.FORBIDDEN,
      );
    }

    return new UpdaterHttpClient(baseUrl, sharedSecret);
  }

  return new StateFileSystemUpdateClient(
    config.get<string>("SYSTEM_UPDATE_STATE_DIR") ??
      DEFAULT_SYSTEM_UPDATE_STATE_DIR,
  );
}

export function assertLocalUpdaterUrl(baseUrl: string): void {
  let url: URL;

  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApiException(
      "UPDATE_ACCESS_DENIED",
      "Updater base URL is invalid",
      HttpStatus.FORBIDDEN,
    );
  }

  if (!["http:", "https:"].includes(url.protocol) || !isLocalHost(url.hostname)) {
    throw new ApiException(
      "UPDATE_ACCESS_DENIED",
      "Updater base URL must be local",
      HttpStatus.FORBIDDEN,
    );
  }
}

async function readPersistedJson<TSchema extends z.ZodType>(
  filePath: string,
  schema: TSchema,
  notFoundCode: "UPDATE_JOB_NOT_FOUND" | "UPDATE_PROVIDER_UNAVAILABLE" =
    "UPDATE_PROVIDER_UNAVAILABLE",
): Promise<z.infer<TSchema>> {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(filePath, "utf8")));

    if (parsed.success) {
      return parsed.data;
    }

    throw new ApiException(
      "UPDATE_PROVIDER_UNAVAILABLE",
      "Persisted updater state is invalid",
      HttpStatus.SERVICE_UNAVAILABLE,
      {
        issues: parsed.error.issues,
      },
    );
  } catch (error) {
    if (error instanceof ApiException) {
      throw error;
    }

    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ApiException(
        notFoundCode,
        notFoundCode === "UPDATE_JOB_NOT_FOUND"
          ? "Update job not found"
          : "Updater provider is unavailable",
        notFoundCode === "UPDATE_JOB_NOT_FOUND"
          ? HttpStatus.NOT_FOUND
          : HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    throw new ApiException(
      "UPDATE_PROVIDER_UNAVAILABLE",
      "Updater provider is unavailable",
      HttpStatus.SERVICE_UNAVAILABLE,
      error instanceof Error ? error.message : error,
    );
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text,
    };
  }
}

function unwrapData(payload: unknown): unknown {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "data" in payload
  ) {
    return (payload as { data: unknown }).data;
  }

  return payload;
}

function mapUpdaterError(status: number, payload: unknown): ApiException {
  const error = typeof payload === "object" && payload !== null ? payload : {};
  const code = UpdateErrorCodeSchema.safeParse(
    (error as { code?: unknown }).code,
  );

  return new ApiException(
    code.success ? code.data : "UPDATE_PROVIDER_UNAVAILABLE",
    getErrorMessage(error),
    statusToHttpStatus(status),
    payload,
  );
}

function getErrorMessage(error: object): string {
  const message = (error as { message?: unknown }).message;

  return typeof message === "string" && message.length > 0
    ? message
    : "Updater provider request failed";
}

function statusToHttpStatus(status: number): HttpStatus {
  switch (status) {
    case 401:
    case 403:
      return HttpStatus.FORBIDDEN;
    case 404:
      return HttpStatus.NOT_FOUND;
    case 409:
      return HttpStatus.CONFLICT;
    case 400:
    case 422:
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.SERVICE_UNAVAILABLE;
  }
}

function throwProviderUnavailable(): never {
  throw new ApiException(
    "UPDATE_PROVIDER_UNAVAILABLE",
    "Updater provider is unavailable",
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
