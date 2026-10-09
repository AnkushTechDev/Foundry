import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MODEL_DEFINITIONS } from "./schemas";

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/foundry",
        autoIndex: true,
        serverSelectionTimeoutMS: 8_000,
      }),
    }),
    MongooseModule.forFeature(MODEL_DEFINITIONS),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
