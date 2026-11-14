import { getAgentByName, routeAgentRequest } from "agents"
import { authorizeUrl, exchangeCode, pkceChallenge, randomToken } from "./oauth"
import { cookie, readCookie, sign, unsign } from "./session"
import type { Installer } from "./installer"
import { isDemo } from "./shared"

export { Installer } from "./installer"

/** Names this browser's Installer instance. */
const SESSION = "bdi_session"
/** PKCE verifier and state, for the few minutes a sign-in takes. */
const PENDING = "bdi_oauth"

const DAY = 24 * 60 * 60

function installer(env: Env, id: string) {
  return getAgentByName(
    env.Installer as unknown as DurableObjectNamespace<Installer>,
    id
  )
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location })
  for (const c of cookies) headers.append("Set-Cookie", c)
  return new Response(null, { status: 302, headers })
}

async function sessionId(request: Request, env: Env) {
  const signed = readCookie(request, SESSION)
  return signed ? unsign(env.SESSION_SECRET, signed) : null
}

function configured(env: Env) {
  return (
    isDemo(env) || (!!env.CF_OAUTH_CLIENT_ID && !!env.CF_OAUTH_CLIENT_SECRET)
  )
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!env.SESSION_SECRET) {
      return new Response("Set SESSION_SECRET (see installer/README.md).", {
        status: 500,
      })
    }

    // Which installer this browser has, if any. The page asks first.
    if (url.pathname === "/api/session") {
      const id = await sessionId(request, env)
      const signedIn = id ? await (await installer(env, id)).signedIn() : false
      return Response.json({
        id: signedIn ? id : null,
        configured: configured(env),
      })
    }

    if (url.pathname === "/api/auth/login") {
      const redirectUri = `${url.origin}/api/auth/callback`
      if (isDemo(env)) return redirect(`${redirectUri}?demo=1`)
      if (!configured(env)) {
        return new Response(
          "Set CF_OAUTH_CLIENT_ID and CF_OAUTH_CLIENT_SECRET.",
          {
            status: 500,
          }
        )
      }
      const state = randomToken(16)
      const verifier = randomToken(32)
      return redirect(
        authorizeUrl({
          clientId: env.CF_OAUTH_CLIENT_ID,
          redirectUri,
          state,
          challenge: await pkceChallenge(verifier),
        }),
        [
          cookie(
            PENDING,
            await sign(env.SESSION_SECRET, `${state}.${verifier}`),
            {
              maxAge: 600,
              path: "/api/auth",
            }
          ),
        ]
      )
    }

    if (url.pathname === "/api/auth/callback") {
      const id = (await sessionId(request, env)) ?? crypto.randomUUID()
      const stub = await installer(env, id)
      if (isDemo(env)) {
        await stub.signIn(null)
      } else {
        const error = url.searchParams.get("error")
        if (error) {
          const detail = url.searchParams.get("error_description")
          const query = new URLSearchParams({ error })
          if (detail) query.set("detail", detail)
          return redirect(`/?${query}`)
        }
        const pending = readCookie(request, PENDING)
        const value = pending ? await unsign(env.SESSION_SECRET, pending) : null
        const [state, verifier] = value?.split(".") ?? []
        if (!state || !verifier || state !== url.searchParams.get("state")) {
          return redirect("/?error=sign_in_expired")
        }
        try {
          const tokens = await exchangeCode(
            { id: env.CF_OAUTH_CLIENT_ID, secret: env.CF_OAUTH_CLIENT_SECRET },
            {
              code: url.searchParams.get("code") ?? "",
              verifier,
              redirectUri: `${url.origin}/api/auth/callback`,
            }
          )
          await stub.signIn(tokens)
        } catch (err) {
          console.error("Sign-in failed", err)
          return redirect("/?error=sign_in_failed")
        }
      }
      return redirect("/", [
        cookie(SESSION, await sign(env.SESSION_SECRET, id), {
          maxAge: 7 * DAY,
        }),
        cookie(PENDING, "", { maxAge: 0, path: "/api/auth" }),
      ])
    }

    if (url.pathname === "/api/auth/logout") {
      // Clearing the cookie alone would leave the OAuth tokens stored.
      const id = await sessionId(request, env)
      if (id) await (await installer(env, id)).signOut()
      return redirect("/", [cookie(SESSION, "", { maxAge: 0 })])
    }

    // The page's WebSocket: only to the installer this browser signed in to.
    if (url.pathname.startsWith("/agents/")) {
      const [, , agent, instance] = url.pathname.split("/")
      const id = await sessionId(request, env)
      if (
        agent !== "installer" ||
        !id ||
        decodeURIComponent(instance ?? "") !== id
      ) {
        return new Response("Forbidden", { status: 403 })
      }
      return (
        (await routeAgentRequest(request, env)) ??
        new Response("Not found", { status: 404 })
      )
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
