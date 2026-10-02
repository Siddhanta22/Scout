import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    env: { DATABASE_URL: "file:./test.db" },
    // One SQLite file shared by all test files, so run files serially.
    fileParallelism: false,
  },
});
