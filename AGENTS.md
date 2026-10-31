# Agent Instructions

This is **coworkers**, a **TanStack Start + Cloudflare Workers** app built to be
driven by coding agents. Read this whole file before generating code. The patterns
here are the ones that work — most AI training data is out of date for
TanStack Start, for Workers, and especially for the `cf` CLI.

## This project: Coworkers

Coworkers is a multi-bot "AI teammates" app. Each bot is a
Durable Object with its own chat, memory, routines, computer and browser.

| Piece          | Where                                                                             | Notes                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker entry   | `src/server.ts`                                                                   | Auth-checks and routes `/agents/*`, then hands off to TanStack Start. Exports the Durable Object classes.                                                                         |
| `UserHub`      | `src/agents/user-hub.ts`                                                          | One per user. Bot directory (sidebar), bot-to-bot relay, and every MCP connection (one sign-in per user; bots call tools through `appCatalog()` / `callAppTool()`).               |
| `BotAgent`     | `src/agents/bot-agent.ts`                                                         | One per bot (`<userId>:<botId>`). Extends `Think`. Tools, rules, routines, computer, browser. Holds no MCP connections of its own.                                                |
| Models         | `src/lib/models.ts`, `src/agents/models.ts`                                       | Model catalog (shared) and the AI Gateway model factory. Account choice on `UserHub`, per-bot override in `BotState.model`, Workers AI fallback.                                  |
| System prompt  | `src/agents/prompt.ts`                                                            | Stable "soul" plus per-turn context.                                                                                                                                              |
| Desk           | `src/agents/desk.ts`, `src/routes/_app/index.tsx`, `src/components/desk-card.tsx` | Home screen of cards. Bots build them (`desk.ts`), the `UserHub` stores them (`desk_cards`) and closes approval cards once they are answered anywhere. Plan: `docs/desk-plan.md`. |
| Operations     | `src/control/`                                                                    | One definition per action (bots, the browser, later `/mcp`): `runOperation` checks caller, level, approval and ceiling. Plan: `docs/mcp-plan.md`.                                 |
| Outside agents | `src/mcp/`, `src/components/agents-settings.tsx`                                  | OAuth server, consent page (`/oauth/authorize`) and `/mcp` serving the operations to Claude Code, Codex and other MCP clients. Storage: the `OAuthStore` Durable Object.          |
| Shared types   | `src/lib/types.ts`                                                                | Imported by both the agents and the client. No server-only imports.                                                                                                               |
| First paint    | `src/lib/server-fns.ts`                                                           | Server functions that read a snapshot over DO RPC.                                                                                                                                |
| Live state     | `src/lib/hub-context.tsx`, `src/routes/_app/bots.$botId.tsx`                      | `useAgent` / `useAgentChat`, browser only, inside `ClientOnly`.                                                                                                                   |
| Thread UI      | `src/components/thread.tsx`, `computer-card.tsx`, `src/lib/message-parts.ts`      | Tool parts become Computer cards, step lists, approval cards and system events.                                                                                                   |
| Phones and PWA | `src/components/sheet.tsx`, `src/lib/viewport.ts`, `public/manifest.json`, `public/sw.js` | Below `md`, `SplitView` panels open as Base UI Drawer sheets, `/` is the bot list (`Sidebar home`) and the Desk is `/?desk=true`. The service worker caches `/assets/*` only, never pages. Install files are on the Access bypass list.                |

Things that will bite you:

- **`agents()` from `agents/vite` must stay in `vite.config.ts`.** It
  transforms the `@callable()` decorators. Without it dev fails with
  `SyntaxError: Invalid or unexpected token`.
- **`@callable()` methods are called by the browser; plain public methods
  are Durable Object RPC** (hub ↔ bot, server functions → DO). Do not mark
  bot-facing methods `@callable()`.
- **Agent state is broadcast to the browser.** Never put secrets in it
  (connection header values live in a SQL table on the `UserHub`).
- **WebSocket hooks cannot run during SSR.** Keep `useAgent` and
  `useAgentChat` under `ClientOnly`, with a loader-fed fallback.
- **A new Durable Object class needs a `CLASS_HISTORY` entry** in
  `installer/src/deploy/upload.ts`. Installer updates only create the
  classes listed there after the Worker's migration tag.
- **Never add the `experimental` compatibility flag.** `@cloudflare/computer`'s
  README asks for it, but Cloudflare rejects any deploy that sets it
  (error 10021), so nobody could deploy Coworkers.
