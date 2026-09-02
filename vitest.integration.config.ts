import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@radar/application": fromRoot("./packages/application/src/index.ts"),
      "@radar/contracts": fromRoot("./packages/contracts/src/index.ts"),
      "@radar/core": fromRoot("./packages/core/src/index.ts"),
      "@radar/db": fromRoot("./packages/db/src/index.ts"),
      "@radar/delivery-adapters": fromRoot("./packages/adapters/delivery/src/index.ts"),
      "@radar/source-adapters": fromRoot("./packages/adapters/sources/src/index.ts"),
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
