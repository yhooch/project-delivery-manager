import {
  CreateOrganizationRequestSchema,
  LoginRequestSchema,
  OrganizationCodeSchema,
  RegisterRequestSchema,
} from "@project-delivery/shared";
import { z } from "zod";

export const registerFormSchema = RegisterRequestSchema.refine(
  (input) => input.password === input.confirmPassword,
  {
    message: "passwordMismatch",
    path: ["confirmPassword"],
  },
);

export const loginFormSchema = LoginRequestSchema;

export const createOrganizationFormSchema = CreateOrganizationRequestSchema.extend(
  {
    code: z.preprocess(
      (value) => (value === "" ? undefined : value),
      OrganizationCodeSchema.optional(),
    ),
  },
);

export type RegisterFormValues = z.infer<typeof registerFormSchema>;
export type LoginFormValues = z.infer<typeof loginFormSchema>;
export type CreateOrganizationFormInput = z.input<
  typeof createOrganizationFormSchema
>;
export type CreateOrganizationFormValues = z.output<
  typeof createOrganizationFormSchema
>;

export function validateRegisterForm(input: unknown) {
  return registerFormSchema.safeParse(input);
}
