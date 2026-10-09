import type { MemberRole } from "@foundry/shared";
import type { Request } from "express";

export interface AuthUser {
  id: string;
  email: string;
  sessionId: string;
}

export interface ProjectContext {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string;
  authEnabled: boolean;
  publishedVersion: number;
  publishedVersionId: string | null;
  organizationSlug: string;
}

declare global {
  namespace Express {
    interface Request {
      id?: string;
      authUser?: AuthUser;
      projectContext?: ProjectContext;
      memberRole?: MemberRole;
    }
  }
}

export type AuthedRequest = Request;
