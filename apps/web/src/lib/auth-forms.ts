import {
  ChangePasswordRequestSchema,
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

export const changePasswordFormSchema = ChangePasswordRequestSchema.refine(
  (input) => input.newPassword === input.confirmPassword,
  {
    message: "passwordMismatch",
    path: ["confirmPassword"],
  },
).refine((input) => input.oldPassword !== input.newPassword, {
  message: "sameAsOld",
  path: ["newPassword"],
});

export type RegisterFormValues = z.infer<typeof registerFormSchema>;
export type LoginFormValues = z.infer<typeof loginFormSchema>;
export type CreateOrganizationFormInput = z.input<
  typeof createOrganizationFormSchema
>;
export type CreateOrganizationFormValues = z.output<
  typeof createOrganizationFormSchema
>;
export type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;

export function validateRegisterForm(input: unknown) {
  return registerFormSchema.safeParse(input);
}
