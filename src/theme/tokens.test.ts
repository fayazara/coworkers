import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { THEME_COLORS } from "@/lib/theme"

const css = readFileSync(
  fileURLToPath(new URL("./tokens.css", import.meta.url)),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "")

/** Custom properties declared in the first rule whose selector matches. */
function block(selector: RegExp): Map<string, string> {
  const rule = new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(css)
  if (!rule) throw new Error(`no rule for ${selector}`)
  const declarations = new Map<string, string>()
  for (const [, name, value] of rule[1].matchAll(
    /(--[\w-]+)\s*:\s*([^;]+);/g
  )) {
    declarations.set(name, value.replace(/\s+/g, " ").trim())
  }
  return declarations
}

const shared = block(/:root(?=\s*\{)/)
const light = block(/:root,\s*\[data-mode="light"\]/)
const dark = block(/\[data-mode="dark"\]/)
const mappings = block(/:root,\s*\[data-mode\]/)
const tailwind = block(/@theme inline/)

const brandNames = (map: Map<string, string>) =>
  [...map.keys()].filter((name) => name.startsWith("--brand-"))

/** The brand tokens a value reads, e.g. var(--brand-line). */
const reads = (value: string) =>
  [...value.matchAll(/var\((--brand-[\w-]+)\)/g)].map(([, name]) => name)

/** oklch() or #rrggbb to #rrggbb, for an opaque color. */
function toHex(color: string): string {
  if (color.startsWith("#")) return color.toLowerCase()
  const match = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/.exec(color)
  if (!match) throw new Error(`cannot convert ${color}`)
  const L = Number(match[1]) / 100
  const C = Number(match[2])
  const h = (Number(match[3]) * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return `#${linear
    .map((c) => {
      const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
      return Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0")
    })
    .join("")}`
}

describe("theme tokens", () => {
  it("declares every mode token in both light and dark", () => {
    expect(brandNames(light).length).toBeGreaterThan(30)
    expect(brandNames(dark).sort()).toEqual(brandNames(light).sort())
  })

  it("keeps fonts, radii and shadows out of the mode blocks", () => {
    for (const name of brandNames(shared)) {
      expect(light.has(name), name).toBe(false)
      expect(dark.has(name), name).toBe(false)
    }
    expect(brandNames(shared)).toEqual(
      expect.arrayContaining([
        "--brand-font-sans",
        "--brand-font-mono",
        "--brand-radius-2xl",
        "--brand-shadow-card",
      ])
    )
  })

  it("maps Kumo and Tailwind names only to declared brand tokens", () => {
    const declared = new Set([...brandNames(shared), ...brandNames(light)])
    const mapped = [...mappings.values(), ...tailwind.values()]
    for (const value of mapped) {
      const names = reads(value)
      expect(names.length, value).toBeGreaterThan(0)
      for (const name of names) expect(declared.has(name), name).toBe(true)
    }
    for (const name of [
      "--color-kumo-canvas",
      "--color-kumo-base",
      "--color-kumo-brand",
      "--color-kumo-line",
      "--text-color-kumo-default",
      "--fill-hover",
    ]) {
      expect(mappings.has(name), name).toBe(true)
    }
  })

  it("gives every mode token a value that reads no other mode token", () => {
    for (const mode of [light, dark]) {
      for (const name of brandNames(mode)) {
        expect(reads(mode.get(name) ?? ""), name).toEqual([])
      }
    }
  })

  it("paints the browser chrome in the main surface color", () => {
    expect(toHex(light.get("--brand-surface") ?? "")).toBe(THEME_COLORS.light)
    expect(toHex(dark.get("--brand-surface") ?? "")).toBe(THEME_COLORS.dark)
  })
})
