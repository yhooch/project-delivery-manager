/// <reference types="node" />

import { generateOpenApiDocument } from "./openapi.ts";

process.stdout.write(`${JSON.stringify(generateOpenApiDocument(), null, 2)}\n`);
