import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { BugModule } from "../bug/bug.module";
import { CommentModule } from "../comment/comment.module";
import { DocumentModule } from "../document/document.module";
import { IdentityModule } from "../identity/identity.module";
import { IntakeModule } from "../intake/intake.module";
import { ObjectCodeModule } from "../object-code/object-code.module";
import { OAuthModule } from "../oauth/oauth.module";
import { OrganizationModule } from "../organization/organization.module";
import { RequirementModule } from "../requirement/requirement.module";
import { SpaceModule } from "../space/space.module";
import { TagModule } from "../tag/tag.module";
import { TargetModule } from "../target/target.module";
import { TimelineModule } from "../timeline/timeline.module";
import { VersionModule } from "../version/version.module";
import { WorkflowModule } from "../workflow/workflow.module";
import { WorkItemModule } from "../workitem/workitem.module";
import { MCP_IDEMPOTENCY_REPOSITORY } from "./mcp-idempotency.repository";
import { McpIdempotencyService } from "./mcp-idempotency.service";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";
import { McpWriteToolExecutor } from "./mcp-write-tool.executor";
import { PrismaMcpIdempotencyRepository } from "./prisma-mcp-idempotency.repository";

@Module({
  controllers: [McpController],
  imports: [
    BugModule,
    CommentModule,
    DocumentModule,
    IdentityModule,
    IntakeModule,
    ObjectCodeModule,
    OAuthModule,
    OrganizationModule,
    PrismaModule,
    RequirementModule,
    SpaceModule,
    TagModule,
    TargetModule,
    TimelineModule,
    VersionModule,
    WorkflowModule,
    WorkItemModule,
  ],
  providers: [
    McpService,
    McpIdempotencyService,
    McpWriteToolExecutor,
    {
      provide: MCP_IDEMPOTENCY_REPOSITORY,
      useClass: PrismaMcpIdempotencyRepository,
    },
  ],
})
export class McpModule {}
