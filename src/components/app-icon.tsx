import { useState } from "react"
import { PlugsConnectedIcon } from "@/components/icons"
import { integrationFor } from "@/lib/integrations"

/** An app's own icon, from its site (mcp.linear.app is Linear's). */
export function AppIcon({
  host,
  src,
  size = "md",
}: {
  host: string | null | undefined
  /** A logo to show instead of the site's favicon. */
  src?: string
  /** "sm" fills a group row's 28px icon slot, "md" a card, "lg" a page. */
  size?: "sm" | "md" | "lg"
}) {
  const [failed, setFailed] = useState(false)
  const site = host?.replace(/^(mcp|api|docs\.mcp)\./, "")
  const sm = size === "sm"
  const image =
    src ??
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site ?? "")}&sz=64`
  // In a group row the row draws the round backdrop itself.
  if (sm) {
    return (src || site) && !failed ? (
      <img
        src={image}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        className="size-4 rounded-[3px]"
      />
    ) : (
      <PlugsConnectedIcon size={14} />
    )
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-kumo-base text-kumo-subtle ring-1 ring-kumo-line ${size === "lg" ? "size-14 rounded-2xl" : "size-10 rounded-xl"}`}
    >
      {(src || site) && !failed ? (
        <img
          src={image}
          alt=""
          aria-hidden="true"
          onError={() => setFailed(true)}
          className={
            size === "lg" ? "size-8 rounded-[7px]" : "size-6 rounded-[5px]"
          }
        />
      ) : (
        <PlugsConnectedIcon size={size === "lg" ? 24 : 18} />
      )}
    </span>
  )
}

/** A connection's logo for a group row: its known integration's, else its site's favicon. */
export function ConnectionIcon({ url }: { url: string }) {
  const integration = integrationFor(url)
  let host: string | null = null
  try {
    host = new URL(url).host
  } catch {}
  return (
    <AppIcon
      size="sm"
      host={integration?.site ?? host}
      src={integration?.icon}
    />
  )
}
