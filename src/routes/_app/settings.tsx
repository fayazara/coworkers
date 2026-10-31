import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { AgentsSettings } from "@/components/agents-settings"
import { ConnectionsSettings } from "@/components/connections-settings"
import { ModelsSettings } from "@/components/models-settings"
import { SidebarToggle } from "@/components/page-header"
import { SlidingTabs } from "@/components/sliding-tabs"
import { SpendSettings } from "@/components/spend-settings"

const TABS = [
  { value: "models", label: "Models" },
  { value: "connections", label: "Connections" },
  { value: "spend", label: "Spend" },
  { value: "agents", label: "Agents" },
] as const

type Tab = (typeof TABS)[number]["value"]

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (
    search: Record<string, unknown>
  ): { tab?: Tab; error?: string } => ({
    ...(search.tab === "connections" ||
    search.tab === "spend" ||
    search.tab === "agents"
      ? { tab: search.tab }
      : {}),
    // Set by the sign-in callback when an app's OAuth flow fails.
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: Settings,
})

function Settings() {
  const { tab = "models", error } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="col-header relative">
        <SidebarToggle back />
        <h1 className="absolute left-1/2 -translate-x-1/2 text-[15px] font-medium text-kumo-default">
          Settings
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] space-y-8 px-4 pt-4 pb-16 md:px-6">
          <div className="flex justify-center">
            <SlidingTabs
              tabs={[...TABS]}
              value={tab}
              onValueChange={(next) =>
                void navigate({
                  search: next === "models" ? {} : { tab: next },
                  replace: true,
                })
              }
            />
          </div>
          {tab === "models" ? (
            <ModelsSettings />
          ) : tab === "spend" ? (
            <SpendSettings />
          ) : tab === "agents" ? (
            <AgentsSettings />
          ) : (
            <ConnectionsSettings error={error} />
          )}
        </div>
      </div>
    </section>
  )
}
