import { SQLDatabase } from "encore.dev/storage/sqldb";
import { drizzle } from "drizzle-orm/node-postgres";

const AuthDB = new SQLDatabase("statecraft", {
  migrations: "./migrations",
});

export const db = drizzle(AuthDB.connectionString);
