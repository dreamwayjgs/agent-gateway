import { Database } from "bun:sqlite";

function printUsage(): void {
  console.log(`Usage:
  bun run db:query -- "SELECT * FROM messages ORDER BY id DESC LIMIT 5"
  bun run db:query -- "SELECT * FROM messages WHERE chat_id = ? LIMIT ?" "[-5284713059, 3]"

Notes:
  - DB file defaults to ./data.db
  - Override with DB_FILE=/path/to/file.db
  - Parameters must be a JSON array
`);
}

const args = process.argv.slice(2);
const sql = args[0]?.trim();
const rawParams = args[1];

if (!sql || sql === "--help" || sql === "-h") {
  printUsage();
  process.exit(0);
}

let params: unknown[] = [];
if (rawParams) {
  const parsed = JSON.parse(rawParams);
  if (!Array.isArray(parsed)) {
    throw new Error("Query parameters must be a JSON array.");
  }
  params = parsed;
}

const dbFile = process.env.DB_FILE ?? "./data.db";
const db = new Database(dbFile, { readonly: true });

try {
  const kind = sql.match(/^\s*(\w+)/)?.[1]?.toLowerCase();
  if (kind === "select" || kind === "with" || kind === "pragma" || kind === "explain") {
    const rows = db.query(sql).all(...params);
    console.log(JSON.stringify(rows, null, 2));
  } else {
    throw new Error("Read-only query tool supports SELECT/WITH/PRAGMA/EXPLAIN statements only.");
  }
} finally {
  db.close();
}
