import { Injectable } from "@nestjs/common";

import {
  Prisma,
  type WorkflowVersion,
} from "../../generated/prisma/client";

export type PublishWorkflowVersionInput = {
  readonly version: WorkflowVersion;
  readonly actorUserId: string;
  readonly publishedAt: Date;
};

@Injectable()
export class WorkflowVersionPublisherService {
  async publishVersion(
    tx: Prisma.TransactionClient,
    input: PublishWorkflowVersionInput,
  ): Promise<WorkflowVersion> {
    if (input.version.status === "PUBLISHED" && input.version.publishedAt) {
      return input.version;
    }

    return tx.workflowVersion.update({
      data: {
        publishedAt: input.version.publishedAt ?? input.publishedAt,
        publishedById: input.version.publishedById ?? input.actorUserId,
        status: "PUBLISHED",
        updatedById: input.actorUserId,
      },
      where: {
        id: input.version.id,
      },
    });
  }
}

