import { DurableObject, WorkerEntrypoint } from "cloudflare:workers"
import { getAgentByName } from "agents"
import { botInstanceName } from "@/lib/types"
import type { AppLink } from "@/lib/types"
import type { BotAgent } from "./bot-agent"
import type { UserHub } from "./user-hub"
import { accessConfigured, identify, Unauthorized } from "@/lib/auth"

/**
 * Serving the apps bots build.
 *
 *   /apps/<userId>/<botId>/<slug>/<token>/<path>
 *
 * Owner/email entry links require verified identity and bootstrap short-lived
 * app-scoped sessions. Explicit secret share links work without a login. Keep
 * `/apps/*` in the Access bypass: the Worker enforces each app's permissions.
 * Responses carry a CSP `sandbox`, so app code runs in an opaque origin
 * and cannot reach the Coworkers UI, its cookies, or the agent sockets.
 *
 * Reserved paths under an app:
 *   _coworkers.js     the browser helper (window.coworkers)
 *   _data[/c[/id]]    JSON API over the app's collections
 *   _tell             POST { text }: message the bot
 *   _error            POST { message, stack, source }: a page error, for the bot to fix
 *   _live             WebSocket: change and reload events (AppLive)
 */

/** What a caller can do through an app link (or `env.BOT` in server.js). */
export type AppDataOp =
  | { op: "info" }
  | { op: "list"; collection: string }
  | { op: "get"; collection: string; id: string }
  | {
      op: "put"
      collection: string
      item: Record<string, unknown>
      merge?: boolean
    }
  | { op: "remove"; collection: string; id: string }
  | { op: "tell"; text: string }
  | {
      op: "error"
      message: string
      stack?: string
      source?: string
      /** The app version the page was served at, from its coworkers-version meta. */
      version?: number
    }

export type AppLiveMessage =
  | { type: "change"; collection: string; id?: string }
  | { type: "reload"; version: number }

export interface AppCaller {
  label: string
  mode: AppLink["mode"]
  canMessage?: boolean
  /** The link's token, for per-link rate limits. Never shown to the app. */
  token?: string
  /** The visitor's IP, for per-visitor rate limits. Never shown to the app. */
  ip?: string
  /** The user's own link: not rate limited. Never shown to the app. */
  owner?: boolean
  /**
   * Set when the call comes from the app's own server.js, not the page.
   * That code is the app's backend: it reads and writes the app's data in
   * full and decides itself what the visitor may see, like it does for
   * app tools. The visitor's link still limits what the page can do.
   */
  server?: boolean
}

/** The part of a caller an app may see. */
export function publicCaller(caller: AppCaller) {
  return {
    label: caller.label,
    mode: caller.mode,
    canMessage: caller.canMessage ?? false,
  }
}

export function appLiveName(userId: string, botId: string, slug: string) {
  return `${userId}:${botId}:${slug}`
}

function botStub(env: Env, userId: string, botId: string) {
  return getAgentByName(
    env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
    botInstanceName(userId, botId)
  )
}

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  })

