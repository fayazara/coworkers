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
  "Google" | "Search and web" | "Productivity" | "Developer tools"

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  "Google",
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
   * - "google": the user's own Google OAuth client, set up once for every
   *   Google server (Google has no dynamic client registration).
   */
  auth: "none" | "oauth" | "key" | "google"
  /** OAuth scopes to ask for, when the server does not advertise its own. */
  scopes?: string[]
  /** For "key", or an optional key that lifts a free tier's limits. */
  key?: {
    header: string
    /** Put before the key, e.g. "Bearer ". */
    prefix?: string
    /** Where the user creates a key. */
    getKey: string
  }
}

const G = "https://www.googleapis.com/auth/"
const GOOGLE_DOCS =
  "https://developers.google.com/workspace/guides/configure-mcp-servers"

export const INTEGRATIONS: Integration[] = [
  // Google's own Workspace MCP servers (Developer Preview).
  {
    id: "gmail",
    name: "Gmail",
    description: "Search and read mail, and write drafts.",
    category: "Google",
    site: "mail.google.com",
    icon: "https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png",
    docs: GOOGLE_DOCS,
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    auth: "google",
    scopes: [`${G}gmail.readonly`, `${G}gmail.compose`],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "See your calendars, events and when you are free.",
    category: "Google",
    site: "calendar.google.com",
    icon: "https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png",
    docs: GOOGLE_DOCS,
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    auth: "google",
    scopes: [
      `${G}calendar.calendarlist.readonly`,
      `${G}calendar.events.freebusy`,
      `${G}calendar.events.readonly`,
    ],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Find, read and upload files.",
    category: "Google",
    site: "drive.google.com",
    icon: "https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
    docs: GOOGLE_DOCS,
    url: "https://drivemcp.googleapis.com/mcp/v1",
    auth: "google",
    scopes: [`${G}drive.readonly`, `${G}drive.file`],
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Read and write documents.",
    category: "Google",
    site: "docs.google.com",
    icon: "https://www.gstatic.com/images/branding/product/2x/docs_2020q4_48dp.png",
    docs: GOOGLE_DOCS,
    url: "https://docsmcp.googleapis.com/mcp/v1",
    auth: "google",
    scopes: [
      `${G}drive.readonly`,
      `${G}drive.file`,
      `${G}documents.readonly`,
      `${G}documents`,
    ],
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read and update spreadsheets.",
    category: "Google",
    site: "sheets.google.com",
    icon: "https://www.gstatic.com/images/branding/product/2x/sheets_2020q4_48dp.png",
    docs: GOOGLE_DOCS,
    url: "https://sheetsmcp.googleapis.com/mcp/v1",
    auth: "google",
    scopes: [
      `${G}drive.readonly`,
      `${G}drive.file`,
      `${G}spreadsheets.readonly`,
      `${G}spreadsheets`,
    ],
  },
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

/** A Google Workspace MCP server, which signs in with the user's own client. */
export function isGoogleServer(url: string) {
  try {
    return new URL(url).hostname.endsWith(".googleapis.com")
  } catch {
    return false
  }
}

/** The one-time Google Cloud setup, for the guided page in Settings. */
export const GOOGLE_SETUP = {
  preview: "https://developers.google.com/workspace/preview",
  newProject: "https://console.cloud.google.com/projectcreate",
  apiLibrary: "https://console.cloud.google.com/apis/library",
  audience: "https://console.cloud.google.com/auth/audience",
  newClient: "https://console.cloud.google.com/auth/clients/create",
  docs: GOOGLE_DOCS,
  /** Both the API and its MCP service, for every server in the catalog. */
  enable: [
    "gmail.googleapis.com",
    "gmailmcp.googleapis.com",
    "calendar-json.googleapis.com",
    "calendarmcp.googleapis.com",
    "drive.googleapis.com",
    "drivemcp.googleapis.com",
    "docs.googleapis.com",
    "docsmcp.googleapis.com",
    "sheets.googleapis.com",
    "sheetsmcp.googleapis.com",
  ],
}

/** What a client ID from Google Cloud looks like. */
export const GOOGLE_CLIENT_ID = /^[\w-]+\.apps\.googleusercontent\.com$/

/** The scopes to ask Google for when connecting a server. */
export function googleScopesFor(url: string): string[] {
  return INTEGRATIONS.find((i) => sameEndpoint(i.url, url))?.scopes ?? []
}
