import "dotenv/config";
import { defineConfig } from "prisma/config";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const dbUrl = process.env.DATABASE_URL?.replace(/^file:/, "") ?? "src/db/data.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrate: {
    adapter: () => {
      const db = new Database(dbUrl);
      return new PrismaBetterSqlite3(db);
    },
  },
});
