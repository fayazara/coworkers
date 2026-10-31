import { Link } from "@tanstack/react-router"
import { XIcon } from "@/components/icons"
import { useBot } from "@/lib/bot-context"

/**
 * Right-hand panel beside the thread (Computer, Settings). It sits on the page
 * canvas like the sidebar, split from the chat by a hairline. Content inside
 * uses 16px side padding, which the header title lines up with.
 */
export function SidePanel({
  title,
  toolbar,
  children,
}: {
  title: string
  /** Shown in the header instead of the title, e.g. the Computer's tabs. */
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  const { botId } = useBot()
  return (
    <aside aria-label={title} className="flex h-full flex-col bg-kumo-canvas">
      <div className="col-header justify-between">
        {toolbar ? (
          // Tabs scroll on a phone; the close button stays on screen.
          <div className="min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto">
            {toolbar}
          </div>
        ) : (
          <h2 className="pl-1.5 text-[15px] font-medium text-kumo-default">
            {title}
          </h2>
        )}
        <Link
          to="/bots/$botId"
          params={{ botId }}
          aria-label={`Close ${title.toLowerCase()}`}
          className="icon-btn"
        >
          <XIcon size={18} />
        </Link>
      </div>
      {children}
    </aside>
  )
}
