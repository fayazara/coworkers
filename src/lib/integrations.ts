import { sameEndpoint } from "@/lib/choices"

/**
 * The integrations catalog: MCP servers the maintainers have checked, shown
 * under Settings → Integrations and offered by bots through connect_app.
 *
 * To add one, open a PR with a single entry below. Only list a provider's own
 * remote MCP endpoint, taken from its docs, and link those docs in `docs`.
 * Each entry is plain data so this list can later move to a registry file
 * without changing its shape.
 */

export type IntegrationCategory =
  "Search and web" | "Productivity" | "Developer tools"

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  "Search and web",
  "Productivity",
  "Developer tools",
]

export interface Integration {
  /** Stable slug, e.g. "firecrawl". */
  id: string
  name: string
  /** One line on what bots can do with it. */
  description: string
  category: IntegrationCategory
  /** Domain for the icon, e.g. "firecrawl.dev". */
  site: string
  /** The product's own logo, when the site's favicon is a parent brand's. */
  icon?: string
  /** The provider's MCP setup docs. */
  docs: string
  /** Its remote MCP endpoint (Streamable HTTP). */
  url: string
  /**
   * How the user gets in:
   * - "none": works on one click, often on a free tier.
   * - "oauth": one click, then the provider's own sign-in.
   * - "key": needs an API key, sent as a header from the hub.
   */
  auth: "none" | "oauth" | "key"
  /** For "key", or an optional key that lifts a free tier's limits. */
  key?: {
    header: string
    /** Put before the key, e.g. "Bearer ". */
    prefix?: string
    /** Where the user creates a key. */
    getKey: string
  }
}

export const INTEGRATIONS: Integration[] = [
  {
    id: "parallel",
    name: "Parallel",
    description: "Search the web and read pages. Free at lower rate limits.",
    category: "Search and web",
    site: "parallel.ai",
    docs: "https://docs.parallel.ai/integrations/mcp/quickstart",
    url: "https://mcp.parallel.ai/mcp",
    auth: "none",
    key: {
      header: "Authorization",
      prefix: "Bearer ",
      getKey: "https://platform.parallel.ai",
    },
  },
  {
    id: "exa",
    name: "Exa",
    description: "Search the web and fetch pages. Free at lower rate limits.",
    category: "Search and web",
    site: "exa.ai",
    docs: "https://docs.exa.ai/reference/exa-mcp",
    url: "https://mcp.exa.ai/mcp",
    auth: "none",
    key: { header: "x-api-key", getKey: "https://dashboard.exa.ai/api-keys" },
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "Search, scrape and crawl sites into clean Markdown.",
    category: "Search and web",
    site: "firecrawl.dev",
    docs: "https://docs.firecrawl.dev/mcp-server",
    url: "https://mcp.firecrawl.dev/v2/mcp",
    auth: "key",
    key: {
      header: "Authorization",
      prefix: "Bearer ",
      getKey: "https://www.firecrawl.dev/app/api-keys",
    },
  },
  {
    id: "tavily",
    name: "Tavily",
    description: "Search the web, extract pages and map sites.",
    category: "Search and web",
    site: "tavily.com",
    docs: "https://docs.tavily.com/documentation/mcp",
    url: "https://mcp.tavily.com/mcp/",
    auth: "key",
    key: {
      header: "Authorization",
      prefix: "Bearer ",
      getKey: "https://app.tavily.com",
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Search, create and update issues and projects.",
    category: "Productivity",
    site: "linear.app",
    docs: "https://linear.app/docs/mcp",
    url: "https://mcp.linear.app/mcp",
    auth: "oauth",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search, read and write pages and databases.",
    category: "Productivity",
    site: "notion.com",
    docs: "https://developers.notion.com/docs/mcp",
    url: "https://mcp.notion.com/mcp",
    auth: "oauth",
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Look up issues, errors and releases.",
    category: "Developer tools",
    site: "sentry.io",
    docs: "https://docs.sentry.io/product/sentry-mcp/",
    url: "https://mcp.sentry.dev/mcp",
    auth: "oauth",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description:
      "Work with your Cloudflare account: Workers, DNS, R2, D1 and the rest of the API.",
    category: "Developer tools",
    site: "cloudflare.com",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
    url: "https://mcp.cloudflare.com/mcp",
    auth: "oauth",
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    description: "Search Cloudflare's developer documentation.",
    category: "Developer tools",
    site: "cloudflare.com",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
    url: "https://docs.mcp.cloudflare.com/mcp",
    auth: "none",
  },
]

/** The catalog entry a connection was made from, matched by endpoint. */
export function integrationFor(url: string): Integration | undefined {
  return INTEGRATIONS.find((i) => sameEndpoint(i.url, url))
}

/** The header that carries a user's key for an integration. */
export function integrationHeaders(
  integration: Integration,
  key: string
): Record<string, string> {
  const k = key.trim()
  if (!integration.key || !k) return {}
  return { [integration.key.header]: `${integration.key.prefix ?? ""}${k}` }
}
