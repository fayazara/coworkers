import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { CaretRightIcon, SidebarSimpleIcon } from "@/components/icons"
import { useNavigate } from "@tanstack/react-router"
import { useLayout } from "@/lib/layout-context"
import { useIsPhone } from "@/lib/use-is-phone"

/**
 * Shows and hides the sidebar: a column on a computer, a drawer on a phone.
 * With `back`, it is a back chevron to the home list on a phone instead.
 */
export function SidebarToggle({ back = false }: { back?: boolean }) {
  const { sidebarOpen, toggleSidebar } = useLayout()
  const phone = useIsPhone()
  const navigate = useNavigate()
  const goesBack = back && phone
  const label = goesBack
    ? "Back to bots"
    : sidebarOpen
      ? "Hide bots"
      : "Show bots"
  return (
    <Tooltip
      content={label}
      render={
        <button
          type="button"
          onClick={goesBack ? () => void navigate({ to: "/" }) : toggleSidebar}
          aria-label={label}
          aria-pressed={phone ? undefined : !sidebarOpen}
          className="icon-btn"
        >
          {back ? (
            <CaretRightIcon size={20} className="rotate-180 md:hidden" />
          ) : null}
          <SidebarSimpleIcon
            size={20}
            className={back ? "max-md:hidden" : undefined}
          />
        </button>
      }
    />
  )
}

/** Header for a full-page view: the sidebar toggle, a centred title, and optional actions on the right. */
export function PageHeader({
  title,
  back = false,
  actions,
}: {
  title: string
  /** A phone reached this from the home list; see SidebarToggle. */
  back?: boolean
  /** Icon buttons at the right end, e.g. a panel toggle. */
  actions?: React.ReactNode
}) {
  return (
    <header className="col-header relative justify-between">
      <SidebarToggle back={back} />
      <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-kumo-default md:absolute md:left-1/2 md:max-w-[50%] md:flex-none md:-translate-x-1/2">
        {title}
      </h1>
      {actions ? (
        <div className="flex items-center gap-1">{actions}</div>
      ) : null}
    </header>
  )
}
