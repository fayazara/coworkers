import { DurableObjectOAuthClientProvider } from "agents/mcp/do-oauth-client-provider"

/** Sent until Google has signed the user in; never a real credential. */
const SIGN_IN_NEEDED = "coworkers-sign-in-needed"

/** The user's own Google OAuth client, as stored on the hub. */
export interface GoogleClient {
  clientId: string
  clientSecret: string
}

/**
 * The hub's MCP OAuth provider. Most servers register a client by
 * themselves (dynamic client registration); Google's Workspace servers do
 * not, so for them this hands over the client the user created in Google
 * Cloud, and asks Google for a refresh token, without which a sign-in lasts
 * an hour.
 */
export class HubOAuthProvider extends DurableObjectOAuthClientProvider {
  constructor(
    storage: DurableObjectStorage,
    clientName: string,
    redirectUrl: string,
    /** Google's client and scopes for this server, or null for any other. */
    private readonly google: (
      serverId: string
    ) => { client: GoogleClient; scopes: string[] } | null
  ) {
    super(storage, clientName, redirectUrl)
  }

  private preset() {
    let serverId: string
    try {
      serverId = this.serverId
    } catch {
      return null
    }
    const found = this.google(serverId)
    // Tokens and verifiers are kept under the client id, so set it first.
    if (found) this.clientId = found.client.clientId
    return found
  }

  get clientMetadata() {
    const metadata = super.clientMetadata
    const found = this.preset()
    return found
      ? {
          ...metadata,
          token_endpoint_auth_method: "client_secret_post",
          scope: found.scopes.join(" "),
        }
      : metadata
  }

  async clientInformation(
    context?: Parameters<
      DurableObjectOAuthClientProvider["clientInformation"]
    >[0]
  ) {
    const found = this.preset()
    if (!found) return super.clientInformation(context)
    // What the SDK saved for this client (its issuer) on top of the user's.
    const saved = await super.clientInformation(context)
    return {
      ...saved,
      client_id: found.client.clientId,
      client_secret: found.client.clientSecret,
      token_endpoint_auth_method: "client_secret_post",
    }
  }

  async tokens(
    context?: Parameters<DurableObjectOAuthClientProvider["tokens"]>[0]
  ) {
    const found = this.preset()
    const saved = await super.tokens(context)
    // Google answers the handshake and even lists tools without a sign-in,
    // so the SDK would never ask for one and the first real call would
    // fail. A placeholder token makes Google say 401, and the SDK starts the
    // sign-in like for any other server.
    if (found && !saved) {
      return { access_token: SIGN_IN_NEEDED, token_type: "Bearer" }
    }
    return saved
  }

  async redirectToAuthorization(authUrl: URL) {
    if (this.preset()) {
      // A refresh token, every time: Google sends one only on fresh consent.
      authUrl.searchParams.set("access_type", "offline")
      authUrl.searchParams.set("prompt", "consent")
      // Google advertises every scope it has (full mail access among them);
      // ask only for the ones the catalog lists for this server.
      const { scopes } = this.google(this.serverId)!
      if (scopes.length) authUrl.searchParams.set("scope", scopes.join(" "))
    }
    return super.redirectToAuthorization(authUrl)
  }
}
