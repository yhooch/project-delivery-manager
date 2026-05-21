import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { PrismaWorkflowActionExecutionRepository } from "./prisma-workflow-action-execution.repository";
import { PrismaWorkflowConfigRepository } from "./prisma-workflow-config.repository";
import { WORKFLOW_ACTION_EXECUTION_REPOSITORY } from "./workflow-action-execution.repository";
import { WorkflowActionExecutionController } from "./workflow-action-execution.controller";
import { WorkflowActionExecutionService } from "./workflow-action-execution.service";
import { WorkflowConfigController } from "./workflow-config.controller";
import { WORKFLOW_CONFIG_REPOSITORY } from "./workflow-config.repository";
import { WorkflowConfigService } from "./workflow-config.service";
import { WorkflowDefaultBindingService } from "./workflow-default-binding.service";
import { WorkflowDefaultInitializerService } from "./workflow-default-initializer.service";
import { WorkflowDefaultTemplateCopyService } from "./workflow-default-template-copy.service";
import { WorkflowVersionPublisherService } from "./workflow-version-publisher.service";

@Module({
  controllers: [WorkflowActionExecutionController, WorkflowConfigController],
  exports: [WorkflowActionExecutionService, WorkflowDefaultInitializerService],
  imports: [AuthModule, PrismaModule, RealtimeModule],
  providers: [
    WorkflowActionExecutionService,
    WorkflowConfigService,
    WorkflowDefaultBindingService,
    WorkflowDefaultInitializerService,
    WorkflowDefaultTemplateCopyService,
    WorkflowVersionPublisherService,
    {
      provide: WORKFLOW_ACTION_EXECUTION_REPOSITORY,
      useClass: PrismaWorkflowActionExecutionRepository,
    },
    {
      provide: WORKFLOW_CONFIG_REPOSITORY,
      useClass: PrismaWorkflowConfigRepository,
    },
  ],
})
export class WorkflowModule {}
