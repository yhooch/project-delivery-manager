import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { HealthController } from "./health.controller";
import { validateEnv } from "./config/env";
import { ApiResponseInterceptor } from "./http/api-response.interceptor";
import { GlobalExceptionFilter } from "./http/global-exception.filter";
import { RequestIdMiddleware } from "./http/request-id.middleware";
import { AuthModule } from "./modules/auth/auth.module";
import { AttachmentModule } from "./modules/attachment/attachment.module";
import { BugModule } from "./modules/bug/bug.module";
import { SessionParsingMiddleware } from "./modules/auth/session-parsing.middleware";
import { CommentModule } from "./modules/comment/comment.module";
import { IntakeModule } from "./modules/intake/intake.module";
import { ObjectCodeModule } from "./modules/object-code/object-code.module";
import { OrganizationModule } from "./modules/organization/organization.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { RequirementModule } from "./modules/requirement/requirement.module";
import { SpaceModule } from "./modules/space/space.module";
import { SystemUpdateModule } from "./modules/system-update/system-update.module";
import { TagModule } from "./modules/tag/tag.module";
import { TimelineModule } from "./modules/timeline/timeline.module";
import { VersionModule } from "./modules/version/version.module";
import { WorkflowModule } from "./modules/workflow/workflow.module";
import { WorkItemModule } from "./modules/workitem/workitem.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    AuthModule,
    OrganizationModule,
    RealtimeModule,
    SpaceModule,
    VersionModule,
    RequirementModule,
    IntakeModule,
    ObjectCodeModule,
    WorkItemModule,
    BugModule,
    AttachmentModule,
    CommentModule,
    TagModule,
    SystemUpdateModule,
    TimelineModule,
    WorkflowModule,
    PrismaModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor,
    },
    SessionParsingMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({
      method: RequestMethod.ALL,
      path: "{*path}",
    });
    consumer.apply(SessionParsingMiddleware).forRoutes({
      method: RequestMethod.ALL,
      path: "{*path}",
    });
  }
}
