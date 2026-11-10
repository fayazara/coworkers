import { describe, expect, it } from "vitest"
import { HubOAuthProvider } from "./google-oauth"

/** DurableObjectStorage, as far as the OAuth provider uses it. */
function memoryStorage() {
  const map = new Map<string, unknown>()
  return {
    get: async (key: string) => map.get(key),
    put: async (key: string, value: unknown) => void map.set(key, value),
    delete: async (keys: string | string[]) => {
      for (const k of [keys].flat()) map.delete(k)
    },
    list: async () => new Map(),
  } as unknown as DurableObjectStorage
}

const client = {
  clientId: "123-abc.apps.googleusercontent.com",
  clientSecret: "secret",
}
const scopes = ["https://www.googleapis.com/auth/gmail.readonly"]

function provider(google: boolean) {
  const p = new HubOAuthProvider(
    memoryStorage(),
    "hub",
    "https://coworkers.example/agents/user-hub/me/callback",
    () => (google ? { client, scopes } : null)
  )
  p.serverId = "cgmail"
  return p
}

describe("HubOAuthProvider", () => {
  it("hands Google servers the user's own client", async () => {
    expect(await provider(true).clientInformation()).toMatchObject({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token_endpoint_auth_method: "client_secret_post",
    })
  })

  it("leaves other servers to register their own client", async () => {
    expect(await provider(false).clientInformation()).toBeUndefined()
    expect(await provider(false).tokens()).toBeUndefined()
  })

  it("sends a placeholder token until Google signs the user in", async () => {
    const p = provider(true)
    expect((await p.tokens())?.access_token).toBe("coworkers-sign-in-needed")
    await p.saveTokens({ access_token: "real", token_type: "Bearer" })
    expect((await p.tokens())?.access_token).toBe("real")
  })

  it("asks Google for a refresh token and only the catalog's scopes", async () => {
    const p = provider(true)
    const url = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth?scope=https://mail.google.com/"
    )
    await p.redirectToAuthorization(url)
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("prompt")).toBe("consent")
    expect(url.searchParams.get("scope")).toBe(scopes.join(" "))
  })
})