/** Headers on everything an app serves. */
function withAppHeaders(response: Response, origin: string) {
  const headers = new Headers(response.headers)
  const host = new URL(origin).host
  const wsOrigin = `${origin.startsWith("https:") ? "wss" : "ws"}://${host}`
  headers.set(
    "Content-Security-Policy",
    [
      "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
      "default-src 'self' data: blob: https:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      // Data only goes back to this app: no fetches to other hosts.
      `connect-src 'self' ${origin} ${wsOrigin}`,
      `frame-ancestors 'self' ${origin}`,
    ].join("; ")
  )
  // The page runs in an opaque origin, so its own requests are cross-origin.
  headers.set("Access-Control-Allow-Origin", "*")
  // The link token is in the URL: never leak it to CDNs or other sites.
  headers.set("Referrer-Policy", "no-referrer")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Cache-Control", "private, no-store")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** Called from the Worker entry before TanStack Start. Null: not an app URL. */
export async function handleAppRequest(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/apps/")) return null
  const [, , rawUser, botId, slug, token, ...rest] = url.pathname.split("/")
  if (!rawUser || !botId || !slug || !token) return notFound()
  // Relative URLs in the app only work under a trailing slash.
  if (rest.length === 0) {
    return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301)
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    })
  }

  let userId: string
  let path: string
  try {
    userId = decodeURIComponent(rawUser)
    path = rest.map(decodeURIComponent).join("/")
  } catch {
    return notFound()
  }
  const hub = await getAgentByName(
    env.UserHub as unknown as DurableObjectNamespace<UserHub>,
    userId
  )
  // Looking up an unknown bot would create an empty Durable Object.
  if (!(await hub.hasBot(botId))) return notFound()

  const bot = await botStub(env, userId, botId)
  const candidate = await bot.appLink(slug, token)
  if (!candidate) return notFound()
  let viewer: { id: string; email: string | null } | null = null
  if (candidate.audience === "owner" || candidate.audience === "email") {
    if (!accessConfigured() && !import.meta.env.DEV) {
      return new Response("Private apps require configured sign-in.", {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      })
    }
    try {
      viewer = await identify(request)
    } catch (err) {
      if (!(err instanceof Unauthorized)) throw err
    }
    if (!viewer)
      return new Response(
        "Sign in to Coworkers before opening this private app.",
        { status: 401, headers: { "Cache-Control": "no-store" } }
      )
  }
  const access = await bot.authorizeAppLink(slug, token, viewer)
  if (!access) return notFound()
  if (access.token !== token) {
    // An opaque-origin app cannot send the UI's login cookies. Bootstrap a
    // short-lived, app-scoped capability only after checking the identity.
    const next = new URL(
      access.path + rest.map(encodeURIComponent).join("/"),
      url.origin
    )
    next.search = url.search
    return new Response(null, {
      status: 302,
      headers: {
        Location: next.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    })
  }

  // `_bdots.js` and `window.bdots`: apps published before the rename.
  if (path === "_coworkers.js" || path === "_bdots.js") {
    return withAppHeaders(
      new Response(CLIENT_JS, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      }),
      url.origin
    )
  }

  if (path === "_live") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 })
    }
    const link = await bot.appLink(slug, token)
    if (!link) return notFound()
    const live = env.AppLive.getByName(appLiveName(userId, botId, slug))
    const headers = new Headers(request.headers)
    headers.set("X-Coworkers-Link", token)
    headers.set("X-Coworkers-Expires", String(access.expiresAt ?? 0))
    headers.set("X-Coworkers-User", userId)
    headers.set("X-Coworkers-Bot", botId)
    headers.set("X-Coworkers-App", slug)
    return live.fetch(new Request(request, { headers }))
  }

  const response = await bot.serveApp(slug, token, path, request)
  return withAppHeaders(response, url.origin)
}

/**
 * Fan-out for open copies of one app. A separate object from the bot, so
 * people on a share link never join the bot's own socket (which carries
 * its chat and state).
 */
export class AppLive extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    )
  }

  override async fetch(request: Request) {
    const token = request.headers.get("X-Coworkers-Link") ?? ""
    const expiresAt = Number(request.headers.get("X-Coworkers-Expires")) || 0
    const userId = request.headers.get("X-Coworkers-User") ?? ""
    const botId = request.headers.get("X-Coworkers-Bot") ?? ""
    const slug = request.headers.get("X-Coworkers-App") ?? ""
    if (!userId || !botId || !slug || !token) return notFound()
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server, [token])
    server.serializeAttachment({ expiresAt, userId, botId, slug, token })
    // Accept first, then recheck: revocation racing the upgrade either sees
    // this socket in disconnect(), or this recheck closes it.
    if (
      !(await (
        await botStub(this.env, userId, botId)
      ).authorizeAppLink(slug, token, null))
    ) {
      server.close(4001, "Access revoked")
    }
    if (expiresAt) {
      const alarm = await this.ctx.storage.getAlarm()
      if (!alarm || alarm > expiresAt)
        await this.ctx.storage.setAlarm(expiresAt)
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  override async alarm() {
    let next = Infinity
    for (const ws of this.ctx.getWebSockets()) {
      const { expiresAt } = (ws.deserializeAttachment() ?? {}) as {
        expiresAt?: number
      }
      if (!expiresAt) continue
      if (expiresAt <= Date.now())
        ws.close(4001, "Session expired; reopen the private app")
      else next = Math.min(next, expiresAt)
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next)
  }

  async broadcast(message: AppLiveMessage) {
    const data = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment() as {
          userId?: string
          botId?: string
          slug?: string
          token?: string
        } | null
        if (
          !attachment?.userId ||
          !attachment.botId ||
          !attachment.slug ||
          !attachment.token ||
          !(await (
            await botStub(this.env, attachment.userId, attachment.botId)
          ).authorizeAppLink(attachment.slug, attachment.token, null))
        ) {
          ws.close(4001, "Access revoked")
          continue
        }
        ws.send(data)
      } catch {
        // Already closing.
      }
    }
  }

  /** Drop viewers of a revoked link, or everyone when the app is deleted. */
  disconnect(token?: string) {
    for (const ws of this.ctx.getWebSockets(token)) {
      try {
        ws.close(4001, token ? "Link revoked" : "App deleted")
      } catch {
        // Already closed.
      }
    }
  }

  override webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code)
    } catch {
      // Already closed.
    }
  }
}

