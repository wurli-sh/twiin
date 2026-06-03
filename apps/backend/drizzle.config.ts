import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DB_URL ?? "file:./twiin.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
