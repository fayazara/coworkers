import { BotAvatar } from "./bot-avatar"
import { SidebarToggle } from "./page-header"
import type { BotSummary } from "@/lib/types"

export function BotHeader({
  bot,
  children,
}: {
  bot?: Pick<BotSummary, "name" | "avatar" | "status">
  children?: React.ReactNode
}) {
  return (
    <header className="col-header relative justify-between">
      <SidebarToggle back />
      {bot ? (
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 md:absolute md:left-1/2 md:max-w-[50%] md:flex-none md:-translate-x-1/2 md:rounded-full md:bg-kumo-base md:pr-4 md:pl-1.5 md:shadow-[0_0_0_1px_var(--color-kumo-line),0_1px_2px_oklch(0_0_0/0.04),0_2px_8px_oklch(0_0_0/0.04)]">
          <BotAvatar avatar={bot.avatar} status={bot.status} size={30} />
          <h1 className="truncate text-[15px] font-medium text-kumo-default">
            {bot.name}
          </h1>
        </div>
      ) : null}
      {children}
    </header>
  )
}
