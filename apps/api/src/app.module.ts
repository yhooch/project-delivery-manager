import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { DemoController } from "./demo.controller";
import { HealthController } from "./health.controller";
import { validateEnv } from "./config/env";
import { ApiResponseInterceptor } from "./http/api-response.interceptor";
import { GlobalExceptionFilter } from "./http/global-exception.filter";
import { RequestIdMiddleware } from "./http/request-id.middleware";
import { AuthModule } from "./modules/auth/auth.module";
import { AttachmentModule } from "./modules/attachment/attachment.module";
import { SessionParsingMiddleware } from "./modules/auth/session-parsing.middleware";
import { OrganizationModule } from "./modules/organization/organization.module";
import { RequirementModule } from "./modules/requirement/requirement.module";
import { SpaceModule } from "./modules/space/space.module";
import { VersionModule } from "./modules/version/version.module";
import { WorkflowModule } from "./modules/workflow/workflow.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  controllers: [DemoController, HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    AuthModule,
    OrganizationModule,
    SpaceModule,
    VersionModule,
    RequirementModule,
    AttachmentModule,
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