interface AppBindingProps {
  userId: string
  botId: string
  slug: string
  caller: AppCaller
}

/**
 * `env.BOT` inside an app's server.js. Scoped by props to one app and to
 * the link the request came in on; it cannot reach anything else.
 */
export class AppBinding extends WorkerEntrypoint<Env, AppBindingProps> {
  private async call(op: AppDataOp) {
    const { userId, botId, slug, caller } = this.ctx.props
    const bot = await botStub(this.env, userId, botId)
    // RPC typing turns `unknown` into `never`; this is the method's real shape.
    const result = (await bot.appData(
      slug,
      { ...caller, server: true },
      op
    )) as { value: unknown } | { error: string }
    if ("error" in result) throw new Error(result.error)
    return result.value
  }

  /** Who opened the app: the link's label and whether it may edit. */
  caller() {
    return publicCaller(this.ctx.props.caller)
  }

  info() {
    return this.call({ op: "info" })
  }

  list(collection: string) {
    return this.call({ op: "list", collection })
  }

  get(collection: string, id: string) {
    return this.call({ op: "get", collection, id })
  }

  put(collection: string, item: Record<string, unknown>) {
    return this.call({ op: "put", collection, item })
  }

  update(collection: string, id: string, patch: Record<string, unknown>) {
    return this.call({
      op: "put",
      collection,
      item: { ...patch, id },
      merge: true,
    })
  }

  remove(collection: string, id: string) {
    return this.call({ op: "remove", collection, id })
  }

  tell(text: string) {
    return this.call({ op: "tell", text })
  }

  /**
   * Call a tool on the user's connected apps, live. Only tools the app
   * asked for on save_app and the user allowed. Throws if not allowed,
   * rate limited, or if the app fails.
   */
  async tool(name: string, args: Record<string, unknown> = {}) {
    const { userId, botId, slug, caller } = this.ctx.props
    const bot = await botStub(this.env, userId, botId)
    const result = (await bot.appTool(slug, caller, name, args)) as
      { value: unknown } | { error: string }
    if ("error" in result) throw new Error(result.error)
    return result.value
  }

  /** The app tools this app asked for, and whether each is allowed. */
  async tools() {
    const { userId, botId, slug, caller } = this.ctx.props
    const bot = await botStub(this.env, userId, botId)
    return bot.appToolList(slug, caller)
  }
}

export const MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
  woff2: "font/woff2",
}

