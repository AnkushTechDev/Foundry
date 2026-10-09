import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema, Types } from "mongoose";

@Schema({ timestamps: true, collection: "users" })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, trim: true })
  name!: string;
}
export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

@Schema({ timestamps: true, collection: "sessions" })
export class Session {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "User", required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;
}
export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);

@Schema({ timestamps: true, collection: "organizations" })
export class Organization {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, index: true })
  slug!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "User", required: true })
  ownerId!: Types.ObjectId;

  @Prop({ required: true, default: "free" })
  plan!: "free" | "pro" | "business";
}
export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationSchema = SchemaFactory.createForClass(Organization);

@Schema({ timestamps: true, collection: "memberships" })
export class Membership {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "Organization", required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "User", required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: ["owner", "admin", "member", "viewer"] })
  role!: "owner" | "admin" | "member" | "viewer";
}
export type MembershipDocument = HydratedDocument<Membership>;
export const MembershipSchema = SchemaFactory.createForClass(Membership);
MembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

@Schema({ timestamps: true, collection: "projects" })
export class Project {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "Organization", required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  slug!: string;

  @Prop({ default: "" })
  description!: string;

  @Prop({ default: false })
  authEnabled!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "User", required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  publishedVersionId!: Types.ObjectId | null;

  @Prop({ default: 0 })
  publishedVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type ProjectDocument = HydratedDocument<Project>;
export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
ProjectSchema.index({ organizationId: 1, updatedAt: -1 });

@Schema({ timestamps: true, collection: "environments" })
export class Environment {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true, enum: ["development", "production"] })
  name!: "development" | "production";

  @Prop({ type: [{ key: String, value: String }], default: [] })
  variables!: Array<{ key: string; value: string }>;
}
export type EnvironmentDocument = HydratedDocument<Environment>;
export const EnvironmentSchema = SchemaFactory.createForClass(Environment);
EnvironmentSchema.index({ projectId: 1, name: 1 }, { unique: true });

@Schema({ timestamps: true, collection: "secrets" })
export class Secret {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true, enum: ["development", "production"] })
  environment!: "development" | "production";

  @Prop({ required: true })
  key!: string;

  @Prop({ required: true })
  ciphertext!: string;

  @Prop({ required: true })
  iv!: string;

  @Prop({ required: true })
  tag!: string;

  createdAt!: Date;
  updatedAt!: Date;
}
export type SecretDocument = HydratedDocument<Secret>;
export const SecretSchema = SchemaFactory.createForClass(Secret);
SecretSchema.index({ projectId: 1, environment: 1, key: 1 }, { unique: true });

@Schema({ timestamps: true, collection: "data_models" })
export class DataModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  slug!: string;

  @Prop({ type: Array, default: [] })
  fields!: unknown[];
}
export type DataModelDocument = HydratedDocument<DataModel>;
export const DataModelSchema = SchemaFactory.createForClass(DataModel);
DataModelSchema.index({ projectId: 1, slug: 1 }, { unique: true });

@Schema({ timestamps: true, collection: "records" })
export class RecordDoc {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  modelId!: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  data!: Record<string, unknown>;
}
export type RecordDocument = HydratedDocument<RecordDoc>;
export const RecordSchema = SchemaFactory.createForClass(RecordDoc);
RecordSchema.index({ projectId: 1, modelId: 1, createdAt: -1 });

@Schema({ timestamps: true, collection: "workflows" })
export class Workflow {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: Array, default: [] })
  nodes!: unknown[];

  @Prop({ type: Array, default: [] })
  edges!: unknown[];

  createdAt!: Date;
  updatedAt!: Date;
}
export type WorkflowDocument = HydratedDocument<Workflow>;
export const WorkflowSchema = SchemaFactory.createForClass(Workflow);

@Schema({ timestamps: true, collection: "api_definitions" })
export class ApiDefinition {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  method!: string;

  @Prop({ required: true })
  path!: string;

  @Prop({ required: true, default: "public" })
  auth!: "public" | "authenticated" | "role" | "apiKey";

  @Prop({ type: [String], default: [] })
  roles!: string[];

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  workflowId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  modelId!: Types.ObjectId | null;
}
export type ApiDefinitionDocument = HydratedDocument<ApiDefinition>;
export const ApiDefinitionSchema = SchemaFactory.createForClass(ApiDefinition);
ApiDefinitionSchema.index({ projectId: 1, method: 1, path: 1 }, { unique: true });

@Schema({ timestamps: { createdAt: "startedAt", updatedAt: false }, collection: "executions" })
export class Execution {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  workflowId!: Types.ObjectId | null;

  @Prop({ required: true })
  source!: string;

  @Prop({ required: true })
  status!: "success" | "error";

  @Prop({ required: true })
  durationMs!: number;

  @Prop({ default: 200 })
  responseStatus!: number;

  @Prop({ type: Object, default: null })
  error!: { code: string; message: string; nodeId?: string } | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  userId!: Types.ObjectId | null;

  startedAt!: Date;
}
export type ExecutionDocument = HydratedDocument<Execution>;
export const ExecutionSchema = SchemaFactory.createForClass(Execution);
ExecutionSchema.index({ projectId: 1, startedAt: -1 });
ExecutionSchema.index({ workflowId: 1, startedAt: -1 });

@Schema({ collection: "node_executions" })
export class NodeExecution {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  executionId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  nodeId!: string;

