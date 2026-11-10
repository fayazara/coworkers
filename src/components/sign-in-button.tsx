import { useState } from "react"
import { Loader } from "@cloudflare/kumo/components/loader"
import { useHub } from "@/lib/hub-context"

/**
 * Sign in to a connection with a link made on click. A stored link goes
 * stale after ten minutes (its OAuth state expires), so it is never used.
 */
export function SignInButton({
  connectionId,
  newTab = false,
  className,
  children = "Sign in",
}: {
  connectionId: string
  /** Open the provider in another tab, keeping this page (the chat). */
  newTab?: boolean
  className: string
  children?: React.ReactNode
}) {
  const { freshSignIn, refreshConnections, live } = useHub()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setOpening(true)
    setError(null)
    // Opened now, while the click still counts, or the browser blocks it.
    const tab = newTab ? window.open("", "_blank") : null
    try {
      const url = await freshSignIn(connectionId)
      if (!url) {
        // Signed in already, by another tab or a retry.
        tab?.close()
        refreshConnections()
      } else if (tab) {
        tab.location.href = url
      } else {
        window.location.assign(url)
        return
      }
    } catch (err) {
      tab?.close()
      setError(err instanceof Error ? err.message : "Could not start sign-in.")
    }
    setOpening(false)
  }

  return (
    <button
      type="button"
      onClick={() => void signIn()}
      disabled={!live || opening}
      title={error ?? undefined}
      className={`${className} gap-2 disabled:opacity-60`}
    >
      {opening ? <Loader size="sm" /> : null}
      {error ? "Try again" : children}
    </button>
  )
}
