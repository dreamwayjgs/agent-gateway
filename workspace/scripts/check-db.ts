import { Database } from "bun:sqlite";
const dbPath = process.env.DB_FILE ?? "../data/data.db";
const db = new Database(dbPath, { readonly: true });
const rows = db.query("SELECT * FROM files").all();
console.log(JSON.stringify(rows, null, 2));
