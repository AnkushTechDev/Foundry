import { Body, Controller, Get, Module, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { InjectModel } from "@nestjs/mongoose";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AppError, slugify } from "@foundry/shared";
import bcrypt from "bcryptjs";
import type { Response } from "express";
import { Model, Types } from "mongoose";
import { z } from "zod";
import { forgetSession, JwtAuthGuard } from "../common/guards";
import type { AuthedRequest } from "../common/request";
import { Membership, Organization, Session, User } from "../database/schemas";

const ACCESS_COOKIE = "foundry_access";
const REFRESH_COOKIE = "foundry_refresh";
const accessTtl = 15 * 60;
const refreshTtl = 14 * 24 * 60 * 60;

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  organization: z.string().min(2).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

function cookieBase() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

@Controller("auth")
@ApiTags("auth")
export class AuthController {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(Organization.name) private readonly organizations: Model<Organization>,
    @InjectModel(Membership.name) private readonly memberships: Model<Membership>,
    private readonly jwt: JwtService,
  ) {}

  @Post("register")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = registerSchema.parse(body);
    const email = input.email.toLowerCase();
    if (await this.users.exists({ email })) throw new AppError("CONFLICT", "An account with that email already exists", 409);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.users.create({ email, name: input.name.trim(), passwordHash });
    const base = slugify(input.organization || `${input.name.split(" ")[0]} workspace`);
    let slug = base;
    for (let i = 0; i < 30 && (await this.organizations.exists({ slug })); i += 1) slug = `${base}-${i + 2}`;
    const org = await this.organizations.create({
      name: (input.organization || `${input.name.trim()}'s workspace`).trim(),
      slug,
      ownerId: user._id,
      plan: "free",
    });
    await this.memberships.create({ organizationId: org._id, userId: user._id, role: "owner" });
    await this.issue(res, String(user._id), email);
    return { id: String(user._id), email, name: user.name, organization: { id: String(org._id), name: org.name, slug: org.slug } };
  }

  @Post("login")
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = loginSchema.parse(body);
    const user = await this.users.findOne({ email: input.email.toLowerCase() }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
    }
    await this.issue(res, String(user._id), user.email);
    return { id: String(user._id), email: user.email, name: user.name };
  }

  @Post("refresh")
  async refresh(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException("Sign in required");
    let payload: { sub: string; sid: string; email: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me" });
    } catch {
      throw new UnauthorizedException("Sign in required");
    }
    const session = await this.sessions.findOne({ _id: payload.sid, revokedAt: null, expiresAt: { $gt: new Date() } });
    if (!session) throw new UnauthorizedException("Sign in required");
    session.revokedAt = new Date();
    await session.save();
    forgetSession(payload.sid);
    await this.issue(res, payload.sub, payload.email);
    return { ok: true };
  }

  @Post("logout")
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sid: string }>(token, {
          secret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
        });
        await this.sessions.updateOne({ _id: payload.sid }, { $set: { revokedAt: new Date() } });
        forgetSession(payload.sid);
      } catch {
        // The cookie is cleared either way.
      }
    }
    res.clearCookie(ACCESS_COOKIE, cookieBase());
    res.clearCookie(REFRESH_COOKIE, cookieBase());
    return { ok: true };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthedRequest) {
    const user = await this.users.findById(req.authUser!.id).lean();
    if (!user) throw new UnauthorizedException("Sign in required");
    const memberships = await this.memberships.find({ userId: user._id }).lean();
    const orgs = await this.organizations.find({ _id: { $in: memberships.map((item) => item.organizationId) } }).lean();
    return {
      id: String(user._id),
      email: user.email,
      name: user.name,
      organizations: orgs.map((org) => ({
        id: String(org._id),
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        role: memberships.find((item) => String(item.organizationId) === String(org._id))?.role,
      })),
    };
  }

  private async issue(res: Response, userId: string, email: string) {
    const session = await this.sessions.create({
      userId: new Types.ObjectId(userId),
      tokenHash: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
      revokedAt: null,
    });
    const access = await this.jwt.signAsync(
      { sub: userId, sid: String(session._id), email, kind: "platform" },
      { expiresIn: accessTtl },
    );
    const refresh = await this.jwt.signAsync(
      { sub: userId, sid: String(session._id), email, kind: "refresh" },
      { secret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me", expiresIn: refreshTtl },
    );
    res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), maxAge: accessTtl * 1000 });
    res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), maxAge: refreshTtl * 1000 });
  }
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me",
      signOptions: { expiresIn: accessTtl },
    }),
  ],
  controllers: [AuthController],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
