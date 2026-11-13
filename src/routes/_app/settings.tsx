import { Link, createFileRoute } from "@tanstack/react-router"
import { AgentsSettings } from "@/components/agents-settings"
import { GROUP_LIST } from "@/components/group"
import { CaretRightIcon } from "@/components/icons"
import { IntegrationsSettings } from "@/components/integrations-settings"
import { ModelsSettings } from "@/components/models-settings"
import { SidebarToggle } from "@/components/page-header"
import { SETTINGS_SECTIONS, isSettingsSection } from "@/components/settings-nav"
import type { SettingsSection } from "@/components/settings-nav"
import { SkillsSettings } from "@/components/skills-settings"
import { SpendSettings } from "@/components/spend-settings"
import { ThemeSettings } from "@/components/theme-settings"

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (
    search: Record<string, unknown>
  ): { tab?: SettingsSection; app?: string; error?: string } => {
    // "connections" is the old name, still in sign-in links and bookmarks.
    const tab = search.tab === "connections" ? "integrations" : search.tab
    return {
      ...(isSettingsSection(tab) ? { tab } : {}),
      ...(typeof search.app === "string" ? { app: search.app } : {}),
      // Set by the sign-in callback when an app's OAuth flow fails.
      ...(typeof search.error === "string" ? { error: search.error } : {}),
    }
  },
  component: Settings,
})

/**
 * On a computer the sidebar lists the sections (see SettingsSidebar) and this
 * page shows one. On a phone, /settings is the list and a section opens on
 * its own screen.
 */
function Settings() {
  const { tab, app, error } = Route.useSearch()
  const current = SETTINGS_SECTIONS.find((s) => s.value === (tab ?? "models"))!
  const picked = tab !== undefined

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="col-header relative">
        {picked ? (
          <>
            <span className="max-md:hidden">
              <SidebarToggle />
            </span>
            <span className="md:hidden">
              {/* An app's page goes back to Integrations, a section to the list. */}
              <Link
                to="/settings"
                search={app ? { tab: current.value } : {}}
                aria-label={
                  app ? `Back to ${current.label}` : "Back to settings"
                }
                className="icon-btn"
              >
                <CaretRightIcon size={20} className="rotate-180" />
              </Link>
            </span>
          </>
        ) : (
          <SidebarToggle back />
        )}
        {/* A computer names the section in the page itself. */}
        <h1 className="absolute left-1/2 -translate-x-1/2 text-[15px] font-medium text-kumo-default md:hidden">
          {picked ? current.label : "Settings"}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 pt-2 pb-16 md:px-8 md:pt-6">
          {picked ? null : (
            <ul className={`${GROUP_LIST} md:hidden`}>
              {SETTINGS_SECTIONS.map((s) => (
                <li
                  key={s.value}
                  className="border-t border-kumo-line first:border-t-0"
                >
                  <Link
                    to="/settings"
                    search={{ tab: s.value }}
                    className="flex min-h-14 items-center gap-4 py-3 pr-4 pl-4 outline-none focus-visible:bg-(--fill-hover) active:bg-(--fill-hover)"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
                      <s.icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-kumo-default">
                        {s.label}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-kumo-subtle">
                        {s.detail}
                      </span>
                    </span>
                    <CaretRightIcon size={14} className="text-kumo-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className={picked ? undefined : "max-md:hidden"}>
            {current.value === "appearance" ? (
              <ThemeSettings />
            ) : current.value === "models" ? (
              <ModelsSettings />
            ) : current.value === "integrations" ? (
              <IntegrationsSettings app={app} error={error} />
            ) : current.value === "skills" ? (
              <SkillsSettings />
            ) : current.value === "spend" ? (
              <SpendSettings />
            ) : (
              <AgentsSettings />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
