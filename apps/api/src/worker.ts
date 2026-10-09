import "dotenv/config";
import "reflect-metadata";
import { Injectable, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { InjectModel } from "@nestjs/mongoose";
import { Worker } from "bullmq";
import { Model } from "mongoose";
import { AppModule } from "./app.module";
import { Project, Workflow } from "./database/schemas";
import { ModelsService } from "./models/models.service";
import { ResourcesService } from "./resources/resources.service";
import { ExecutionService } from "./workflows/execution.service";

@Injectable()
class ScheduleProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    private readonly execution: ExecutionService,
    private readonly models: ModelsService,
    private readonly resources: ResourcesService,
    @InjectModel(Workflow.name) private readonly workflows: Model<Workflow>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
  ) {}

  onModuleInit(): void {
    const url = process.env.REDIS_URL;
    if (!url) {
      console.warn("REDIS_URL is not set. Scheduled workflows will not run.");
      return;
    }
    this.worker = new Worker(
      "foundry",
      async (job) => {
        if (job.name !== "workflow.schedule") return;
        const { workflowId, projectId } = job.data as { workflowId: string; projectId: string };
        const project = await this.projects.findById(projectId).lean();
        const workflow = await this.workflows.findOne({ _id: workflowId, projectId }).lean();
        if (!project || !workflow) return;
        await this.execution.run({
          workflow: { name: workflow.name, nodes: workflow.nodes as never, edges: workflow.edges as never },
          workflowId,
          projectId,
          organizationId: String(project.organizationId),
          models: await this.models.list(projectId),
          secrets: await this.resources.secretMap(projectId, "production"),
          env: await this.resources.envMap(projectId, "production"),
          connections: await this.resources.connectionRuntime(projectId),
          source: "schedule",
          trigger: { body: { scheduledAt: new Date().toISOString() }, method: "SCHEDULE", path: "/schedule" },
        });
      },
      { connection: { url, maxRetriesPerRequest: null }, concurrency: 5 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

@Module({
  imports: [AppModule],
  providers: [ScheduleProcessor],
})
class WorkerRootModule {}

export async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerRootModule, { logger: ["error", "warn", "log"] });
  app.enableShutdownHooks();
}

if (require.main === module) {
  bootstrapWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
