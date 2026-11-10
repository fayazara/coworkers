import { describe, expect, it } from "vitest"
import {
  checkoutOpen,
  discountPercent,
  formatMoney,
  sizedImage,
  storeHost,
} from "@/lib/shop"
import checkoutFixture from "./fixtures/shop-checkout.json"
import productFixture from "./fixtures/shop-product.json"
import searchFixture from "./fixtures/shop-search.json"
import {
  checkoutForModel,
  plainText,
  productForModel,
  searchArgs,
  searchForModel,
  toCheckout,
  toProduct,
  toSearchResult,
} from "./shop"

describe("toSearchResult", () => {
  const result = toSearchResult(searchFixture, {
    query: "black t shirt",
    country: "US",
  })

  it("keeps every product with a buyable offer", () => {
    expect(result.products).toHaveLength(3)
    expect(result.total).toBe(424)
    expect(result.cursor).toBeTruthy()
  })

  it("takes price, sale, seller and rating from the featured variant", () => {
    const [first] = result.products
    expect(first.title).toBe("Black Classic Crew Neck")
    expect(first.variant.price).toEqual({ amount: 2999, currency: "USD" })
    expect(first.variant.listPrice).toEqual({ amount: 3499, currency: "USD" })
    expect(first.seller).toEqual({
      name: "True Classic",
      url: "https://www.trueclassictees.com",
      domain: "trueclassictees-com.myshopify.com",
    })
    expect(first.rating).toEqual({ value: 4.6, max: 5, count: 4071 })
    expect(first.image?.url).toContain("cdn.shopify.com")
    expect(first.options[0].name).toBe("Size")
  })
})

describe("toProduct", () => {
  const product = toProduct(productFixture)!

  it("reads availability for each option value", () => {
    expect(product.options[0].values[1]).toEqual({
      label: "M",
      available: true,
    })
    expect(product.selected).toEqual([{ name: "Size", label: "M" }])
    expect(product.variant.options).toEqual([{ name: "Size", label: "M" }])
  })

  it("collects a deduplicated gallery and the store's highlights", () => {
    expect(product.media.length).toBeGreaterThan(3)
    const keys = product.media.map((m) => m.url.split("?")[0])
    expect(new Set(keys).size).toBe(keys.length)
    expect(product.highlights.length).toBeGreaterThan(0)
    expect(product.description).not.toContain("&#39;")
  })
})

describe("toCheckout", () => {
  const checkout = toCheckout(
    checkoutFixture,
    "trueclassictees-com.myshopify.com",
    "True Classic"
  )!

  it("keeps lines, totals in order, policies and the pay link", () => {
    expect(checkout.status).toBe("requires_escalation")
    expect(checkout.currency).toBe("INR")
    expect(checkout.lines).toEqual([
      expect.objectContaining({
        title: "Black Classic Crew Neck - M",
        quantity: 1,
        total: 365000,
      }),
    ])
    expect(checkout.totals.map((t) => t.type)).toEqual(["subtotal", "total"])
    expect(checkout.links.map((l) => l.type)).toContain("refund_policy")
    expect(checkout.continueUrl).toMatch(/^https:\/\/shop\.app\//)
    expect(checkout.messages.map((m) => m.code)).toContain(
      "delivery_address_required"
    )
  })

  it("is open until it expires or completes", () => {
    expect(checkoutOpen(checkout, Date.parse("2026-11-05T00:00:00Z"))).toBe(
      true
    )
    expect(checkoutOpen(checkout, Date.parse("2027-01-01T00:00:00Z"))).toBe(
      false
    )
    expect(checkoutOpen({ ...checkout, status: "completed" })).toBe(false)
  })
})

describe("for the model", () => {
  it("lists ids, prices and links without image URLs", () => {
    const text = searchForModel(
      toSearchResult(searchFixture, { query: "black t shirt", country: "US" })
    )
    expect(text).toContain('424 results for "black t shirt" (ships to US)')
    expect(text).toContain("$29.99 (was $34.99)")
    expect(text).toContain("gid://shopify/ProductVariant/29275989049416")
    expect(text).toContain("shop: trueclassictees-com.myshopify.com")
    expect(text).not.toContain("cdn.shopify.com")
    expect(text).toContain("cursor")
  })

  it("is a fraction of the size of the raw result", () => {
    const text = searchForModel(
      toSearchResult(searchFixture, { query: "black t shirt" })
    )
    expect(text.length).toBeLessThan(JSON.stringify(searchFixture).length / 5)
  })

  it("describes a product and a checkout", () => {
    expect(productForModel(toProduct(productFixture)!)).toContain(
      "Asked for: Size M"
    )
    const checkout = checkoutForModel(
      toCheckout(
        checkoutFixture,
        "trueclassictees-com.myshopify.com",
        "True Classic"
      )!
    )
    expect(checkout).toContain("Nothing is bought yet")
    expect(checkout).toContain("1 × Black Classic Crew Neck - M")
  })
})

describe("searchArgs", () => {
  it("turns hard requirements into filters", () => {
    expect(
      searchArgs({
        query: "rain jacket",
        size: ["M"],
        maxPrice: 8000,
        currency: "CAD",
        country: "CA",
      })
    ).toEqual({
      catalog: {
        query: "rain jacket",
        context: { address_country: "CA", currency: "CAD" },
        filters: {
          attributes: [{ name: "Size", values: ["M"] }],
          price: { max: 8000 },
        },
        pagination: { limit: 8 },
      },
    })
  })

  it("searches by a product and pages with a cursor", () => {
    const args = searchArgs({ query: "", like: "gid://shopify/p/1" }, 50, "abc")
    expect(args.catalog).toEqual({
      like: [{ id: "gid://shopify/p/1" }],
      context: {},
      pagination: { limit: 20, cursor: "abc" },
    })
  })
})

describe("plainText", () => {
  it("drops tags and decodes entities", () => {
    expect(
      plainText(
        "<p>Soft &amp; light</p><ul><li>Cotton</li><li>It&#39;s ok</li></ul>"
      )
    ).toBe("Soft & light\n• Cotton\n• It's ok")
  })
})

describe("money and images", () => {
  it("formats minor units and drops whole cents", () => {
    expect(formatMoney(2999, "USD", "en-US")).toBe("$29.99")
    expect(formatMoney(365000, "INR", "en-US")).toBe("₹3,650")
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500")
  })

  it("works out a sale", () => {
    const price = { amount: 2999, currency: "USD" }
    expect(discountPercent(price, { amount: 3499, currency: "USD" })).toBe(14)
    expect(discountPercent(price, { amount: 2999, currency: "USD" })).toBeNull()
    expect(discountPercent(price)).toBeNull()
  })

  it("resizes Shopify CDN images only", () => {
    expect(sizedImage("https://cdn.shopify.com/a.jpg?v=1", 400)).toBe(
      "https://cdn.shopify.com/a.jpg?v=1&width=400"
    )
    expect(sizedImage("https://example.com/a.jpg", 400)).toBe(
      "https://example.com/a.jpg"
    )
  })

  it("names a store by its own host", () => {
    expect(
      storeHost({ url: "https://www.trueclassictees.com", domain: "x" })
    ).toBe("trueclassictees.com")
  })
})