- **Scripts (`run_js`) replay after a restart.** The JavaScript backend runs
  with `onInterrupt: "replay"`: a run cut off by a deploy restarts and every
  host call it already made is answered from a journal. Host module
  functions (`ws:*`) must therefore be safe to run again up to their
  `ctx.interrupt()`, and anything with side effects that cannot dedupe on
  `ctx.callId` must be wrapped in `unsafeToRepeat()`. `script_runs` tracks
  each run so its result reaches the bot as a message once its turn is gone.
- **`cf dev` needs a Cloudflare login** because `AI` and `BROWSER` are
  remote-only bindings. The dev server uses Wrangler's login
  (`npx wrangler login`), which can differ from `cf auth login`.
- The route tree (`src/routeTree.gen.ts`) is regenerated by `pnpm dev` and
  `pnpm build`. Do not run `npx tsr`; that is an unrelated package.
- Agent packages (`agents`, `@cloudflare/think`, `@cloudflare/computer`)
  move fast. Read the types in `node_modules` and the docs at
  `https://developers.cloudflare.com/agents/llms.txt` before changing how
  they are used.

## Stack

- **TanStack Start** — full-stack React on Vite, file-based routing
- **Cloudflare Workers** as the runtime (not Node, not Pages)
- **`cf` CLI** for dev, build, deploy and every Cloudflare resource — it is
  the successor to Wrangler. This project has **no `wrangler.jsonc`**.
- **`cloudflare.config.ts`** — typed project config (replaces `wrangler.jsonc`)
- **Cloudflare Vite plugin 2.0 beta** (`@cloudflare/vite-plugin`) — runs the
  app on workerd in dev, same as production
- **Drizzle ORM** + **Drizzle Kit** — installed and ready; used with D1 once
  a database is added
- **Zod** for input validation (`drizzle-zod` for table-derived schemas)
- **Tailwind v4** + **Kumo** (`@cloudflare/kumo`) for UI
- **Hugeicons** (`@hugeicons/react` + `@hugeicons/core-free-icons`) — import
  icons from `@/components/icons`, which wraps them at `1em` with the default
  stroke. Phosphor stays installed only as Kumo's peer dependency.
- **pnpm** as the package manager

## Rules that matter most

1. **Add bindings only when a feature needs them.** There is no D1
   database, bucket, or KV namespace yet. Add one only when a feature
   requires it, following "Adding a binding" below.
2. **Never leave a resource binding without an `id`.** `cf deploy`
   auto-provisions a new resource for any D1/KV/R2 binding that has no
   identifier, and does not write the new ID back. Create the resource
   explicitly, then paste its ID into `cloudflare.config.ts`.
3. **Use `cf`, not `wrangler`.** Wrangler cannot read `cloudflare.config.ts`.
   The only exception is live logs: `npx wrangler tail <WORKER_NAME>`.
4. **Look up Cloudflare docs before writing Cloudflare code** (next section).
   `cf` and `cloudflare.config.ts` are newer than your training data.
5. **`cloudflare:workers` is server-only.** Never import it from code that
   runs in the browser.

## Cloudflare docs — look things up, don't guess

Before using any Cloudflare API, binding, config field, or `cf` command you
are not certain about, fetch the current docs. Use the first option that is
available to you, and do not stop to ask the user to install anything:

1. **Cloudflare Docs MCP server** — if your tool list includes a Cloudflare
   documentation search tool (server `https://docs.mcp.cloudflare.com/mcp`,
   commonly exposed as `search_cloudflare_documentation`), use it.
2. **Cloudflare skills** — if skills such as `cloudflare`, `wrangler`,
   `durable-objects`, or `agents-sdk` are installed, load the relevant one.
3. **Fetch the docs directly** from `https://developers.cloudflare.com/`.
   Every page is available as Markdown:
   - Index of all products: `https://developers.cloudflare.com/llms.txt`
   - Per-product index: `https://developers.cloudflare.com/<product>/llms.txt`
     (e.g. `/cf/llms.txt`, `/workers/llms.txt`, `/d1/llms.txt`, `/r2/llms.txt`)
   - Any page as Markdown: append `index.md` to its URL, e.g.
     `https://developers.cloudflare.com/cf/projects/cloudflare-config/index.md`

Pages you will need most:

| Topic                             | URL                                                                        |
| --------------------------------- | -------------------------------------------------------------------------- |
| `cloudflare.config.ts` reference  | `https://developers.cloudflare.com/cf/projects/cloudflare-config/index.md` |
| `cf` dev / build / deploy / modes | `https://developers.cloudflare.com/cf/projects/index.md`                   |
| Using `cf` as an agent            | `https://developers.cloudflare.com/cf/agents/index.md`                     |
| Wrangler → `cf` equivalents       | `https://developers.cloudflare.com/cf/wrangler/reference/index.md`         |

