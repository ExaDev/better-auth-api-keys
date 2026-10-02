import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * A separate config file, not another vitest.config.ts project: the workers pool needs its own environment/runtime setup that conflicts with the plain Node projects.
 */
export default defineConfig({
  test: { include: ["test/workers/**/*.integration.test.ts"] },
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
