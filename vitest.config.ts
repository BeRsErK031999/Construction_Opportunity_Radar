import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@radar/config": fromRoot("./packages/config/src/index.ts"),
      "@radar/contracts": fromRoot("./packages/contracts/src/index.ts"),
      "@radar/core": fromRoot("./packages/core/src/index.ts"),
      "@radar/observability": fromRoot("./packages/observability/src/index.ts"),
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    include: ["apps/**/test/**/*.test.ts", "packages/**/test/**/*.test.ts"],
    restoreMocks: true,
  },
});
