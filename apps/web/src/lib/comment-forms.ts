import {
  CommentTargetTypeSchema,
  CreateCommentRequestSchema,
  UlidSchema,
} from "@project-delivery/shared";
import { z } from "zod";

type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;

export const createCommentFormSchema = CreateCommentRequestSchema.extend({
  body: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1).max(8000),
  ),
  targetId: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    UlidSchema,
  ),
  targetType: CommentTargetTypeSchema,
});

export type CreateCommentFormInput = z.input<typeof createCommentFormSchema>;
export type CreateCommentFormValues = z.output<typeof createCommentFormSchema>;

export function toCreateCommentRequest(
  input: CreateCommentFormInput,
): CreateCommentRequest {
  return CreateCommentRequestSchema.parse(createCommentFormSchema.parse(input));
}
