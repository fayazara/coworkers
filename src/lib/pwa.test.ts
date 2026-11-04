import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { THEME_COLORS } from "@/lib/theme"

const pub = (path: string) =>
  fileURLToPath(new URL(`../../public/${path}`, import.meta.url))

const manifest = JSON.parse(
  readFileSync(pub("manifest.webmanifest"), "utf8")
) as {
  id: string
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string) {
  const header = readFileSync(pub(path)).subarray(0, 24)
  expect(header.subarray(1, 4).toString()).toBe("PNG")
  return `${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`
}

describe("install files", () => {
  it("describes a standalone app rooted at /", () => {
    expect(manifest).toMatchObject({
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
    })
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
  })

  // A manifest has one color pair; the light one, which the dark mode's
  // theme-color meta then replaces once the page runs.
  it("uses the light surface for the browser chrome and splash", () => {
    expect(manifest.theme_color).toBe(THEME_COLORS.light)
    expect(manifest.background_color).toBe(THEME_COLORS.light)
  })

  it("lists icons for any shape and a maskable one, at their real size", () => {
    const purposes = manifest.icons.map((icon) => icon.purpose)
    expect(purposes).toContain("any")
    expect(purposes).toContain("maskable")
    expect(
      manifest.icons.some((i) => i.purpose === "any" && i.sizes === "512x512")
    ).toBe(true)
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png")
      expect(pngSize(icon.src.replace(/^\//, ""))).toBe(icon.sizes)
    }
  })

  it("has a dark launch still for every light one, at the same size", () => {
    const stills = readdirSync(pub("icons")).filter((f) =>
      /^splash-\d+x\d+\.png$/.test(f)
    )
    expect(stills.length).toBeGreaterThan(0)
    for (const still of stills) {
      const dark = still.replace(".png", "-dark.png")
      expect(pngSize(`icons/${dark}`), dark).toBe(pngSize(`icons/${still}`))
      expect(pngSize(`icons/${still}`)).toBe(still.slice(7, -4))
    }
  })

  it("draws the offline page in the app's colors", () => {
    const sw = readFileSync(pub("sw.js"), "utf8")
    expect(sw).toContain(`--bg: ${THEME_COLORS.light}`)
    expect(sw).toContain(`--bg: ${THEME_COLORS.dark}`)
    expect(sw).toContain('localStorage.getItem("coworkers-theme")')
  })
})
