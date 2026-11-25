import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

export class DataDirLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataDirLockedError";
  }
}

export interface OpenedDatabase {
  db: Database;
  close(): void;
}

export type Database = NodeSQLiteDatabase;

function isLockedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const errcode = (error as Error & { errcode?: number }).errcode;
  return errcode === 5 || /database is locked|SQLITE_BUSY/i.test(error.message);
}

export function openDatabase(file: string): OpenedDatabase {
  const client = new DatabaseSync(file);
  try {
    client.exec("PRAGMA busy_timeout = 0");
    client.exec("PRAGMA locking_mode = EXCLUSIVE");
    client.exec("PRAGMA journal_mode = WAL");
    client.exec("PRAGMA foreign_keys = ON");
    client.exec("BEGIN IMMEDIATE");
    client.exec("COMMIT");
  } catch (error) {
    client.close();
    if (isLockedError(error)) throw new DataDirLockedError("data directory is already open in another core");
    throw error;
  }

  try {
    const db = drizzle({ client });
    migrate(db, { migrationsFolder: fileURLToPath(new URL("./migrations/", import.meta.url)) });
    return { db, close: () => client.close() };
  } catch (error) {
    client.close();
    throw error;
  }
}
