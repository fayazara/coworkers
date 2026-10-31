/** More missing than any browser's toolbars: the keyboard is up. */
const KEYBOARD_MIN_PX = 120

/**
 * Keeps the app on the part of the screen the on-screen keyboard leaves. iOS
 * does not resize anything for the keyboard (Chrome does, through
 * interactive-widget in the viewport meta), so read the visual viewport and
 * size the app to it. Returns a cleanup function.
 */
export function followViewport() {
  const viewport = window.visualViewport
  if (!viewport) return
  const root = document.documentElement

  function update() {
    // Pinch zoom moves the visual viewport too; the app stays put for that.
    if (!viewport || viewport.scale > 1.01) return
    const keyboard = window.innerHeight - viewport.height > KEYBOARD_MIN_PX
    root.toggleAttribute("data-keyboard", keyboard)
    if (keyboard) {
      root.style.setProperty("--app-h", `${viewport.height}px`)
      root.style.setProperty("--app-top", `${viewport.offsetTop}px`)
    } else {
      root.style.removeProperty("--app-h")
      root.style.removeProperty("--app-top")
    }
  }

  update()
  viewport.addEventListener("resize", update)
  viewport.addEventListener("scroll", update)
  return () => {
    viewport.removeEventListener("resize", update)
    viewport.removeEventListener("scroll", update)
  }
}
