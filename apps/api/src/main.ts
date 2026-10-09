import "dotenv/config";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { HttpErrorFilter, ResponseInterceptor } from "./common/http";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ["error", "warn", "log"] });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(json({ limit: "1mb" }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });
  app.use((req: { id?: string; headers: Record<string, string | string[] | undefined> }, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    const incoming = req.headers["x-request-id"];
    req.id = typeof incoming === "string" ? incoming : randomUUID();
    res.setHeader("x-request-id", req.id);
    next();
  });
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpErrorFilter());
  const config = new DocumentBuilder().setTitle("Foundry API").setDescription("Control plane for the Foundry visual builder").setVersion("1.0").build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`Foundry API listening on ${port}`);
}

void bootstrap();
