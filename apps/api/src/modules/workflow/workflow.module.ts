import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { WorkflowDefaultBindingService } from "./workflow-default-binding.service";
import { WorkflowDefaultInitializerService } from "./workflow-default-initializer.service";
import { WorkflowDefaultTemplateCopyService } from "./workflow-default-template-copy.service";
import { WorkflowVersionPublisherService } from "./workflow-version-publisher.service";

@Module({
  exports: [WorkflowDefaultInitializerService],
  imports: [PrismaModule],
  providers: [
    WorkflowDefaultBindingService,
    WorkflowDefaultInitializerService,
    WorkflowDefaultTemplateCopyService,
    WorkflowVersionPublisherService,
  ],
})
export class WorkflowModule {}

