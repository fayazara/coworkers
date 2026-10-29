import { asSchema } from "ai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createSearchTools } from "./search-tools"
import { MAX_TOOL_RESULT_CHARS, shapeToolResults } from "./guards"
import type { ModelMessage } from "ai"

const options = {
  apiKey: "parallel-test-key",
  gatewayToken: "cloudflare-test-token",
  gatewayUrl: async () =>
    "https://gateway.ai.cloudflare.com/v1/account/coworkers/parallel",
  save: async (path: string, _content: string) => `/workspace/${path}`,
}
const input = {
  objective: "Find recent Cloudflare product releases",
  search_queries: ["Cloudflare product releases", "Cloudflare AI Gateway news"],
}
const response = {
  search_id: "search_test",
  session_id: "session_test",
  results: [
    {
      url: "https://developers.cloudflare.com/changelog/",
      title: "Cloudflare changelog",
      publish_date: "2026-10-28",
      excerpts: ["New tools for developers."],
    },
    {
      url: "https://example.com/",
      title: null,
      publish_date: null,
      excerpts: ["Another source."],
    },
  ],
  warnings: [
    {
      type: "warning",
      message: "Some sources were unavailable.",
      detail: { unavailable_urls: 1 },
    },
  ],
  usage: [{ name: "sku_search", count: 1 }],
}

function search() {
  const tool = createSearchTools(options).web_search
  if (!tool?.execute) throw new Error("Search is unavailable")
  return tool
}

