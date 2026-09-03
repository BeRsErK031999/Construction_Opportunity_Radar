import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@radar/ai-adapters": fromRoot("./packages/adapters/ai/src/index.ts"),
      "@radar/application": fromRoot("./packages/application/src/index.ts"),
      "@radar/config": fromRoot("./packages/config/src/index.ts"),
      "@radar/contracts": fromRoot("./packages/contracts/src/index.ts"),
      "@radar/core": fromRoot("./packages/core/src/index.ts"),
      "@radar/db": fromRoot("./packages/db/src/index.ts"),
      "@radar/delivery-adapters": fromRoot("./packages/adapters/delivery/src/index.ts"),
      "@radar/evals": fromRoot("./packages/evals/src/index.ts"),
      "@radar/jobs": fromRoot("./packages/jobs/src/index.ts"),
      "@radar/observability": fromRoot("./packages/observability/src/index.ts"),
      "@radar/source-adapters": fromRoot("./packages/adapters/sources/src/index.ts"),
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    include: ["apps/**/test/**/*.test.ts", "packages/**/test/**/*.test.ts"],
    restoreMocks: true,
  },
});
