import { Database } from "bun:sqlite";
import { resolve } from "node:path";
const dbPath = resolve(import.meta.dir, "../..", process.env.DB_FILE ?? "data/data.db");
const db = new Database(dbPath, { readonly: true });
const rows = db.query("SELECT * FROM files").all();
console.log(JSON.stringify(rows, null, 2));
