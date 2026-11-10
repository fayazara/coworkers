import { describe, expect, it } from "vitest"
import {
  MAX_SHOW_ITEMS,
  keepHyphens,
  showBlocks,
  statSize,
  statTone,
} from "./show"

describe("showBlocks", () => {
  it("reads the fields each block uses and drops what it cannot draw", () => {
    const blocks = showBlocks([
      {
        type: "list",
        title: " OLX ",
        items: [
          {
            label: "128GB Wi-Fi",
            value: "₹44,999",
            url: "https://olx.in/item/1",
            tag: "Best value",
            tone: "good",
          },
          { value: "no label" },
          { label: "Bad link", url: "javascript:alert(1)", tone: "loud" },
        ],
      },
      { type: "chart", items: [{ label: "x" }] },
      { type: "callout", text: "New price is from memory.", tone: "warn" },
      { type: "stats", items: [] },
      "nonsense",
    ])
    expect(blocks.map((b) => b.type)).toEqual(["list", "callout"])
    expect(blocks[0].title).toBe("OLX")
    expect(blocks[0].items).toHaveLength(2)
    expect(blocks[0].items[0]).toMatchObject({
      tag: "Best value",
      tone: "good",
    })
    expect(blocks[0].items[1].url).toBeUndefined()
    expect(blocks[0].items[1].tone).toBeUndefined()
  })

  it("copes with a call that is still streaming in", () => {
    expect(showBlocks(undefined)).toEqual([])
    expect(showBlocks([{ type: "list" }])).toEqual([])
    expect(
      showBlocks([
        { type: "list", items: [{ label: "One" }, { lab: "" }, null] },
      ])
    ).toMatchObject([{ items: [{ label: "One" }] }])
  })

  it("caps a runaway list", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ label: `Item ${i}` }))
    expect(showBlocks([{ type: "list", items }])[0].items).toHaveLength(
      MAX_SHOW_ITEMS
    )
  })
})

describe("stats", () => {
  it("colours a change by its sign unless the bot set a tone", () => {
    expect(statTone({ label: "x", value: "-2.9%" })).toBe("warn")
    expect(statTone({ label: "x", value: "+12" })).toBe("good")
    expect(statTone({ label: "x", value: "₹93.93" })).toBe("neutral")
    expect(statTone({ label: "x", value: "-₹400", tone: "good" })).toBe("good")
  })

  it("sizes a row of values for its longest one", () => {
    expect(statSize([{ label: "a", value: "₹93.93" }])).toBe("lg")
    expect(statSize([{ label: "a", value: "₹93.9-96.7" }])).toBe("md")
    expect(statSize([{ label: "a", value: "₹93.92 - ₹96.73" }])).toBe("sm")
  })

  it("keeps hyphenated words whole", () => {
    expect(keepHyphens("mid-market, 1-2%")).toBe("mid\u2011market, 1\u20112%")
  })
})
