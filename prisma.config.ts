import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx scripts/seed.ts" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://sincelasttime:sincelasttime@localhost:5432/sincelasttime" },
});
