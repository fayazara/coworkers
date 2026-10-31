import { Button } from "@cloudflare/kumo/components/button"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"

/**
 * Grouped list, the shape every settings-like surface uses: a small title, a
 * rounded card of rows split by hairlines, and at most one short hint below.
 */
export function Group({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: React.ReactNode
  /** Small control beside the title, e.g. a refresh button. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2 px-1.5">
        <h3 className="text-sm font-medium text-kumo-default">{title}</h3>
        {action}
      </div>
      <ul className="@container overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06]">
        {children}
      </ul>
      {hint ? (
        <p className="px-1.5 text-xs text-pretty text-kumo-subtle">{hint}</p>
      ) : null}
    </section>
  )
}

/**
 * One row: what it is on the left, its control on the right. With `stacked`,
 * a control too wide to share a narrow group goes under the label, full width.
 * It follows the group's width, so a narrow side panel gets it too.
 */
export function Row({
  label,
  detail,
  icon,
  stacked = false,
  children,
  className = "",
}: {
  label?: React.ReactNode
  detail?: React.ReactNode
  /** Leading icon or avatar, 28px wide. */
  icon?: React.ReactNode
  stacked?: boolean
  children?: React.ReactNode
  className?: string
}) {
  return (
    <li
      className={`flex min-h-14 gap-4 border-t border-kumo-line py-3 pr-3 pl-4 first:border-t-0 ${stacked ? "flex-col gap-2 @md:flex-row @md:items-center @md:gap-4" : "items-center"} ${className}`}
    >
      {icon ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
          {icon}
        </span>
      ) : null}
      {label !== undefined || detail !== undefined ? (
        <span className={`min-w-0 ${stacked ? "@md:flex-1" : "flex-1"}`}>
          {label !== undefined ? (
            <span className="block truncate text-sm text-kumo-default">
              {label}
            </span>
          ) : null}
          {detail !== undefined ? (
            <span
              className={`mt-0.5 block text-xs text-pretty text-kumo-subtle ${stacked ? "@md:max-w-[75%]" : "max-w-[75%]"}`}
            >
              {detail}
            </span>
          ) : null}
        </span>
      ) : null}
      {children}
    </li>
  )
}

/** Placeholder row for an empty group. */
export function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex min-h-14 items-center px-4 text-sm text-kumo-subtle">
      {children}
    </li>
  )
}

/** Borderless field that sits inside a group row. */
export const FIELD =
  "w-full bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-placeholder"

/** Small pill control for time inputs, matching Kumo's small select. */
export const PILL_INPUT =
  "h-8 min-w-0 rounded-lg bg-(--fill-hover) px-2.5 text-sm text-kumo-default tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:opacity-50"

/** Round icon button for row actions. */
export function RowAction({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip
      content={label}
      render={
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={`icon-btn size-8! ${danger ? "hover:text-kumo-danger!" : ""}`}
        >
          {children}
        </button>
      }
    />
  )
}

/** Save button that only shows up once there is something to save. */
export function SaveBar({
  dirty,
  saving,
  disabled,
  onSave,
  onReset,
  saveLabel = "Save",
}: {
  dirty: boolean
  saving: boolean
  disabled?: boolean
  onSave: () => void
  onReset: () => void
  /** Label for the primary button. */
  saveLabel?: string
}) {
  if (!dirty) return null
  return (
    <div className="flex justify-end gap-2 px-1.5">
      <Button
        size="sm"
        variant="ghost"
        className="rounded-full"
        onClick={onReset}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        className="btn-ink rounded-full"
        loading={saving}
        disabled={disabled}
        onClick={onSave}
      >
        {saveLabel}
      </Button>
    </div>
  )
}
