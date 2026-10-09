import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { BuilderModule } from "./builder/builder.module";
import { DatabaseModule } from "./database/database.module";
import { PlatformModule } from "./platform/platform.module";
import { TenancyModule } from "./tenancy/tenancy.module";

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }] }),
    DatabaseModule,
    PlatformModule,
    AuthModule,
    TenancyModule,
    BuilderModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [BuilderModule],
})
export class AppModule {}