## The `cf` CLI

`cf` has ~3,000 commands generated from the Cloudflare API. Do not explore
it with nested `--help` calls. Discover commands like this:

```bash
cf cli search "create D1 database"   # natural-language search, runs locally
cf schema d1 create                  # show the API request a command sends
cf d1 create --name my-db --dry-run  # preview without sending anything
```

Things that differ from Wrangler:

- Resource commands take **IDs**, not names (e.g. a D1 database UUID).
- Commands act on **remote** resources unless you pass `--local`.
- Output is JSON on stdout; messages and errors go to stderr.
- A destructive command without `--force` in a non-interactive shell prints
  `Aborted.` and exits `0` — a zero exit does not mean it ran.
- Keep `cf cli search` queries generic. Never put names, IDs, domains, or
  tokens in them.

Signing in (`cf auth login`) opens a browser, so ask the user to run it. It
is only needed for deploys and remote resource commands — `cf dev`,
`cf build`, and `cf deploy --dry-run` work without credentials.

## Commands

```bash
pnpm dev         # cf dev   — Vite dev server on :3000, running on workerd
pnpm build       # cf build — production build into .cloudflare/output/
pnpm run deploy  # cf deploy — build + upload + deploy
pnpm typecheck   # regenerate binding types, then tsc
pnpm cf-typegen  # cf workers types → .cloudflare/types/index.d.ts
pnpm db:generate # drizzle-kit generate (after a schema exists)
pnpm format      # prettier
```

- Use `pnpm run deploy`, not `pnpm deploy` — the latter is a pnpm built-in
  that does something else.
- `cf dev` and `cf build` run Vite directly and forward only `--mode`. Set
  anything else (port, host) in `vite.config.ts`.
- `cf build` does not run the `build` script from `package.json`. If a step
  must run before the build, chain it in the script yourself.
- `cf deploy --dry-run` builds and prints the bindings it would deploy,
  without uploading. Run it to check config changes.
- While `cf dev` runs, the Local Explorer API at
  `http://localhost:3000/cdn-cgi/local/explorer/api` lets you inspect local
  D1/KV/R2 data and query request traces and logs.

## Project config — `cloudflare.config.ts`

```ts
import { bindings, defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "my-app",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "./src/server.ts",
    observability: { enabled: true },
    env: {
      // bindings go here
    },
  },
})
```

- Bindings live in `worker.env`, built with `bindings.*()`.
- Routes, crons, and queue consumers live in `worker.triggers`, built with
  `triggers.*()`.
- Environments are **modes**: export a function `defineConfig(({ mode }) => …)`
  and return one complete config per mode. Select with `--mode staging`.
- Build settings (aliases, source maps, port) belong in `vite.config.ts`,
  not here.
- When starting a real project from this template, rename `worker.name` and
  the `name` in `package.json`.

## How bindings work

Bindings are declared in `cloudflare.config.ts` and read on the **server
only**:

```ts
import { env } from "cloudflare:workers"

env.DB // D1Database  — once you have added a DB binding
env.STORAGE // R2Bucket    — once you have added a STORAGE binding
```

- `cloudflare:workers` is a **virtual module**. Import it only from
  server-only code: server functions, API route `server.handlers`,
  middleware.
- Do **not** pass `env` through function arguments. Import it where you need
  it.
- `Env` types are inferred directly from `cloudflare.config.ts`, so a new
  binding is typed as soon as you save the config. The generated file
  `.cloudflare/types/index.d.ts` is git-ignored; `pnpm dev`, `pnpm build`
  and `pnpm typecheck` all regenerate it.

### Adding a binding

Load the `add-binding` skill for the full recipe. In short:

```bash
# 1. create the resource (needs `cf auth login`); note the ID it prints
cf d1 create --name my-app-db
cf r2 buckets create --name my-app-storage
cf kv namespaces create --title my-app-cache
```

```ts
// 2. declare it in cloudflare.config.ts
env: {
  DB: bindings.d1({ name: "my-app-db", id: "<DATABASE_ID>" }),
  STORAGE: bindings.r2({ name: "my-app-storage" }),
  CACHE: bindings.kv({ id: "<NAMESPACE_ID>" }),
  APP_ENV: bindings.text("production"),
  API_KEY: bindings.secret(),
},
```

```bash
# 3. verify
pnpm typecheck && cf deploy --dry-run
```

In local dev every binding is simulated on disk under `.cloudflare/state/`;
no remote resource is touched.

### Secrets

