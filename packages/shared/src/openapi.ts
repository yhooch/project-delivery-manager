import { z } from "zod";
import { apiResponseSchema, ApiErrorSchema } from "./common.ts";
import { apiContracts, type ApiEndpointContract } from "./contracts.ts";

type JsonSchema = Record<string, unknown>;

type OpenApiOperation = {
  operationId: string;
  tags: readonly string[];
  summary: string;
  "x-error-codes": readonly string[];
  parameters?: JsonSchema[];
  requestBody?: JsonSchema;
  responses: JsonSchema;
};

type OpenApiDocument = {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
  };
  servers: { url: string }[];
  paths: Record<string, Partial<Record<ApiEndpointContract["method"], OpenApiOperation>>>;
  components: {
    schemas: {
      ApiError: JsonSchema;
    };
  };
};

function schemaToJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema) as JsonSchema;
}

function buildParameters(contract: ApiEndpointContract): JsonSchema[] {
  const parameters: JsonSchema[] = [];
  const pathJsonSchema = schemaToJsonSchema(contract.pathSchema);
  const pathProperties = pathJsonSchema.properties;
  if (pathProperties && typeof pathProperties === "object") {
    for (const [name, schema] of Object.entries(pathProperties)) {
      parameters.push({
        name,
        in: "path",
        required: true,
        schema,
      });
    }
  }

  const queryJsonSchema = schemaToJsonSchema(contract.querySchema);
  const queryProperties = queryJsonSchema.properties;
  if (queryProperties && typeof queryProperties === "object") {
    const required = Array.isArray(queryJsonSchema.required)
      ? queryJsonSchema.required
      : [];
    for (const [name, schema] of Object.entries(queryProperties)) {
      parameters.push({
        name,
        in: "query",
        required: required.includes(name),
        schema,
      });
    }
  }

  return parameters;
}

function buildRequestBody(contract: ApiEndpointContract): JsonSchema | undefined {
  const requestSchema = schemaToJsonSchema(contract.requestSchema);
  const isEmptyObject =
    requestSchema.type === "object" &&
    Object.keys((requestSchema.properties as object | undefined) ?? {})
      .length === 0;

  if (contract.method === "get" || contract.method === "delete" || isEmptyObject) {
    return undefined;
  }

  return {
    required: true,
    content: {
      "application/json": {
        schema: requestSchema,
      },
    },
  };
}

function normalizePath(path: string): string {
  return path.replaceAll(/{/g, "{").replaceAll("}", "}");
}

function buildSuccessContent(contract: ApiEndpointContract): JsonSchema {
  const responseContentType = contract.responseContentType ?? "application/json";
  const responseSchema =
    contract.responseWrapped === false
      ? contract.responseSchema
      : apiResponseSchema(contract.responseSchema);

  return {
    [responseContentType]: {
      schema: schemaToJsonSchema(responseSchema),
    },
  };
}

export function generateOpenApiDocument(): OpenApiDocument {
  const document: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: "Project Delivery Manager API",
      version: "0.0.0",
    },
    servers: [{ url: "/api/v1" }],
    paths: {},
    components: {
      schemas: {
        ApiError: schemaToJsonSchema(ApiErrorSchema),
      },
    },
  };

  for (const contract of apiContracts) {
    const path = normalizePath(contract.path);
    const parameters = buildParameters(contract);
    const requestBody = buildRequestBody(contract);

    document.paths[path] = {
      ...document.paths[path],
      [contract.method]: {
        operationId: contract.operationId,
        tags: contract.tags,
        summary: contract.summary,
        "x-error-codes": contract.errorCodes,
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(requestBody ? { requestBody } : {}),
        responses: {
          "200": {
            description: "Success",
            content: buildSuccessContent(contract),
          },
          default: {
            description: contract.errorCodes.join(", "),
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
          },
        },
      },
    };
  }

  return document;
}
