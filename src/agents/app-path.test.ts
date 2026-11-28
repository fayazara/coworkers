import { describe, expect, it } from "vitest"
import { appFetchTarget, decodeAppPath } from "./app-path"

describe("private app fetch paths", () => {
  it.each([
    ["annual report.html", "annual report.html"],
    ["annual%20report.html", "annual report.html"],
    ["reports/café.html?q=a%20b", "reports/café.html"],
    ["reports/caf%C3%A9.html", "reports/café.html"],
    ["literal%2520name.html", "literal%20name.html"],
    ["/api/100%25", "api/100%"],
    ["", ""],
  ])("resolves %s to the same file as HTTP", (input, expected) => {
    const target = appFetchTarget(input)
    expect(target).not.toHaveProperty("error")
    if ("error" in target) throw new Error(target.error)
    const files = new Map([[expected, "file contents"]])
    expect(files.get(target.path)).toBe("file contents")
    expect(target.path).toBe(decodeAppPath(target.url.pathname.slice(1)))
    expect(target.url.search).toBe(
      new URL(input, "https://own-app.invalid/").search
    )
  })
  it.each(["bad%path", "bad%FF.html", "bad%2"])(
    "rejects malformed escaping: %s",
    (path) => {
      expect(appFetchTarget(path)).toEqual({ error: "Invalid app path" })
    }
  )
  it.each([
    "https://example.com/file",
    "http://own-app.invalid/file",
    "data:text/plain,hello",
  ])("rejects external targets: %s", (path) => {
    expect(appFetchTarget(path)).toEqual({
      error: "Only relative app paths are allowed",
    })
  })
})
