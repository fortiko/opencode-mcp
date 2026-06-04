import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Tests hit the real OpenCode server — allow up to 30s per test for agent responses
    testTimeout: 30_000,
    // Run test files sequentially to avoid hammering the server
    pool: "forks",
    singleFork: true,
    reporters: ["verbose"],
  },
});
