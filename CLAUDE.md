Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

---

## Three Man Team

| 이름 | 역할 | 도구 | 역할 파일 |
|------|------|------|-----------|
| 앨리스 | Architect | Claude | `agents/ARCHITECT.md` |
| 밥 | Builder | Claude | `agents/BUILDER.md` |
| 리처드 | Reviewer (1차) | Claude | `agents/REVIEWER.md` |
| 로저 | Second Reviewer (2차) | Codex | `AGENTS.md` |

### 활성 리뷰어

- 리처드 (1차)
- 로저 (2차)

### Handoff 파일 (`agents/handoff/`)

| 파일 | 작성자 → 독자 |
|------|--------------|
| `ARCHITECT-BRIEF.md` | 앨리스 → 밥 |
| `REVIEW-REQUEST.md` | 밥 → 리처드 |
| `REVIEW-FEEDBACK.md` | 리처드 → 로저 → 밥 |
| `BUILD-LOG.md` | 공유 기록, 앨리스 소유 |
| `SESSION-CHECKPOINT.md` | 앨리스가 세션 종료 시 작성. |
