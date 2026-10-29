/** Public web search through the deployment's Cloudflare AI Gateway. */
import { tool } from "ai"
import type { ToolSet } from "ai"
import { z } from "zod"
import { MAX_TOOL_RESULT_CHARS } from "./guards"

interface SearchToolsOptions {
  apiKey?: string
  gatewayToken?: string
  /** The existing AI binding supplies this deployment's Parallel proxy URL. */
  gatewayUrl(): Promise<string>
  /** Save long results under /workspace, like the existing web read tools. */
  save(path: string, content: string): Promise<string>
}

const searchInput = z.object({
  objective: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      "One self-contained research goal, with any source or date preferences"
    ),
  search_queries: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(5)
    .describe("Concise keyword queries, 3-6 words each. Prefer 2-3 queries."),
  max_results: z.number().int().min(1).max(10).optional(),
})

const searchResponse = z.object({
  search_id: z.string(),
  session_id: z.string(),
  results: z.array(
    z.object({
      url: z.string().url(),
      title: z.string().nullish(),
      publish_date: z.string().nullish(),
      excerpts: z.array(z.string()),
    })
  ),
  warnings: z
    .array(
      z.object({
        type: z.string(),
        message: z.string(),
        detail: z.record(z.string(), z.unknown()).nullish(),
      })
    )
    .nullish(),
})

/** No search tool or credential-bearing state when search is not configured. */
export function createSearchTools(options: SearchToolsOptions): ToolSet {
  const apiKey = options.apiKey?.trim()
  const gatewayToken = options.gatewayToken?.trim()
  if (!apiKey || !gatewayToken) return {}

  async function bounded(data: z.infer<typeof searchResponse>) {
    if (JSON.stringify(data).length <= MAX_TOOL_RESULT_CHARS) return data
    let savedTo: string
    try {
      savedTo = await options.save(
        `downloads/search/${crypto.randomUUID()}.json`,
        JSON.stringify(data, null, 2)
      )
    } catch {
      return {
        error:
          "Web search returned a long result that could not be saved. Try fewer results.",
      }
    }
    const location = {
      savedTo,
      truncated: true,
      note: "The full search result is saved in this file. Use read or grep for the complete excerpts and source details instead of searching again.",
    }
    const preview = {
      ...location,
      ...data,
      results: data.results.map((result) => ({
        ...result,
        excerpts: result.excerpts.slice(0, 1).map((text) => text.slice(0, 400)),
      })),
    }
    if (JSON.stringify(preview).length <= MAX_TOOL_RESULT_CHARS) return preview
    // Even unusually large source metadata remains recoverable from the file.
    return { ...location, result_count: data.results.length }
  }

  return {
    web_search: tool({
      description:
        "Search the public web for current facts or sources. Returns ranked source URLs, titles, dates and relevant excerpts. Cite the sources that support your answer. Use browser_markdown to read a source further; use connected apps for private data.",
      inputSchema: searchInput,
      execute: async (input, { abortSignal }) => {
        const timeout = AbortSignal.timeout(30_000)
        const signal = abortSignal
          ? AbortSignal.any([abortSignal, timeout])
          : timeout
        try {
          signal.throwIfAborted()
          const base = await options.gatewayUrl()
          const response = await fetch(
            `${base.replace(/\/+$/, "")}/v1/search`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "cf-aig-authorization": `Bearer ${gatewayToken}`,
                // Search results should reflect the query's current context.
                "cf-aig-skip-cache": "true",
              },
              body: JSON.stringify({
                objective: input.objective,
                search_queries: input.search_queries,
                mode: "fast",
                max_chars_total: 20_000,
                advanced_settings: { max_results: input.max_results ?? 5 },
              }),
              redirect: "error",
              signal,
            }
          )
          if (!response.ok) {
            const next =
              response.status === 401 || response.status === 403
                ? "Check the Parallel key and AI Gateway token in deployment secrets."
                : response.status === 429
                  ? "The search rate limit was reached. Try later."
                  : "Try another source."
            // Upstream error bodies can include request headers or credentials.
            return {
              error: `Web search returned HTTP ${response.status}. ${next}`,
            }
          }
          const body: unknown = await response.json().catch(() => null)
          signal.throwIfAborted()
          const parsed = searchResponse.safeParse(body)
          if (!parsed.success) {
            return {
              error:
                "Web search returned an invalid response. Try another source.",
            }
          }
          return await bounded(parsed.data)
        } catch {
          return {
            error: signal.aborted
              ? "Web search was cancelled or timed out."
              : "Web search could not reach AI Gateway. Try another source.",
          }
        }
      },
    }),
  }
}
