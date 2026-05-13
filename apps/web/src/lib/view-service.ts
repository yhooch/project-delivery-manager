import {
  GetMyWorkbenchViewResponseSchema,
  GetSpaceExceptionsViewResponseSchema,
  GetSpaceOverviewViewResponseSchema,
  GetVersionBoardViewResponseSchema,
  SpaceExceptionsViewQuerySchema,
  SpaceOverviewViewQuerySchema,
  VersionBoardViewQuerySchema,
  WorkbenchViewQuerySchema,
  type GetMyWorkbenchViewResponse,
  type GetSpaceExceptionsViewResponse,
  type GetSpaceOverviewViewResponse,
  type GetVersionBoardViewResponse,
} from "@project-delivery/shared";
import type { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";

export type ViewApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
};

export type GetMyWorkbenchViewInput = z.input<
  typeof WorkbenchViewQuerySchema
>;

export type GetSpaceOverviewViewInput = z.input<
  typeof SpaceOverviewViewQuerySchema
> & {
  spaceId: string;
};

export type GetVersionBoardViewInput = z.input<
  typeof VersionBoardViewQuerySchema
> & {
  versionId: string;
};

export type GetSpaceExceptionsViewInput = z.input<
  typeof SpaceExceptionsViewQuerySchema
> & {
  spaceId: string;
};

const defaultApi: ViewApiTransport = apiClient;

export async function getMyWorkbenchView(
  input: GetMyWorkbenchViewInput,
  api: ViewApiTransport = defaultApi,
): Promise<GetMyWorkbenchViewResponse> {
  const query = WorkbenchViewQuerySchema.parse(input);
  const response = await api.get<unknown>("/views/my-workbench", { query });

  return GetMyWorkbenchViewResponseSchema.parse(response.data);
}

export async function getSpaceOverviewView(
  input: GetSpaceOverviewViewInput,
  api: ViewApiTransport = defaultApi,
): Promise<GetSpaceOverviewViewResponse> {
  const { spaceId, ...filters } = input;
  const query = SpaceOverviewViewQuerySchema.parse(filters);
  const response = await api.get<unknown>(`/views/spaces/${spaceId}/overview`, {
    query,
  });

  return GetSpaceOverviewViewResponseSchema.parse(response.data);
}

export async function getVersionBoardView(
  input: GetVersionBoardViewInput,
  api: ViewApiTransport = defaultApi,
): Promise<GetVersionBoardViewResponse> {
  const { versionId, ...filters } = input;
  const query = VersionBoardViewQuerySchema.parse(filters);
  const response = await api.get<unknown>(`/views/versions/${versionId}/board`, {
    query,
  });

  return GetVersionBoardViewResponseSchema.parse(response.data);
}

export async function getSpaceExceptionsView(
  input: GetSpaceExceptionsViewInput,
  api: ViewApiTransport = defaultApi,
): Promise<GetSpaceExceptionsViewResponse> {
  const { spaceId, ...filters } = input;
  const query = SpaceExceptionsViewQuerySchema.parse(filters);
  const response = await api.get<unknown>(
    `/views/spaces/${spaceId}/exceptions`,
    { query },
  );

  return GetSpaceExceptionsViewResponseSchema.parse(response.data);
}
