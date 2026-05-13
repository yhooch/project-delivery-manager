import type { IntakeItem } from "@project-delivery/shared";

import type {
  ConvertIntakeItemToWorkItemsInput,
  ConvertIntakeItemToWorkItemsResult,
  CreateIntakeItemInput,
  IntakeItemListInput,
  IntakeItemListResult,
  UpdateIntakeItemInput,
  UpdateIntakeItemStatusInput,
} from "./intake.types";

export const INTAKE_REPOSITORY = Symbol("INTAKE_REPOSITORY");

export type IntakeRepository = {
  convertToWorkItems(
    input: ConvertIntakeItemToWorkItemsInput,
  ): Promise<ConvertIntakeItemToWorkItemsResult | undefined>;
  create(input: CreateIntakeItemInput): Promise<IntakeItem>;
  findById(intakeItemId: string): Promise<IntakeItem | undefined>;
  hasParticipant(input: {
    intakeItemId: string;
    spaceId: string;
    userId: string;
  }): Promise<boolean>;
  listBySpaceId(
    spaceId: string,
    input: IntakeItemListInput,
  ): Promise<IntakeItemListResult>;
  update(input: UpdateIntakeItemInput): Promise<IntakeItem | undefined>;
  updateStatus(
    input: UpdateIntakeItemStatusInput,
  ): Promise<IntakeItem | undefined>;
};