async function execute(abortSignal?: AbortSignal) {
  return search().execute!(input, {
    toolCallId: "test-call",
    messages: [],
    context: undefined,
    abortSignal,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("web_search", () => {
  it.each([
    { apiKey: undefined },
    { apiKey: "   " },
    { gatewayToken: undefined },
    { gatewayToken: "   " },
  ])("does not expose search without both credentials: %j", (missing) => {
    expect(createSearchTools({ ...options, ...missing })).toEqual({})
  })

  it("sends the bounded v1 request through the configured gateway", async () => {
    const fetcher = vi.fn(async () => Response.json(response))
    vi.stubGlobal("fetch", fetcher)

    expect(await execute()).toEqual({
      search_id: "search_test",
      session_id: "session_test",
      results: response.results,
      warnings: response.warnings,
    })
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/coworkers/parallel/v1/search"
    )
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-api-key": "parallel-test-key",
      "cf-aig-authorization": "Bearer cloudflare-test-token",
      "cf-aig-skip-cache": "true",
    })
    expect(init.redirect).toBe("error")
    expect(JSON.parse(String(init.body))).toEqual({
      ...input,
      mode: "fast",
      max_chars_total: 20000,
      advanced_settings: { max_results: 5 },
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("accepts empty results and optional source metadata", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        ...response,
        results: [],
        warnings: null,
      })
    )
    expect(await execute()).toMatchObject({ results: [], warnings: null })
  })

  it("rejects blank input and out-of-range result counts before a request", async () => {
    const schema = asSchema(search().inputSchema)
    for (const invalid of [
      { ...input, objective: " " },
      { ...input, search_queries: [] },
      { ...input, search_queries: [" "] },
      { ...input, max_results: 0 },
      { ...input, max_results: 11 },
      { ...input, max_results: 1.5 },
    ]) {
      expect((await schema.validate!(invalid)).success).toBe(false)
    }
  })

  it("uses the requested result count and accepts trailing gateway slashes", async () => {
    const fetcher = vi.fn(async () => Response.json(response))
    vi.stubGlobal("fetch", fetcher)
    const tool = createSearchTools({
      ...options,
      gatewayUrl: async () => `${await options.gatewayUrl()}/`,
    }).web_search!
    await tool.execute!(
      { ...input, max_results: 10 },
      { toolCallId: "test", messages: [], context: undefined }
    )
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/coworkers/parallel/v1/search"
    )
    expect(JSON.parse(String(init.body)).advanced_settings.max_results).toBe(10)
  })

  it.each([401, 403, 429, 500])(
    "reports HTTP %s without exposing upstream bodies or retrying",
    async (status) => {
      const fetcher = vi.fn(
        async () =>
          new Response(`error: ${options.apiKey} ${options.gatewayToken}`, {
            status,
          })
      )
      vi.stubGlobal("fetch", fetcher)
      const result = await execute()
      expect(result).toEqual({
        error: expect.stringContaining(`HTTP ${status}`),
      })
      expect(JSON.stringify(result)).not.toContain(options.apiKey)
      expect(JSON.stringify(result)).not.toContain(options.gatewayToken)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )

  it.each(["not JSON", JSON.stringify({ results: [{ url: 123 }] })])(
    "reports invalid successful responses",
    async (body) => {
      vi.stubGlobal("fetch", async () => new Response(body))
      expect(await execute()).toEqual({
        error: "Web search returned an invalid response. Try another source.",
      })
    }
  )

  it("keeps network and gateway errors out of model output", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error(`network failure: ${options.apiKey}`)
    })
    expect(await execute()).toEqual({
      error: "Web search could not reach AI Gateway. Try another source.",
    })
    const tool = createSearchTools({
      ...options,
      gatewayUrl: async () => {
        throw new Error(options.gatewayToken)
      },
    }).web_search!
    expect(
      await tool.execute!(input, {
        toolCallId: "test",
        messages: [],
        context: undefined,
      })
    ).toEqual({
      error: "Web search could not reach AI Gateway. Try another source.",
    })
  })

  it("forwards cancellation and does not retry", async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      controller.abort()
      expect(init.signal?.aborted).toBe(true)
      throw init.signal?.reason
    })
    vi.stubGlobal("fetch", fetcher)
    expect(await execute(controller.signal)).toEqual({
      error: "Web search was cancelled or timed out.",
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("sets a 30 second timeout on the upstream request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout")
    vi.stubGlobal("fetch", async () => Response.json(response))
    await execute()
    expect(timeout).toHaveBeenCalledWith(30000)
  })

  it("keeps every source and warning visible after context shaping", async () => {
    const large = {
      ...response,
      results: Array.from({ length: 5 }, (_, i) => ({
        url: `https://example.com/source-${i}`,
        title: `Source ${i}`,
        publish_date: "2026-10-28",
        excerpts: ["x".repeat(4000)],
      })),
    }
    const files = new Map<string, string>()
    vi.stubGlobal("fetch", async () => Response.json(large))
    const tool = createSearchTools({
      ...options,
      save: async (path, content) => {
        files.set(`/workspace/${path}`, content)
        return `/workspace/${path}`
      },
    }).web_search!
    const result = await tool.execute!(input, {
      toolCallId: "large-search",
      messages: [],
      context: undefined,
    })
    expect(result).toMatchObject({
      truncated: true,
      savedTo: expect.stringMatching(/^\/workspace\/downloads\/search\//),
      results: large.results.map(
        ({ excerpts: _excerpts, ...source }) => source
      ),
      warnings: response.warnings,
    })
    const json = JSON.stringify(result)
    expect(json.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS)
    const data = JSON.parse(json)
    expect(JSON.parse(files.get(data.savedTo)!)).toMatchObject({
      results: large.results,
      warnings: response.warnings,
    })
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "large-search",
            toolName: "web_search",
            output: { type: "json", value: data },
          },
        ],
      },
    ]
    expect(shapeToolResults(messages)).toBeNull()
  })

  it("returns a recoverable file link when source metadata fills the context budget", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        ...response,
        results: [{ ...response.results[0], title: "x".repeat(13000) }],
      })
    )
    const result = await execute()
    expect(result).toMatchObject({
      truncated: true,
      savedTo: expect.stringContaining("/workspace/downloads/search/"),
      result_count: 1,
      note: expect.stringContaining("read"),
    })
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      MAX_TOOL_RESULT_CHARS
    )
  })

  it("reports a failed result save without echoing the storage error", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        ...response,
        results: [{ ...response.results[0], excerpts: ["x".repeat(20000)] }],
      })
    )
    const tool = createSearchTools({
      ...options,
      save: async () => {
        throw new Error(options.apiKey)
      },
    }).web_search!
    expect(
      await tool.execute!(input, {
        toolCallId: "large-search",
        messages: [],
        context: undefined,
      })
    ).toEqual({
      error:
        "Web search returned a long result that could not be saved. Try fewer results.",
    })
  })
})