- Declare each secret the Worker reads with `bindings.secret()`.
- Local values go in `.dev.vars` (copy `.dev.vars.example`). `cf dev` warns
  about declared secrets that are missing.
- Production values are uploaded with a deploy:
  `cf deploy --secrets-file <PATH>` (JSON or `.env` format). Never commit
  that file or put secret values in `cloudflare.config.ts`.

## Server functions vs API routes

This template ships both. They are different things. Pick correctly.

### Server functions — `createServerFn`

Use for data the **app's own UI** consumes. They are typed RPCs, not URLs.

```ts
import { createServerFn } from "@tanstack/react-start"

const getServerInfo = createServerFn().handler(() => {
  return { renderedAt: new Date().toISOString() }
})

export const Route = createFileRoute("/")({
  loader: () => getServerInfo(),
  component: App,
})
```

- Called like `getServerInfo()` from a loader/component.
- Inputs validated via `.validator(...)`.
- No URL to think about, no manual `fetch`.

### API routes — file-based, `server.handlers`

Use for **external HTTP callers**: curl, mobile apps, webhooks, anything
that needs a stable URL + verb.

```ts
// src/routes/api/hello.ts  →  /api/hello
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/hello")({
  server: {
    handlers: {
      GET: ({ request }) => Response.json({ message: "Hello" }),
      POST: async ({ request }) => {
        const body = await request.json()
        return Response.json(body, { status: 201 })
      },
    },
  },
})
```

- File path → URL. `src/routes/api/items.$id.ts` → `/api/items/:id`.
- Handlers take `{ request, params }` and return a Web `Response`.
- **No** `component` field needed if it's a pure API route.

### What NOT to do

- Don't write `createServerFileRoute(...)`. That's an old API. Use
  `createFileRoute(...).server.handlers`.
- Don't write a Hono/Express app inside the Worker entry. TanStack Start's
  server entry already handles routing — just add a file route.
- Don't use `process.env` for bindings. It won't work.
- Don't pass `env` as a parameter. Import it.
- Don't create `wrangler.jsonc` / `wrangler.toml` or run `wrangler dev` /
  `wrangler deploy`.

## Database — D1 + Drizzle

Drizzle is installed but **no database is configured**. When a feature needs
persistence, load the `new-db-table` skill — it covers first-time setup and
every table after that. The shape of it:

1. Create the database and add the `DB` binding **with its `id`** (see
   "Adding a binding").
2. Create `src/db/schema.ts` (tables + `drizzle-zod` schemas) and
   `src/db/index.ts` (`drizzle(env.DB, { schema })`).
3. Generate and apply migrations:

   ```bash
   pnpm db:generate   # drizzle-kit writes SQL to ./drizzle/

   # local — must point at the dev server's state directory
   cf d1 migrations apply <DATABASE_ID> --local --persist-to .cloudflare/state --dir drizzle

   # production
   cf d1 migrations apply <DATABASE_ID> --dir drizzle
   ```

Notes:

- Migrations are **generated** by drizzle-kit and **applied** by `cf`. Never
  use `drizzle-kit push` or `drizzle-kit migrate`.
- `cf d1 migrations apply` takes the database **UUID**; names and binding
  names are rejected. Without `--local` it hits the **remote** database.
- Without `--persist-to .cloudflare/state`, `--local` writes to a global
  directory that the dev server never reads.
- D1 is SQLite: use `text`, `int`, `real`, `blob` from
  `drizzle-orm/sqlite-core`. No `varchar`, `serial`, or Postgres types.

## Validation

Validate every request body with Zod's `.safeParse(...)`: parse JSON, return
`400` with `issues` on failure. See `src/routes/api/hello.ts` for the
canonical POST pattern. For data that maps to a table, derive the schema
with `drizzle-zod` (`createInsertSchema(table).pick({...})`) instead of
writing it by hand.

## Skills

Load a skill when the task matches — it has the exact steps.

| Skill           | When to use                                         |
| --------------- | --------------------------------------------------- |
| `new-api-route` | Creating a new HTTP endpoint (REST route)           |
| `add-binding`   | Adding D1, R2, KV, a Queue, a secret, or a variable |
| `new-db-table`  | Setting up D1 + Drizzle, adding or changing tables  |

Skills live in `.agents/skills/` (`.claude/skills` is a symlink to it).

## Paths

- `@/*` → `./src/*`

## When in doubt

- `src/lib/server-fns.ts` — server-function examples
- `src/routes/api/hello.ts` — API-route example with Zod validation
- `cloudflare.config.ts` — Worker config and bindings
- `vite.config.ts` — dev server port, source maps, plugins
- Cloudflare behaviour — look it up (see "Cloudflare docs" above)