/** window.coworkers, served at `_coworkers.js` next to every app. */
const CLIENT_JS = `(() => {
  const script = document.currentScript;
  const root = new URL("./", script ? script.src : location.href);
  const at = (path) => new URL(path, root).toString();
  const enc = encodeURIComponent;

  async function request(method, path, body) {
    const res = await fetch(at(path), {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  // Page errors go back to the bot, which fixes the app and republishes.
  const reported = new Set();
  const versionMeta = document.querySelector('meta[name="coworkers-version"], meta[name="bdots-version"]');
  const version = versionMeta ? Number(versionMeta.content) : undefined;
  function report(err, source) {
    const message = String((err && err.message) || err || "Unknown error").slice(0, 500);
    if (reported.has(message) || reported.size >= 5) return;
    reported.add(message);
    fetch(at("_error"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        stack: String((err && err.stack) || "").slice(0, 2000),
        source,
        version: version,
      }),
    }).catch(() => {});
  }
  addEventListener("error", (event) =>
    report(event.error || event.message, event.filename ? event.filename.split("/").pop() + ":" + event.lineno : "page"));
  addEventListener("unhandledrejection", (event) => report(event.reason, "promise"));

  const listeners = new Map();
  const watchers = new Map();
  let socket = null;
  let attempts = 0;
  let pinger = 0;

  async function refreshWatched(collection) {
    for (const [key, set] of watchers) {
      const [c, id] = JSON.parse(key);
      if (c !== collection || set.size === 0) continue;
      try {
        const item = await coworkers.get(c, id).catch((err) => {
          if (String(err && err.message) === "Not found") return null;
          throw err;
        });
        for (const fn of set) fn(item);
      } catch (err) {
        console.error("coworkers: watch failed", err);
      }
    }
  }

  async function refresh(collection) {
    refreshWatched(collection);
    const set = listeners.get(collection);
    if (!set || set.size === 0) return;
    try {
      const items = await coworkers.list(collection);
      for (const fn of set) fn(items);
    } catch (err) {
      console.error("coworkers: refresh failed", err);
      report(err, "subscribe(\\"" + collection + "\\") callback");
    }
  }

  function connect() {
    const url = new URL("_live", root);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onopen = () => {
      if (attempts > 0) {
        const seen = new Set(listeners.keys());
        for (const key of watchers.keys()) seen.add(JSON.parse(key)[0]);
        for (const c of seen) refresh(c);
      }
      attempts = 0;
      clearInterval(pinger);
      pinger = setInterval(() => socket.readyState === 1 && socket.send("ping"), 30000);
    };
    socket.onmessage = (event) => {
      if (event.data === "pong") return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "reload") location.reload();
      if (message.type === "change") refresh(message.collection);
    };
    socket.onclose = (event) => {
      clearInterval(pinger);
      if (event.code === 4001) return;
      setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts++));
    };
  }

  const coworkers = {
    /** { app, collections, caller: { label, mode }, form? } */
    info: () => request("GET", "_data"),
    list: (collection) =>
      request("GET", "_data/" + enc(collection)).then((r) => r.items),
    get: (collection, id) =>
      request("GET", "_data/" + enc(collection) + "/" + enc(id)).then((r) => r.item),
    /** Insert or replace. Without an id, one is generated. */
    put: (collection, item) =>
      (item && item.id
        ? request("PUT", "_data/" + enc(collection) + "/" + enc(item.id), item)
        : request("POST", "_data/" + enc(collection), item || {})
      ).then((r) => r.item),
    /** Change some fields of an existing item. */
    update: (collection, id, patch) =>
      request("PATCH", "_data/" + enc(collection) + "/" + enc(id), patch).then((r) => r.item),
    remove: (collection, id) =>
      request("DELETE", "_data/" + enc(collection) + "/" + enc(id)),
    /** Send the bot a message. It answers in its own thread, not here. */
    tell: (text) => request("POST", "_tell", { text }),
    /**
     * Add a new item, e.g. a form response. Works on public (submit) links.
     * Resolves to the saved item; keep its id to read it back with watch().
     */
    submit: (collection, item) => {
      const { id: _id, ...fields } = item || {};
      return request("POST", "_data/" + enc(collection), fields).then((r) => r.item);
    },
    /** Call fn(item or null) now and whenever that one item may have changed. Returns unsubscribe. */
    watch(collection, id, fn) {
      const key = JSON.stringify([collection, id]);
      if (!watchers.has(key)) watchers.set(key, new Set());
      watchers.get(key).add(fn);
      refreshWatched(collection);
      return () => watchers.get(key).delete(fn);
    },
    /** Call fn(items) now and whenever the collection changes. Returns unsubscribe. */
    subscribe(collection, fn) {
      if (!listeners.has(collection)) listeners.set(collection, new Set());
      listeners.get(collection).add(fn);
      refresh(collection);
      return () => listeners.get(collection).delete(fn);
    },
  };

  window.coworkers = window.bdots = coworkers;
  connect();
})();
`
