/** HTTP and private bot requests must decode path segments exactly once. */
export function decodeAppPath(path: string) {
  return path.split("/").map(decodeURIComponent).join("/")
}

export function appFetchTarget(
  path: string
): { url: URL; path: string } | { error: string } {
  try {
    const url = new URL(path.replace(/^\/+/, ""), "https://own-app.invalid/")
    if (url.origin !== "https://own-app.invalid")
      return { error: "Only relative app paths are allowed" }
    return { url, path: decodeAppPath(url.pathname.slice(1)) }
  } catch {
    return { error: "Invalid app path" }
  }
}
