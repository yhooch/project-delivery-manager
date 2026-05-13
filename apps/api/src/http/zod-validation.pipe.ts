import {
  HttpStatus,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from "@nestjs/common";
import type { z } from "zod";

import { ApiException } from "./api-exception";

@Injectable()
export class ZodValidationPipe<TSchema extends z.ZodType>
  implements PipeTransform<unknown, z.infer<TSchema>>
{
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<TSchema> {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    throw new ApiException(
      "VALIDATION_ERROR",
      "Validation failed",
      HttpStatus.BAD_REQUEST,
      {
        issues: result.error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path,
        })),
      },
    );
  }
}
