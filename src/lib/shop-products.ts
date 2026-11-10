import type { ShopProduct, ShopProductSummary } from "@/lib/shop"

/**
 * Products seen in this tab, so the product panel can paint right away
 * from the card that was tapped, before Shop answers with the details.
 */
const seen = new Map<string, ShopProductSummary | ShopProduct>()
const MAX_SEEN = 200

export function rememberProduct(product: ShopProductSummary | ShopProduct) {
  const known = seen.get(product.id)
  // A summary from search must not replace details already fetched.
  if (known && "media" in known && !("media" in product)) return
  seen.delete(product.id)
  seen.set(product.id, product)
  if (seen.size > MAX_SEEN) {
    const oldest = seen.keys().next().value
    if (oldest !== undefined) seen.delete(oldest)
  }
}

export function seenProduct(id: string) {
  return seen.get(id) ?? null
}

export function isDetailed(
  product: ShopProductSummary | ShopProduct
): product is ShopProduct {
  return "media" in product
}
