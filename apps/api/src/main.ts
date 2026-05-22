import "reflect-metadata";

import { RequestMethod, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";

import { AppModule } from "./app.module";

export function configureApp(app: INestApplication): INestApplication {
  app.use(cookieParser());
  app.setGlobalPrefix("api/v1", {
    exclude: [
      {
        path: ".well-known/oauth-protected-resource",
        method: RequestMethod.GET,
      },
      {
        path: ".well-known/oauth-authorization-server",
        method: RequestMethod.GET,
      },
      {
        path: "oauth/authorize",
        method: RequestMethod.GET,
      },
      {
        path: "oauth/authorize/approve",
        method: RequestMethod.POST,
      },
      {
        path: "oauth/token",
        method: RequestMethod.POST,
      },
      {
        path: "oauth/register",
        method: RequestMethod.POST,
      },
      {
        path: "oauth/revoke",
        method: RequestMethod.POST,
      },
    ],
  });
  return app;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") ?? 3001;
  await app.listen(port);
}

if (require.main === module) {
  void bootstrap();
}
