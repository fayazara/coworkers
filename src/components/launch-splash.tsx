import { useEffect, useState } from "react"
import { useHydrated } from "@tanstack/react-router"
import { RobotHead } from "robot-heads"

/** Matches BOT_AVATAR_LOOKS["blue-rectangle"] and the size in styles.css. */
const COLOR = "#2b49a3"
const SIZE = 140

// Long enough to see it wake up. Matches .launch-splash's fade.
const AWAKE_MS = 1100
const FADE_MS = 300

/** Only an app opened from a phone's home screen has a launch to continue. */
function isInstalledPhone() {
  return matchMedia("(display-mode: standalone) and (max-width: 767.98px)")
    .matches
}

/**
 * iOS can only show a still image while an app starts, so this picks up from
 * it: the same robot in the same place wakes up, then fades into the app. The
 * server sends the still, which CSS shows only when installed, so there is no
 * gap before scripts run. Plays once per launch.
 */
export function LaunchSplash() {
  const hydrated = useHydrated()
  const [phase, setPhase] = useState<"awake" | "leaving" | "gone">("awake")
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    if (!isInstalledPhone()) {
      setPhase("gone")
      return
    }
    const leave = setTimeout(() => setPhase("leaving"), AWAKE_MS)
    const gone = setTimeout(() => setPhase("gone"), AWAKE_MS + FADE_MS)
    return () => {
      clearTimeout(leave)
      clearTimeout(gone)
    }
  }, [])

  // The robot draws on animation frames. Keep the still under it until one
  // has passed, so a slow first frame never shows an empty screen.
  useEffect(() => {
    if (!hydrated) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPainted(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [hydrated])

  if (phase === "gone") return null
  const live =
    hydrated && !matchMedia("(prefers-reduced-motion: reduce)").matches
  return (
    <div
      className="launch-splash"
      data-leaving={phase === "leaving"}
      aria-hidden
    >
      <span className="launch-splash-box">
        {painted && live ? null : <img src="/icons/launch-robot.png" alt="" />}
        {live ? (
          <RobotHead
            shape="rectangle"
            color={COLOR}
            state="happy"
            size={SIZE}
            interactive={false}
          />
        ) : null}
      </span>
    </div>
  )
}
