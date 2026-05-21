import {
  ObjectCodeLookupQuerySchema,
  ObjectCodeLookupResultSchema,
  type ObjectCodeLookupQuery,
  type ObjectCodeLookupResult,
} from "@project-delivery/shared";

import { apiClient, type ApiRequestInit } from "./api-client";

export type ObjectCodeApiTransport = {
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
};

const defaultApi: ObjectCodeApiTransport = apiClient;

export async function lookupObjectCode(
  input: ObjectCodeLookupQuery,
  api: ObjectCodeApiTransport = defaultApi,
): Promise<ObjectCodeLookupResult> {
  const query = ObjectCodeLookupQuerySchema.parse(input);
  const response = await api.get<unknown>("/object-code-lookup", { query });

  return ObjectCodeLookupResultSchema.parse(response.data);
}
