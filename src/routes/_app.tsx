import { useEffect } from "react"
import {
  ClientOnly,
  Outlet,
  createFileRoute,
  useLocation,
} from "@tanstack/react-router"
import { Sidebar } from "@/components/sidebar"
import { SplitView } from "@/components/split-view"
import { LiveHubProvider, StaticHubProvider } from "@/lib/hub-context"
import { LayoutProvider, useLayout } from "@/lib/layout-context"
import { getHubSnapshot } from "@/lib/server-fns"
import { useIsPhone } from "@/lib/use-is-phone"

export const Route = createFileRoute("/_app")({
  loader: () => getHubSnapshot(),
  // The sidebar is live over a WebSocket; the loader only seeds first paint.
  staleTime: Infinity,
  component: AppLayout,
})

function Shell() {
  const { sidebarOpen, setSidebarOpen, widths, setWidth } = useLayout()
  const phone = useIsPhone()
  const pathname = useLocation({ select: (l) => l.pathname })
  // A phone's home already is the sidebar.
  const home = useLocation({
    select: (l) => l.pathname === "/" && l.search.desk !== true,
  })
  // A new page is what the drawer was opened for, however it got there.
  useEffect(() => {
    if (phone) setSidebarOpen(false)
  }, [phone, pathname, setSidebarOpen])
  return (
    <div className="h-full">
      <SplitView
        id="app"
        side="left"
        label="Bots"
        open={sidebarOpen}
        width={widths.sidebar ?? 300}
        minWidth={240}
        maxWidth={440}
        mainMinWidth={480}
        onWidthChange={(px) => setWidth("sidebar", px)}
        onClose={() => setSidebarOpen(false)}
        onOpen={home ? undefined : () => setSidebarOpen(true)}
        panel={<Sidebar />}
      >
        <main className="app-main flex h-full min-w-0 flex-1 bg-kumo-base">
          <Outlet />
        </main>
      </SplitView>
    </div>
  )
}

function AppLayout() {
  const { viewer, hub, sidebarOpen, widths } = Route.useLoaderData()
  return (
    <LayoutProvider initialSidebarOpen={sidebarOpen} initialWidths={widths}>
      {/* WebSockets only exist in the browser. The server (and the first
          client render) show the loader's snapshot; the live provider takes
          over after hydration. */}
      <ClientOnly
        fallback={
          <StaticHubProvider viewer={viewer} initial={hub}>
            <Shell />
          </StaticHubProvider>
        }
      >
        <LiveHubProvider viewer={viewer} initial={hub}>
          <Shell />
        </LiveHubProvider>
      </ClientOnly>
    </LayoutProvider>
  )
}
