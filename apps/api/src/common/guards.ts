import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { InjectModel } from "@nestjs/mongoose";
import { hasRole, type MemberRole } from "@foundry/shared";
import { Model, Types } from "mongoose";
import { PROJECT_ROLE } from "../common/http";
import type { AuthedRequest } from "../common/request";
import { Session } from "../database/schemas";
import { TenancyService } from "../tenancy/tenancy.service";

const ACCESS_COOKIE = "foundry_access";
const cache = new Map<string, { email: string; userId: string; expires: number }>();

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const token = bearer && !bearer.startsWith("fk_") ? bearer : request.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException("Sign in required");
    let payload: { sub: string; sid: string; email: string; kind?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException("Sign in required");
    }
    if (payload.kind && payload.kind !== "platform") throw new UnauthorizedException("Sign in required");
    const cached = cache.get(payload.sid);
    const now = Date.now();
    if (!cached || cached.expires < now) {
      if (!Types.ObjectId.isValid(payload.sid)) throw new UnauthorizedException("Sign in required");
      const session = await this.sessions.findOne({ _id: payload.sid, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
      if (!session) throw new UnauthorizedException("Sign in required");
      cache.set(payload.sid, { email: payload.email, userId: payload.sub, expires: now + 15_000 });
      if (cache.size > 5_000) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    }
    request.authUser = { id: payload.sub, email: payload.email, sessionId: payload.sid };
    return true;
  }
}

export function forgetSession(sessionId: string): void {
  cache.delete(sessionId);
}

export const ProjectRoles = (role: MemberRole) => SetMetadata(PROJECT_ROLE, role);

@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenancy: TenancyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const projectId = request.params.projectId;
    if (!projectId || Array.isArray(projectId)) return true;
    const required = this.reflector.getAllAndOverride<MemberRole>(PROJECT_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]) ?? "viewer";
    const access = await this.tenancy.requireProject(request.authUser!.id, projectId, required);
    if (!hasRole(access.role, required)) return false;
    request.projectContext = access.project;
    request.memberRole = access.role;
    return true;
  }
}
