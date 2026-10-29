import { existsSync, readFileSync } from "node:fs"
import { bindings, defineConfig, exports } from "cf/config"

// bdots.deploy.json: deployments set up before the rename to Coworkers.
const DEPLOY_FILE = ["coworkers.deploy.json", "bdots.deploy.json"].find((f) =>
  existsSync(f)
)

/**
 * Your deployment's own values, written by `pnpm run setup` (scripts/setup.ts)
 * and kept out of git. Anything it leaves out uses the defaults below.
 */
const deploy: Partial<{
  name: string
  model: string
  gateway: string
  accessTeamDomain: string
  accessAud: string
}> =
  // The installer packs a release for everyone: never with your values.
  !process.env.COWORKERS_PACKING && DEPLOY_FILE
    ? JSON.parse(readFileSync(DEPLOY_FILE, "utf8"))
    : {}

const WORKER_NAME = deploy.name ?? "coworkers"

/**
 * Cloudflare project config, read by the `cf` CLI and the Cloudflare Vite
 * plugin. This replaces wrangler.jsonc.
 *
 * One Worker serves everything: TanStack Start SSR, the agent WebSockets
 * (`/agents/*`), and the Durable Objects behind them. See `src/server.ts`.
 */
export default defineConfig({
  worker: {
    name: WORKER_NAME,
    compatibilityDate: "2026-09-01",
    // No `experimental`: Cloudflare refuses to deploy Workers that set it
    // (error 10021), though @cloudflare/computer's README asks for it.
    compatibilityFlags: ["nodejs_compat"],
    // Custom entry (not "@tanstack/react-start/server-entry") so the Worker
    // can export Durable Object classes and route /agents/* first.
    entrypoint: "./src/server.ts",
    observability: {
      enabled: true,
    },
    // Per-version preview hostnames are not covered by the Access app.
    previewUrls: false,
    exports: {
      // One per user: bot directory, connections, cross-bot routing.
      UserHub: exports.durableObject({ storage: "sqlite" }),
      // One per bot: chat, memory, routines, computer, browser.
      BotAgent: exports.durableObject({ storage: "sqlite" }),
      // One per app a bot built: live updates to everyone who has it open.
      AppLive: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      // Workers AI + AI Gateway for all model traffic. Neither this nor
      // Browser Run has a local simulator, so dev proxies to the account.
      AI: bindings.ai({ dev: { remote: true } }),
      // Browser Run: Quick Actions, Chromium sessions, Live View.
      BROWSER: bindings.browser({ dev: { remote: true } }),
      // Engine Quick Actions try first for page reads and extraction:
      // "kitesurf" (cheaper, falls back to Chromium when a page does not
      // render) or "chromium". Screenshots and PDFs always use Chromium.
      QUICK_ACTION_ENGINE: bindings.text("kitesurf"),
      // Optional: turns on the browser_crawl tool. /crawl is REST-only, so
      // it needs the account id here and an API token with "Browser
      // Rendering - Edit" in .dev.vars / the deploy secrets file.
      BROWSER_RUN_ACCOUNT_ID: bindings.text(""),
      BROWSER_RUN_API_TOKEN: bindings.secret(),
      // Optional: both secrets enable web_search through the Parallel proxy
      // on AI_GATEWAY_ID. The gateway token needs "AI Gateway - Run".
      PARALLEL_API_KEY: bindings.secret(),
      AI_GATEWAY_API_TOKEN: bindings.secret(),
      // Dynamic Workers: the bot's shell and sandboxed browser code.
      LOADER: bindings.workerLoader(),
      UserHub: bindings.durableObject({
        worker: WORKER_NAME,
        exportName: "UserHub",
      }),
      BotAgent: bindings.durableObject({
        worker: WORKER_NAME,
        exportName: "BotAgent",
      }),
      AppLive: bindings.durableObject({
        worker: WORKER_NAME,
        exportName: "AppLive",
      }),
      // Deployment default chat model. Users pick others (Workers AI,
      // Anthropic, OpenAI, Google, xAI) on the Models page and per bot;
      // those choices live on the UserHub. A "@cf/..." id runs on Workers
      // AI; a "<provider>/<model>" catalog id is billed with AI Gateway
      // Unified Billing credits or a provider key stored on the gateway.
      MODEL: bindings.text(
        deploy.model ?? "@cf/deepseek-ai/deepseek-v4.1-flash-1017"
      ),
      // Workers AI model a turn retries on when a third-party model fails.
      FALLBACK_MODEL: bindings.text("@cf/deepseek-ai/deepseek-v4.1-flash-1017"),
      // Optional model for background turns (routines, check-ins, email).
      // Empty uses the chat model.
      BACKGROUND_MODEL: bindings.text(""),
      // AI Gateway every model call goes through (logs, analytics, caching,
      // rate and spend limits). Empty uses "default", which Cloudflare
      // creates on first use.
      AI_GATEWAY_ID: bindings.text(deploy.gateway ?? ""),
      // Cloudflare Access in front of the Worker. When both are set, every
      // request must carry a valid Access JWT for this application; without
      // them everyone is the "demo" user. ACCESS_TEAM_DOMAIN is
      // "<team>.cloudflareaccess.com", ACCESS_AUD the application's AUD tag.
      ACCESS_TEAM_DOMAIN: bindings.text(deploy.accessTeamDomain ?? ""),
      ACCESS_AUD: bindings.text(deploy.accessAud ?? ""),
      // Domain with Email Routing that forwards to this Worker (catch-all
      // or one rule per bot). Each bot gets <user>.<bot>@EMAIL_DOMAIN.
      // Empty turns inbound email off.
      EMAIL_DOMAIN: bindings.text(""),
      // Web Push. Generate a pair with `npx web-push generate-vapid-keys`
      // and put both keys in .dev.vars / the deploy secrets file. Push
      // notifications stay off until they are set.
      VAPID_PUBLIC_KEY: bindings.secret(),
      VAPID_PRIVATE_KEY: bindings.secret(),
      VAPID_SUBJECT: bindings.text("mailto:bots@example.com"),
    },
  },
})
