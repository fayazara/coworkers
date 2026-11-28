import { Link, useLocation } from "@tanstack/react-router"
import {
  AiChipIcon,
  AppearanceIcon,
  ArrowLeftIcon,
  BookOpenTextIcon,
  CoinsIcon,
  PlugsConnectedIcon,
  TerminalIcon,
} from "@/components/icons"

export const SETTINGS_SECTIONS = [
  {
    value: "appearance",
    label: "Appearance",
    detail: "System, light or dark for this browser",
    icon: AppearanceIcon,
  },
  {
    value: "models",
    label: "Models",
    detail: "Which model your bots think with",
    icon: AiChipIcon,
  },
  {
    value: "integrations",
    label: "Integrations",
    detail: "Apps and services your bots use",
    icon: PlugsConnectedIcon,
  },
  {
    value: "skills",
    label: "Skills",
    detail: "Instructions your bots can follow",
    icon: BookOpenTextIcon,
  },
  {
    value: "spend",
    label: "Spend",
    detail: "What each bot costs this month",
    icon: CoinsIcon,
  },
  {
    value: "agents",
    label: "Agents",
    detail: "Claude Code, Codex and other MCP clients",
    icon: TerminalIcon,
  },
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["value"]

export function isSettingsSection(value: unknown): value is SettingsSection {
  return SETTINGS_SECTIONS.some((s) => s.value === value)
}

/** The search for a section's link: Models is the bare /settings. */
export function sectionSearch(value: SettingsSection) {
  return value === "models" ? {} : { tab: value }
}

// Where the user was before Settings, so leaving goes back to that chat.
let lastAppPath = "/"
export function rememberAppPath(path: string) {
  if (!path.startsWith("/settings")) lastAppPath = path
}

/**
 * The sidebar while Settings is open on a computer: the sections in place of
 * the bots, and a way back to them.
 */
export function SettingsSidebar() {
  const tab = useLocation({
    select: (l) => (l.search as { tab?: string }).tab,
  })
  const current = isSettingsSection(tab)
    ? tab
    : tab === "connections"
      ? "integrations"
      : "models"

  return (
    <>
      <div className="col-header max-md:px-4!">
        <Link
          // Any path in the app; the router resolves it like a typed route.
          to={lastAppPath as "/"}
          className="pressable -ml-1 flex h-9 items-center gap-2 rounded-full pr-3.5 pl-2.5 text-sm text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
        >
          <ArrowLeftIcon size={16} />
          Back to bots
        </Link>
      </div>
      <nav
        aria-label="Settings"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-(--inset) pt-1"
      >
        <p className="px-2.5 pt-2 pb-2 text-xs font-medium text-kumo-subtle">
          Settings
        </p>
        <ul className="space-y-0.5">
          {SETTINGS_SECTIONS.map((s) => {
            const active = s.value === current
            return (
              <li key={s.value}>
                <Link
                  to="/settings"
                  search={sectionSearch(s.value)}
                  aria-current={active ? "page" : undefined}
                  className={`pressable flex h-10 items-center gap-3 rounded-xl px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus ${
                    active
                      ? "bg-(--fill-active) font-medium text-kumo-default"
                      : "text-kumo-default hover:bg-(--fill-hover)"
                  }`}
                >
                  <s.icon
                    size={18}
                    className={`shrink-0 ${active ? "text-kumo-default" : "text-kumo-subtle"}`}
                  />
                  {s.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
