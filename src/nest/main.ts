import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "error", "warn"] });
  await app.listen(Number(process.env.NEST_PORT ?? 4001), "127.0.0.1");
}

void bootstrap();
