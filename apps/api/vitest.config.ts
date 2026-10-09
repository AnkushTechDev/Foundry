import path from "node:path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        parser: { syntax: "typescript", decorators: true, dynamicImport: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2022",
        keepClassNames: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@foundry/shared/server": path.resolve(__dirname, "../../packages/shared/src/server.ts"),
      "@foundry/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@foundry/workflow-engine": path.resolve(__dirname, "../../packages/workflow-engine/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 40_000,
    fileParallelism: false,
  },
});
