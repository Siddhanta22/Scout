import { execSync } from "node:child_process";

// Apply real migrations to a throwaway SQLite file before the suite runs.
export default function setup() {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
