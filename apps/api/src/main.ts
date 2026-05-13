import "reflect-metadata";

import { type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";

import { AppModule } from "./app.module";

export function configureApp(app: INestApplication): INestApplication {
  app.use(cookieParser());
  app.setGlobalPrefix("api/v1");
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
