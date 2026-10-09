import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

process.env.JWT_ACCESS_SECRET = "test-access-secret-value-32b";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-value-32";
process.env.JWT_APP_SECRET = "test-app-secret-value-32bytes";
process.env.ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NODE_ENV = "test";
delete process.env.REDIS_URL;

describe("customer manager demo", () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    const { NestFactory } = await import("@nestjs/core");
    const cookieParser = (await import("cookie-parser")).default;
    const { AppModule } = await import("../src/app.module");
    const { HttpErrorFilter, ResponseInterceptor } = await import("../src/common/http");
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it("registers, builds a customer API, and returns the created record", async () => {
    const registered = await agent.post("/auth/register").send({
      name: "Ada Lovelace",
      email: "ada@foundry.test",
      password: "supersecret",
      organization: "Analytical Engines",
    });
    expect(registered.status).toBe(201);
    const organizationId = registered.body.data.organization.id as string;

    const project = await agent.post("/projects").send({ organizationId, name: "Customer Manager" });
    expect(project.status).toBe(201);
    const projectId = project.body.data.id as string;

    const model = await agent.post(`/projects/${projectId}/models`).send({
      name: "Customer",
      fields: [
        { id: "f1", name: "Name", key: "name", type: "string", required: true },
        { id: "f2", name: "Email", key: "email", type: "string", required: true, unique: true },
        { id: "f3", name: "Phone", key: "phone", type: "string" },
        { id: "f4", name: "Company", key: "company", type: "string" },
        { id: "f5", name: "Status", key: "status", type: "enum", enumValues: ["new", "active"], required: true },
      ],
    });
    expect(model.status).toBe(201);
    const modelId = model.body.data.id as string;

    const generated = await agent.post(`/projects/${projectId}/models/${modelId}/generate`).send({ mode: "crud", page: true });
    expect(generated.status, JSON.stringify(generated.body)).toBe(201);
    expect(generated.body.data.apis.map((api: { method: string; path: string }) => `${api.method} ${api.path}`)).toContain("POST /customers");

    const created = await agent.post(`/runtime/projects/${projectId}/draft/customers`).send({
      name: "Grace Hopper",
      email: "grace@navy.test",
      phone: "555",
      company: "Navy",
      status: "active",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.email).toBe("grace@navy.test");

    const listed = await agent.get(`/runtime/projects/${projectId}/draft/customers`);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([expect.objectContaining({ name: "Grace Hopper", email: "grace@navy.test" })]);

    const published = await agent.post(`/projects/${projectId}/publish`).send({});
    expect(published.status).toBe(201);
    expect(published.body.data.version).toBe(1);

    const manifest = await agent.get("/runtime/apps/analytical-engines/customer-manager/manifest");
    expect(manifest.status).toBe(200);
    expect(manifest.body.pages.length).toBeGreaterThan(0);

    const live = await agent.get("/runtime/apps/analytical-engines/customer-manager/customers");
    expect(live.status).toBe(200);
    expect(live.body.items).toEqual([expect.objectContaining({ email: "grace@navy.test" })]);
  });
});
