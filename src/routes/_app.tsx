import { ClientOnly, Outlet, createFileRoute } from "@tanstack/react-router"
import { Sidebar } from "@/components/sidebar"
import { SplitView } from "@/components/split-view"
import { LiveHubProvider, StaticHubProvider } from "@/lib/hub-context"
import { LayoutProvider, useLayout } from "@/lib/layout-context"
import { getHubSnapshot } from "@/lib/server-fns"

export const Route = createFileRoute("/_app")({
  loader: () => getHubSnapshot(),
  // The sidebar is live over a WebSocket; the loader only seeds first paint.
  staleTime: Infinity,
  component: AppLayout,
})

function Shell() {
  const { sidebarOpen, setSidebarOpen, setSidebarOverlay, widths, setWidth } =
    useLayout()
  return (
    <div className="h-full">
      <SplitView
        id="app"
        side="left"
        open={sidebarOpen}
        width={widths.sidebar ?? 300}
        minWidth={240}
        maxWidth={440}
        mainMinWidth={480}
        onWidthChange={(px) => setWidth("sidebar", px)}
        onClose={() => setSidebarOpen(false)}
        onOverlayChange={setSidebarOverlay}
        panel={<Sidebar />}
      >
        <main className="flex h-full min-w-0 flex-1 bg-kumo-base">
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
