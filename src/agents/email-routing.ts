/**
 * Email Routing rules for bot addresses. Cloudflare has no catch-all for a
 * subdomain, so each bot that turns email on gets its own rule that sends
 * `<name>@EMAIL_DOMAIN` to this Worker, and loses it when email goes off.
 *
 * Needs EMAIL_ZONE_ID (the zone that owns the domain) and an
 * EMAIL_ROUTING_API_TOKEN with "Email Routing Rules: Edit" on that zone.
 * Without them nothing is managed: set up a catch-all rule yourself.
 */

export function routingManaged(env: Env) {
  return Boolean(env.EMAIL_ZONE_ID?.trim() && env.EMAIL_ROUTING_API_TOKEN)
}

async function call(env: Env, method: string, path: string, body?: unknown) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.EMAIL_ZONE_ID.trim()}/email/routing/rules${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${env.EMAIL_ROUTING_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  )
  const json = (await res.json().catch(() => null)) as {
    success?: boolean
    errors?: { message: string }[]
    result?: { id?: string }
  } | null
  if (!res.ok || !json?.success) {
    const why = json?.errors?.map((e) => e.message).join("; ")
    throw new Error(`Email Routing: ${why || `HTTP ${res.status}`}`)
  }
  return json.result
}

/** Route `address` to this Worker. Returns the rule id. */
export async function createRoutingRule(env: Env, address: string) {
  const result = await call(env, "POST", "", {
    name: `Coworkers: ${address}`,
    enabled: true,
    matchers: [{ type: "literal", field: "to", value: address }],
    actions: [{ type: "worker", value: [env.WORKER_NAME] }],
  })
  if (!result?.id) throw new Error("Email Routing: no rule id returned")
  return result.id
}

export async function deleteRoutingRule(env: Env, ruleId: string) {
  try {
    await call(env, "DELETE", `/${ruleId}`)
  } catch (err) {
    // Already gone (deleted by hand) is fine.
    if (!String(err).includes("HTTP 404")) throw err
  }
}
