import { defineConfig } from "prisma/config";
import { config as dotenv } from "dotenv";

dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
});
