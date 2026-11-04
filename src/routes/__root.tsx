import { useEffect } from "react"
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import { CodeProvider } from "@/components/code-block"
import { LaunchSplash } from "@/components/launch-splash"
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme"
import { followViewport } from "@/lib/viewport"
import appCss from "../styles.css?url"

// What iOS shows while an installed app starts: width, height, pixel ratio.
const SPLASH_SCREENS = [
  [375, 812, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [414, 896, 2],
  [414, 896, 3],
  [430, 932, 3],
  [440, 956, 3],
]

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { name: "theme-color", content: THEME_COLORS.light },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Coworkers" },
      // The app draws under the status bar; .app-main pads below it.
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { title: "Coworkers" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // The manifest path is on the Access bypass list, but a deployment
      // that has not re-run setup since it was renamed still guards it, and
      // without credentials Access answers with its login page.
      {
        rel: "manifest",
        href: "/manifest.webmanifest",
        crossOrigin: "use-credentials",
      },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      {
        rel: "preload",
        as: "image",
        href: "/icons/launch-robot.png",
        media: "(display-mode: standalone) and (max-width: 767.98px)",
      },
      // One still per OS scheme. iOS picks it when the app is added to the
      // Home Screen (checked in the iOS 26 simulator), not at each launch, so
      // it matches the scheme the phone had then.
      ...SPLASH_SCREENS.flatMap(([width, height, ratio]) =>
        (["light", "dark"] as const).map((scheme) => ({
          rel: "apple-touch-startup-image",
          href: `/icons/splash-${width * ratio}x${height * ratio}${scheme === "dark" ? "-dark" : ""}.png`,
          media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`,
        }))
      ),
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => followViewport(), [])
  // Offline page and cached assets, for everyone, not only push subscribers.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
        console.error("Service worker failed to register", err)
      })
    }
  }, [])
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-kumo-canvas text-kumo-default antialiased">
        {/* `isolate` keeps Kumo's portalled popups above the app layout. */}
        <div className="app-root isolate">
          <TooltipProvider>
            <CodeProvider>{children}</CodeProvider>
          </TooltipProvider>
        </div>
        <LaunchSplash />
        <Scripts />
      </body>
    </html>
  )
}
