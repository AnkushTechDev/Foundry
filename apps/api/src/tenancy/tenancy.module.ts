import { Body, Controller, Get, Module, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../common/guards";
import type { AuthedRequest } from "../common/request";
import { Req } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TenancyService } from "./tenancy.service";

const orgSchema = z.object({ name: z.string().min(2).max(80) });
const memberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]),
});

@ApiTags("workspace")
@Controller()
@UseGuards(JwtAuthGuard)
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get("organizations")
  listOrgs(@Req() req: AuthedRequest) {
    return this.tenancy.listOrganizations(req.authUser!.id);
  }

  @Post("organizations")
  createOrg(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.tenancy.createOrganization(req.authUser!.id, orgSchema.parse(body).name);
  }

  @Post("organizations/:organizationId/members")
  addMember(@Req() req: AuthedRequest, @Body() body: unknown, @Query() _query: unknown) {
    const parsed = memberSchema.parse(body);
    const organizationId = String(req.params.organizationId);
    return this.tenancy.addMember(organizationId, req.authUser!.id, parsed.email, parsed.role);
  }

  @Get("projects")
  listProjects(@Req() req: AuthedRequest, @Query("organizationId") organizationId?: string) {
    return this.tenancy.listProjects(req.authUser!.id, organizationId);
  }

  @Post("projects")
  async createProject(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = z.object({
      organizationId: z.string().min(1),
      name: z.string().min(2).max(80),
      description: z.string().max(400).optional(),
    }).parse(body);
    const access = await this.tenancy.createProject(req.authUser!.id, parsed);
    return { ...access.project, role: access.role };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [TenancyController],
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
