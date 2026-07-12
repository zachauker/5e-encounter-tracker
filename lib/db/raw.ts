import Database from "better-sqlite3";
import path from "path";
import { loadVec } from "./load-vec";

let _sqlite: Database.Database | null = null;

/** Raw better-sqlite3 handle (vec loaded) for statements Drizzle can't express (vec table ops). */
export function getDbSqlite(): Database.Database {
  if (!_sqlite) {
    _sqlite = new Database(process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db"));
    _sqlite.pragma("foreign_keys = ON");
    loadVec(_sqlite);
  }
  return _sqlite;
}