  @Prop({ required: true })
  nodeType!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true })
  status!: "success" | "error";

  @Prop({ type: Object, default: null })
  input!: unknown;

  @Prop({ type: Object, default: null })
  output!: unknown;

  @Prop({ default: "" })
  error!: string;

  @Prop({ required: true })
  durationMs!: number;

  @Prop({ required: true })
  order!: number;
}
export type NodeExecutionDocument = HydratedDocument<NodeExecution>;
export const NodeExecutionSchema = SchemaFactory.createForClass(NodeExecution);

@Schema({ timestamps: true, collection: "pages", minimize: false })
export class Page {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  slug!: string;

  @Prop({ required: true })
  path!: string;

  @Prop({ default: "" })
  title!: string;

  @Prop({ default: "public" })
  auth!: "public" | "authenticated";

  @Prop({ type: Array, default: [] })
  queries!: unknown[];

  @Prop({ type: Object, default: {} })
  variables!: Record<string, unknown>;

  @Prop({ type: Object, required: true })
  root!: unknown;

  createdAt!: Date;
  updatedAt!: Date;
}
export type PageDocument = HydratedDocument<Page>;
export const PageSchema = SchemaFactory.createForClass(Page);
PageSchema.index({ projectId: 1, slug: 1 }, { unique: true });

@Schema({ timestamps: true, collection: "data_sources" })
export class DataSource {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, default: "internal" })
  source!: "internal" | "external";

  @Prop({ required: true })
  method!: string;

  @Prop({ required: true })
  path!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  connectionId!: Types.ObjectId | null;

  @Prop({ default: true })
  runOnLoad!: boolean;
}
export type DataSourceDocument = HydratedDocument<DataSource>;
export const DataSourceSchema = SchemaFactory.createForClass(DataSource);

@Schema({ timestamps: true, collection: "connections" })
export class Connection {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  baseUrl!: string;

  @Prop({ required: true, default: "none" })
  authType!: "none" | "apiKey" | "bearer" | "basic";

  @Prop({ default: "Authorization" })
  headerName!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  secretId!: Types.ObjectId | null;

  @Prop({ type: [{ key: String, value: String }], default: [] })
  headers!: Array<{ key: string; value: string }>;
}
export type ConnectionDocument = HydratedDocument<Connection>;
export const ConnectionSchema = SchemaFactory.createForClass(Connection);

@Schema({ timestamps: true, collection: "api_keys" })
export class ApiKey {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  prefix!: string;

  @Prop({ required: true, unique: true })
  hash!: string;

  @Prop({ required: true })
  lastFour!: string;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}
export type ApiKeyDocument = HydratedDocument<ApiKey>;
export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: "app_versions" })
export class AppVersion {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  version!: number;

  @Prop({ type: Object, required: true })
  snapshot!: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  publishedBy!: Types.ObjectId;

  createdAt!: Date;
}
export type AppVersionDocument = HydratedDocument<AppVersion>;
export const AppVersionSchema = SchemaFactory.createForClass(AppVersion);
AppVersionSchema.index({ projectId: 1, version: 1 }, { unique: true });

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: "audit_logs" })
export class AuditLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  projectId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  userId!: Types.ObjectId | null;

  @Prop({ required: true })
  action!: string;

  @Prop({ required: true })
  resource!: string;

  @Prop({ default: "" })
  resourceId!: string;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt!: Date;
}
export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
AuditLogSchema.index({ projectId: 1, createdAt: -1 });

@Schema({ timestamps: true, collection: "usage_records" })
export class UsageRecord {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  period!: string;

  @Prop({ default: 0 })
  apiCalls!: number;

  @Prop({ default: 0 })
  workflowExecutions!: number;

  @Prop({ default: 0 })
  aiTokens!: number;
}
export type UsageRecordDocument = HydratedDocument<UsageRecord>;
export const UsageRecordSchema = SchemaFactory.createForClass(UsageRecord);
UsageRecordSchema.index({ organizationId: 1, projectId: 1, period: 1 }, { unique: true });

@Schema({ timestamps: true, collection: "app_users" })
export class AppUser {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, default: "member" })
  role!: "admin" | "member";
}
export type AppUserDocument = HydratedDocument<AppUser>;
export const AppUserSchema = SchemaFactory.createForClass(AppUser);
AppUserSchema.index({ projectId: 1, email: 1 }, { unique: true });

export const MODEL_DEFINITIONS = [
  { name: User.name, schema: UserSchema },
  { name: Session.name, schema: SessionSchema },
  { name: Organization.name, schema: OrganizationSchema },
  { name: Membership.name, schema: MembershipSchema },
  { name: Project.name, schema: ProjectSchema },
  { name: Environment.name, schema: EnvironmentSchema },
  { name: Secret.name, schema: SecretSchema },
  { name: DataModel.name, schema: DataModelSchema },
  { name: RecordDoc.name, schema: RecordSchema },
  { name: Workflow.name, schema: WorkflowSchema },
  { name: ApiDefinition.name, schema: ApiDefinitionSchema },
  { name: Execution.name, schema: ExecutionSchema },
  { name: NodeExecution.name, schema: NodeExecutionSchema },
  { name: Page.name, schema: PageSchema },
  { name: DataSource.name, schema: DataSourceSchema },
  { name: Connection.name, schema: ConnectionSchema },
  { name: ApiKey.name, schema: ApiKeySchema },
  { name: AppVersion.name, schema: AppVersionSchema },
  { name: AuditLog.name, schema: AuditLogSchema },
  { name: UsageRecord.name, schema: UsageRecordSchema },
  { name: AppUser.name, schema: AppUserSchema },
];
