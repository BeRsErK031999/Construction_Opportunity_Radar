import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@radar/core": fromRoot("./packages/core/src/index.ts"),
      "@radar/db": fromRoot("./packages/db/src/index.ts"),
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    fileParallelism: false,
    include: ["packages/**/integration/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
