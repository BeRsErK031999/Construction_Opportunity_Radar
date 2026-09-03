import { loadAIConfig } from "@radar/config";

import { createConfiguredAIProvider } from "./configured-ai-provider.js";

const main = async (): Promise<void> => {
  const config = loadAIConfig();
  const configured = createConfiguredAIProvider(config);
  const [health, modelInfo] = await Promise.all([
    configured.provider.healthCheck(),
    configured.provider.modelInfo(),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        health,
        modelInfo,
        schemaVersion: "ai-provider-health/v1",
      },
      null,
      2,
    )}\n`,
  );
  if (health.status !== "HEALTHY") {
    process.exitCode = 1;
  }
};

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "AI provider health check failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
