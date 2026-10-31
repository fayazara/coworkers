import { useSyncExternalStore } from "react"

// Tailwind's `md`, and the media queries in styles.css.
const PHONE = "(max-width: 767.98px)"

function subscribe(onChange: () => void) {
  const query = matchMedia(PHONE)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/**
 * Too narrow for panels beside the content. The server cannot know, so it
 * answers false and styles.css handles a phone's first paint.
 */
export function useIsPhone() {
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(PHONE).matches,
    () => false
  )
}
