import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { AppError, hasRole, slugify, type MemberRole } from "@foundry/shared";
import { Model, Types } from "mongoose";
import type { ProjectContext } from "../common/request";
import { Environment, Membership, Organization, Project, User } from "../database/schemas";
import { AuditService, UsageService } from "../platform/platform.module";

function orgDto(org: { _id: Types.ObjectId; name: string; slug: string; plan: string }, role: MemberRole) {
  return { id: String(org._id), name: org.name, slug: org.slug, plan: org.plan, role };
}

@Injectable()
export class TenancyService {
  constructor(
    @InjectModel(Organization.name) private readonly organizations: Model<Organization>,
    @InjectModel(Membership.name) private readonly memberships: Model<Membership>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Environment.name) private readonly environments: Model<Environment>,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
  ) {}

  async listOrganizations(userId: string) {
    const memberships = await this.memberships.find({ userId: new Types.ObjectId(userId) }).lean();
    const orgs = await this.organizations.find({ _id: { $in: memberships.map((item) => item.organizationId) } }).lean();
    return orgs.map((org) => orgDto(org, memberships.find((item) => String(item.organizationId) === String(org._id))!.role));
  }

  async createOrganization(userId: string, name: string) {
    const slug = await this.uniqueOrgSlug(slugify(name));
    const org = await this.organizations.create({
      name: name.trim(),
      slug,
      ownerId: new Types.ObjectId(userId),
      plan: "free",
    });
    await this.memberships.create({ organizationId: org._id, userId: new Types.ObjectId(userId), role: "owner" });
    return orgDto(org, "owner");
  }

  async organizationIdFor(projectId: string): Promise<string> {
    if (!Types.ObjectId.isValid(projectId)) throw new AppError("NOT_FOUND", "Project not found", 404);
    const project = await this.projects.findById(projectId).select("organizationId").lean();
    if (!project) throw new AppError("NOT_FOUND", "Project not found", 404);
    return String(project.organizationId);
  }

  async requireProject(userId: string, projectId: string, required: MemberRole) {
    if (!Types.ObjectId.isValid(projectId)) throw new AppError("NOT_FOUND", "Project not found", 404);
    const project = await this.projects.findById(projectId).lean();
    if (!project) throw new AppError("NOT_FOUND", "Project not found", 404);
    const membership = await this.memberships
      .findOne({ organizationId: project.organizationId, userId: new Types.ObjectId(userId) })
      .lean();
    if (!membership) throw new AppError("NOT_FOUND", "Project not found", 404);
    if (!hasRole(membership.role, required)) throw new AppError("FORBIDDEN", "You do not have access to do that", 403);
    const org = await this.organizations.findById(project.organizationId).lean();
    const context: ProjectContext = {
      id: String(project._id),
      organizationId: String(project.organizationId),
      name: project.name,
      slug: project.slug,
      description: project.description,
      authEnabled: project.authEnabled,
      publishedVersion: project.publishedVersion,
      publishedVersionId: project.publishedVersionId ? String(project.publishedVersionId) : null,
      organizationSlug: org?.slug ?? "",
    };
    return { project: context, role: membership.role };
  }

  async listProjects(userId: string, organizationId?: string) {
    const memberships = await this.memberships.find({ userId: new Types.ObjectId(userId) }).lean();
    const allowed = memberships
      .map((item) => item.organizationId)
      .filter((id) => !organizationId || String(id) === organizationId);
    const projects = await this.projects
      .find({ organizationId: { $in: allowed } })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    return projects.map((project) => ({
      id: String(project._id),
      organizationId: String(project.organizationId),
      name: project.name,
      slug: project.slug,
      description: project.description,
      authEnabled: project.authEnabled,
      publishedVersion: project.publishedVersion,
      updatedAt: project.updatedAt,
      role: memberships.find((item) => String(item.organizationId) === String(project.organizationId))?.role,
    }));
  }

  async createProject(userId: string, input: { organizationId: string; name: string; description?: string }) {
    const membership = await this.memberships
      .findOne({ organizationId: new Types.ObjectId(input.organizationId), userId: new Types.ObjectId(userId) })
      .lean();
    if (!membership || !hasRole(membership.role, "member")) throw new AppError("FORBIDDEN", "You cannot create projects here", 403);
    await this.usage.assertCanCreateProject(input.organizationId);
    const slug = await this.uniqueProjectSlug(input.organizationId, slugify(input.name));
    const project = await this.projects.create({
      organizationId: new Types.ObjectId(input.organizationId),
      name: input.name.trim(),
      slug,
      description: input.description?.trim() ?? "",
      createdBy: new Types.ObjectId(userId),
    });
    await this.environments.insertMany([
      { projectId: project._id, name: "development", variables: [] },
      { projectId: project._id, name: "production", variables: [] },
    ]);
    await this.audit.record({
      organizationId: input.organizationId,
      projectId: String(project._id),
      userId,
      action: "project.created",
      resource: "project",
      resourceId: String(project._id),
    });
    return this.requireProject(userId, String(project._id), "viewer");
  }

  async updateProject(projectId: string, organizationId: string, userId: string, patch: { name?: string; description?: string; authEnabled?: boolean }) {
    const update: Record<string, unknown> = {};
    if (patch.name) update.name = patch.name.trim();
    if (patch.description != null) update.description = patch.description;
    if (patch.authEnabled != null) update.authEnabled = patch.authEnabled;
    await this.projects.updateOne({ _id: projectId }, { $set: update });
    await this.audit.record({
      organizationId,
      projectId,
      userId,
      action: "project.updated",
      resource: "project",
      resourceId: projectId,
    });
    return this.projects.findById(projectId).lean();
  }

  async addMember(organizationId: string, actorId: string, email: string, role: MemberRole) {
    const actor = await this.memberships.findOne({ organizationId, userId: new Types.ObjectId(actorId) }).lean();
    if (!actor || !hasRole(actor.role, "admin")) throw new AppError("FORBIDDEN", "Only admins can invite members", 403);
    if (role === "owner") throw new AppError("FORBIDDEN", "Transfer ownership is not available yet", 400);
    const user = await this.users.findOne({ email: email.toLowerCase() }).lean();
    if (!user) throw new AppError("NOT_FOUND", "No user with that email", 404);
    await this.memberships.updateOne(
      { organizationId: new Types.ObjectId(organizationId), userId: user._id },
      { $setOnInsert: { role } },
      { upsert: true },
    );
    return { userId: String(user._id), email: user.email, role };
  }

  private async uniqueOrgSlug(base: string): Promise<string> {
    let slug = base;
    for (let i = 0; i < 20; i += 1) {
      const exists = await this.organizations.exists({ slug });
      if (!exists) return slug;
      slug = `${base}-${i + 2}`;
    }
    return `${base}-${crypto.randomUUID().slice(0, 6)}`;
  }

  private async uniqueProjectSlug(organizationId: string, base: string): Promise<string> {
    let slug = base;
    for (let i = 0; i < 20; i += 1) {
      const exists = await this.projects.exists({ organizationId, slug });
      if (!exists) return slug;
      slug = `${base}-${i + 2}`;
    }
    return `${base}-${crypto.randomUUID().slice(0, 6)}`;
  }
}
