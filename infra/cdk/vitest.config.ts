import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["cdk.out/**", "dist/**", "node_modules/**"],
    pool: "forks",
    maxWorkers: 1,
  },
});
