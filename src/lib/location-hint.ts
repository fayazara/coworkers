/**
 * Where to create a user's Durable Objects: near them. A hint only counts
 * when an object is first created, so existing hubs and bots stay where
 * they are. Bots are created by their hub and land next to it.
 */
export function locationHintFor(
  request: Request
): DurableObjectLocationHint | undefined {
  const cf = (request as { cf?: { continent?: string; longitude?: unknown } })
    .cf
  switch (cf?.continent) {
    case "AS":
      return "apac"
    case "OC":
      return "oc"
    case "EU":
      return "weur"
    case "AF":
      return "afr"
    case "SA":
      return "sam"
    case "NA":
      return Number(cf.longitude) < -100 ? "wnam" : "enam"
    default:
      return undefined
  }
}
