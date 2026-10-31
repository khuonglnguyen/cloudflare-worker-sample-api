# cloudflare-worker-sample-api

A small, production-shaped **Cloudflare Worker** API in TypeScript. It is a trimmed-down
sample of a cloud-storage backend and shows the patterns worth copying:

- **R2** (binding) for file bytes, namespaced per user (`users/<google-sub>/…`)
- **D1** for relational data (expiring public share links) + SQL migrations
- **Google sign-in**: ID-token verification (`Authorization: Bearer`) with a small in-memory cache
- **Cron Trigger** that purges expired links
- Path sanitizing (no `..` traversal), CSPRNG short ids, CORS allow-list, uniform JSON errors
- **Vitest** with `@cloudflare/vitest-pool-workers` (runs against local R2/D1 simulators)

No secrets are stored in this repo.

## Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | no | Liveness check |
| GET | `/me` | yes | The authenticated user |
| GET | `/files?prefix=&cursor=` | yes | List one folder level |
| PUT | `/files?key=a/b.txt` | yes | Upload (raw body, `Content-Length` required, ≤ 100 MB) |
| GET | `/files/download?key=a/b.txt` | yes | Download |
| POST | `/files/delete` `{keys}` | yes | Delete up to 100 keys |
| POST | `/folders` `{path}` | yes | Create a folder |
| POST | `/share/create` `{key, expiresInSeconds?}` | yes | Create a public link (default 7 days, max 30) |
| GET | `/share/:id` | no | Download via a share link |

## Getting started

```bash
bun install

# 1. Create resources and put the D1 id in wrangler.jsonc
bunx wrangler r2 bucket create sample-api-files
bunx wrangler d1 create sample-api-db

# 2. Set GOOGLE_CLIENT_ID / FRONTEND_URL in wrangler.jsonc, then apply the schema
bun run migrate:local     # local simulator
bun run migrate:remote    # real database

bun run cf-typegen        # regenerate worker-configuration.d.ts after binding changes
bun run dev               # http://localhost:8787
bun run test
bun run deploy            # runs tests first
```

Secrets (if you add any) go in `.dev.vars` locally (see `.dev.vars.example`) and
`wrangler secret put NAME` when deployed — never in `wrangler.jsonc`.

## Layout

```
src/
  index.ts          # fetch + scheduled entrypoints, routing, auth gate
  types.ts          # Env bindings and shared types
  utils.ts          # sanitizeRelativePath, generateShortId, JSON/CORS helpers
  modules/
    auth.ts         # verifyGoogleToken
    files.ts        # list / upload / download / delete / folders (R2)
    share.ts        # share links (D1 + R2) and the cron purge
migrations/         # D1 schema
test/               # Vitest suites
```

## Conventions

Tabs, single quotes, semicolons, print width 140 (`.prettierrc`). Always run user paths
through `sanitizeRelativePath()` before building an R2 key, and always prefix keys with
`userPrefix(user.sub)`.
