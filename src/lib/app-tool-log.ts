/** How an app's calls into the user's accounts read in Activity. */

/**
 * The reason a call failed, in a few plain words. Refusals from the rules
 * read as "Blocked", the app's own errors as "Failed".
 */
export function plainReason(error: string | undefined): string {
  const e = error ?? ""
  const wait = /Try again in (\d+) min/.exec(e)
  if (/^Too many/.test(e)) {
    return `Blocked: too many from one visitor${wait ? `, try again in ${wait[1]} min` : ""}`
  }
  if (/has not allowed this app/.test(e)) return "Blocked: not allowed yet"
  if (/is not one the user allowed|is missing$/.test(e)) {
    return "Blocked: tried something you didn't allow"
  }
  if (/rules block this bot/.test(e)) return "Blocked by the bot's rules"
  if (/not connected right now/.test(e)) return "Failed: app not connected"
  if (/sign-in expired|reconnect/i.test(e))
    return "Failed: app needs you to sign in again"
  return `Failed: ${e.slice(0, 120) || "unknown error"}`
}
