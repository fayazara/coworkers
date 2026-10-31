import { useEffect } from "react"
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TooltipProvider } from "@cloudflare/kumo/components/tooltip"
import { CodeProvider } from "@/components/code-block"
import { LaunchSplash } from "@/components/launch-splash"
import { followViewport } from "@/lib/viewport"
import appCss from "../styles.css?url"

// The page background, and theme_color in public/manifest.json.
const THEME_COLOR = "#ffffff"

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
      { name: "theme-color", content: THEME_COLOR },
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
      // Without credentials Access would answer with its login page.
      {
        rel: "manifest",
        href: "/manifest.json",
        crossOrigin: "use-credentials",
      },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      {
        rel: "preload",
        as: "image",
        href: "/icons/launch-robot.png",
        media: "(display-mode: standalone) and (max-width: 767.98px)",
      },
      ...SPLASH_SCREENS.map(([width, height, ratio]) => ({
        rel: "apple-touch-startup-image",
        href: `/icons/splash-${width * ratio}x${height * ratio}.png`,
        media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
      })),
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
    <html lang="en">
      <head>
        <HeadContent />
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
