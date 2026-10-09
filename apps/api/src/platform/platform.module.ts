import { Global, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { PLANS, type MemberRole } from "@foundry/shared";
import { Queue } from "bullmq";
import { Model, Types } from "mongoose";
import { CryptoService } from "../common/crypto.service";
import { AuditLog, Organization, Project, UsageRecord } from "../database/schemas";

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private readonly logs: Model<AuditLog>) {}

  async record(entry: {
    organizationId: string;
    projectId?: string | null;
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.logs.create({
      organizationId: new Types.ObjectId(entry.organizationId),
      projectId: entry.projectId ? new Types.ObjectId(entry.projectId) : null,
      userId: entry.userId ? new Types.ObjectId(entry.userId) : null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? "",
      metadata: entry.metadata ?? {},
    });
  }

  async list(projectId: string, limit = 40) {
    const rows = await this.logs
      .find({ projectId: new Types.ObjectId(projectId) })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      metadata: row.metadata,
      userId: row.userId ? String(row.userId) : null,
      createdAt: row.createdAt,
    }));
  }
}

@Injectable()
export class UsageService {
  constructor(
    @InjectModel(UsageRecord.name) private readonly usage: Model<UsageRecord>,
    @InjectModel(Organization.name) private readonly organizations: Model<Organization>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
  ) {}

  async increment(
    organizationId: string,
    projectId: string,
    field: "apiCalls" | "workflowExecutions" | "aiTokens",
    amount = 1,
  ): Promise<void> {
    const period = new Date().toISOString().slice(0, 7);
    await this.usage.updateOne(
      {
        organizationId: new Types.ObjectId(organizationId),
        projectId: new Types.ObjectId(projectId),
        period,
      },
      { $inc: { [field]: amount } },
      { upsert: true },
    );
  }

  async summary(organizationId: string) {
    const period = new Date().toISOString().slice(0, 7);
    const [org, projectCount, published, rows] = await Promise.all([
      this.organizations.findById(organizationId).lean(),
      this.projects.countDocuments({ organizationId: new Types.ObjectId(organizationId) }),
      this.projects.countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        publishedVersion: { $gt: 0 },
      }),
      this.usage.aggregate<{ apiCalls: number; workflowExecutions: number; aiTokens: number }>([
        { $match: { organizationId: new Types.ObjectId(organizationId), period } },
        {
          $group: {
            _id: null,
            apiCalls: { $sum: "$apiCalls" },
            workflowExecutions: { $sum: "$workflowExecutions" },
            aiTokens: { $sum: "$aiTokens" },
          },
        },
      ]),
    ]);
    const plan = org?.plan ?? "free";
    const limits = PLANS[plan];
    const totals = rows[0] ?? { apiCalls: 0, workflowExecutions: 0, aiTokens: 0 };
    return { plan, limits, projectCount, published, period, ...totals };
  }

  async assertCanCreateProject(organizationId: string): Promise<void> {
    const summary = await this.summary(organizationId);
    if (summary.projectCount >= summary.limits.projects) {
      const { AppError } = await import("@foundry/shared");
      throw new AppError("PLAN_LIMIT", "This workspace has reached its project limit", 402);
    }
  }
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly enabled: boolean;
  private readonly queue: Queue | null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.enabled = false;
      this.queue = null;
      return;
    }
    this.enabled = true;
    this.queue = new Queue("foundry", { connection: { url, maxRetriesPerRequest: null } });
  }

  get connectionUrl(): string {
    return process.env.REDIS_URL ?? "";
  }

  async schedule(workflowId: string, projectId: string, cron: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.upsertJobScheduler(
      `schedule:${workflowId}`,
      { pattern: cron },
      { name: "workflow.schedule", data: { workflowId, projectId } },
    );
  }

  async unschedule(workflowId: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.removeJobScheduler(`schedule:${workflowId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

export function roleAtLeast(actual: MemberRole, required: MemberRole): boolean {
  const rank = { viewer: 1, member: 2, admin: 3, owner: 4 };
  return rank[actual] >= rank[required];
}

@Global()
@Module({
  providers: [CryptoService, AuditService, UsageService, QueueService],
  exports: [CryptoService, AuditService, UsageService, QueueService],
})
export class PlatformModule {}
