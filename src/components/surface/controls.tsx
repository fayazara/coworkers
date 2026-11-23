import { useId, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { Switch } from "@cloudflare/kumo/components/switch"
import { ArrowSquareOutIcon, CheckIcon } from "@/components/icons"
import { CATALOG } from "@/lib/surface/catalog"
import { asText, checkFieldValue } from "@/lib/surface/format"
import { safeUrl } from "@/lib/surface/normalize"
import { getAt } from "@/lib/surface/pointer"
import type { Action, SurfaceNode } from "@/lib/surface/types"
import { blockFrame, useSurface } from "./context"
import { useItems } from "./content"

/* ---------- Buttons ---------- */

function SurfaceButton({
  target,
  label,
  action,
  primary,
  disabled,
  submit,
}: {
  target: string
  label: string
  action: Action
  primary: boolean
  disabled?: boolean
  submit?: boolean
}) {
  const { interactive, canSay, busy: working, press, pending } = useSurface()
  const [confirming, setConfirming] = useState(false)
  const confirm = "event" in action ? action.confirm : undefined
  const busy = pending === target
  const variant = primary ? "primary" : "outline"
  const className = `rounded-full ${primary ? "btn-ink" : ""}`

  if ("link" in action) {
    const href = safeUrl(action.link)
    if (!href) return null
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={`pressable inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus ${
          primary
            ? "bg-kumo-contrast text-kumo-inverse"
            : "text-kumo-default ring-1 ring-kumo-line hover:bg-(--fill-hover)"
        }`}
      >
        {label}
        <ArrowSquareOutIcon size={14} className="opacity-70" />
      </a>
    )
  }
  const usable = !working && ("say" in action ? canSay : interactive)
  if (confirming && confirm) {
    return (
      <span className="sf-enter flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-kumo-subtle">{confirm}</span>
        <Button
          type="button"
          variant="primary"
          className="btn-ink rounded-full"
          loading={busy}
          onClick={() => {
            setConfirming(false)
            press(target)
          }}
        >
          {label}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="rounded-full"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </span>
    )
  }
  return (
    <Button
      type={submit ? "submit" : "button"}
      variant={variant}
      className={className}
      loading={busy}
      disabled={!usable || disabled || (pending !== null && !busy)}
      onClick={
        submit
          ? undefined
          : () => (confirm ? setConfirming(true) : press(target))
      }
    >
      {label}
    </Button>
  )
}

function PressError({ targets }: { targets: string[] }) {
  const { error } = useSurface()
  if (!error || !targets.includes(error.target)) return null
  return <p className="text-[13px] text-kumo-danger">{error.message}</p>
}

/** One to three buttons. The first is primary unless one asks to be. */
export function Actions({ node }: { node: SurfaceNode }) {
  const items = useItems(node, "items", CATALOG.Actions.props.items)
  const marked = items.findIndex((i) => i.emphasis === "primary")
  const primaryAt = marked === -1 ? 0 : marked
  const targets = items.map((_, i) => `${node.id}#${i}`)
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <SurfaceButton
            key={index}
            target={targets[index]}
            label={String(item.label)}
            action={item.action as Action}
            primary={index === primaryAt && item.emphasis !== "quiet"}
          />
        ))}
      </div>
      <PressError targets={targets} />
    </div>
  )
}

/* ---------- Inputs ---------- */

const FIELD =
  "w-full bg-kumo-base text-[15px] text-kumo-default ring-1 ring-kumo-line outline-none placeholder:text-kumo-subtle focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:opacity-60 aria-invalid:ring-kumo-danger"

function useField(node: SurfaceNode) {
  const ctx = useSurface()
  const pointer = String(node.props.field)
  const value = getAt(ctx.data, pointer)
  return {
    value,
    set: (next: unknown) => ctx.setField(pointer, next),
    disabled: !ctx.interactive,
    edited: ctx.edited.has(pointer),
  }
}

function FieldShell({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-1 text-[13px] text-kumo-subtle">
        {label}
      </label>
      {children}
      {error ? (
        <p className="px-1 text-[13px] text-kumo-danger">{error}</p>
      ) : null}
    </div>
  )
}

export function TextField({ node }: { node: SurfaceNode }) {
  const id = useId()
  const { value, set, disabled, edited } = useField(node)
  const text = typeof value === "string" ? value : asText(value) ?? ""
  const kind = typeof node.props.kind === "string" ? node.props.kind : "text"
  const max = typeof node.props.max === "number" ? node.props.max : undefined
  const error = edited
    ? checkFieldValue(text, {
        required: node.props.required === true,
        kind,
        max,
      })
    : null
  const common = {
    id,
    value: text,
    disabled,
    maxLength: max,
    placeholder: asText(node.props.placeholder),
    "aria-invalid": error ? true : undefined,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => set(e.target.value),
  }
  return (
    <FieldShell id={id} label={String(node.props.label)} error={error}>
      {node.props.multiline ? (
        <textarea
          {...common}
          rows={4}
          className={`${FIELD} field-sizing-content min-h-24 resize-none rounded-2xl px-4 py-2.5 leading-relaxed`}
        />
      ) : (
        <input
          {...common}
          type={kind === "number" ? "text" : kind}
          inputMode={kind === "number" ? "decimal" : undefined}
          className={`${FIELD} h-10 rounded-full px-4`}
        />
      )}
    </FieldShell>
  )
}

export function DateField({ node }: { node: SurfaceNode }) {
  const id = useId()
  const { value, set, disabled } = useField(node)
  const time = node.props.time === true
  const text = typeof value === "string" ? value : ""
  return (
    <FieldShell id={id} label={String(node.props.label)}>
      <input
        id={id}
        type={time ? "datetime-local" : "date"}
        value={time ? text.slice(0, 16) : text.slice(0, 10)}
        disabled={disabled}
        onChange={(e) => set(e.target.value)}
        className={`${FIELD} h-10 rounded-full px-4 tabular-nums`}
      />
    </FieldShell>
  )
}

export function Toggle({ node }: { node: SurfaceNode }) {
  const { value, set, disabled } = useField(node)
  const label = String(node.props.label)
  const detail = asText(node.props.detail)
  return (
    <div className="flex items-center justify-between gap-4 px-1">
      <span className="min-w-0">
        <span className="block text-[15px] text-kumo-default">{label}</span>
        {detail ? (
          <span className="block text-[13px] text-kumo-subtle">{detail}</span>
        ) : null}
      </span>
      <Switch
        aria-label={label}
        checked={value === true}
        disabled={disabled}
        onCheckedChange={(next) => set(next)}
      />
    </div>
  )
}

/** Chips when the options are short; a list with detail lines otherwise. */
export function Choice({ node }: { node: SurfaceNode }) {
  const { value, set, disabled } = useField(node)
  const options = useItems(node, "options", CATALOG.Choice.props.options)
  const multiple = node.props.multiple === true
  const picked = new Set(
    multiple
      ? Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : []
      : typeof value === "string"
        ? [value]
        : []
  )
  const toggle = (option: string) => {
    if (!multiple) return set(option)
    const next = new Set(picked)
    if (next.has(option)) next.delete(option)
    else next.add(option)
    set(options.map((o) => String(o.value)).filter((v) => next.has(v)))
  }
  const detailed = options.some((o) => asText(o.detail))
  const label = String(node.props.label)
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 px-1 text-[13px] text-kumo-subtle">
        {label}
      </legend>
      {detailed ? (
        <div className="flex flex-col gap-1">
          {options.map((option) => {
            const v = String(option.value)
            const on = picked.has(v)
            const detail = asText(option.detail)
            return (
              <button
                key={v}
                type="button"
                role={multiple ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => toggle(v)}
                className={`pressable flex items-start gap-3 rounded-2xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:opacity-60 ${
                  on
                    ? "bg-(--fill-active)"
                    : "ring-1 ring-kumo-line hover:bg-(--fill-hover)"
                }`}
              >
                <span
                  className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center ${multiple ? "rounded-md" : "rounded-full"} ${
                    on
                      ? "bg-kumo-contrast text-kumo-inverse"
                      : "ring-[1.5px] ring-kumo-line ring-inset"
                  }`}
                >
                  {on ? <CheckIcon size={12} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] text-kumo-default">
                    {String(option.label)}
                  </span>
                  {detail ? (
                    <span className="mt-0.5 block text-[13px] text-pretty text-kumo-subtle">
                      {detail}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const v = String(option.value)
            const on = picked.has(v)
            return (
              <button
                key={v}
                type="button"
                role={multiple ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => toggle(v)}
                className={`pressable h-9 rounded-full px-4 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:opacity-60 ${
                  on
                    ? "bg-kumo-contrast text-kumo-inverse"
                    : "text-kumo-default ring-1 ring-kumo-line hover:bg-(--fill-hover)"
                }`}
              >
                {String(option.label)}
              </button>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

/* ---------- Containers ---------- */

/**
 * Fields sent together. Submit stays disabled until required fields are
 * filled and every field passes its check.
 */
export function Form({
  node,
  children,
}: {
  node: SurfaceNode
  children: React.ReactNode
}) {
  const ctx = useSurface()
  const title = asText(node.props.title)
  const submit = node.props.submit as { label: string; action: Action }
  const secondary = node.props.secondary as
    | { label: string; action: Action }
    | undefined
  const fields =
    "event" in submit.action ? submit.action.fields : ([] as string[])
  const invalid = fields.some((pointer) => {
    const input = Object.values(ctx.surface.nodes).find(
      (n) => n.props.field === pointer
    )
    if (!input) return false
    return (
      checkFieldValue(getAt(ctx.data, pointer), {
        required: input.props.required === true,
        kind: typeof input.props.kind === "string" ? input.props.kind : undefined,
        max: typeof input.props.max === "number" ? input.props.max : undefined,
      }) !== null
    )
  })
  const targets = [`${node.id}#submit`, `${node.id}#secondary`]
  return (
    <form
      className={`flex flex-col gap-4 rounded-3xl p-4 ${blockFrame(ctx.placement)}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (!invalid && ctx.interactive && ctx.pending === null) {
          ctx.press(targets[0])
        }
      }}
    >
      {title ? (
        <p className="px-1 text-[15px] font-semibold text-kumo-default">
          {title}
        </p>
      ) : null}
      {children}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <SurfaceButton
            target={targets[0]}
            label={submit.label}
            action={submit.action}
            primary
            disabled={invalid}
            submit={!("confirm" in submit.action && submit.action.confirm)}
          />
          {secondary ? (
            <SurfaceButton
              target={targets[1]}
              label={secondary.label}
              action={secondary.action}
              primary={false}
            />
          ) : null}
        </div>
        <PressError targets={targets} />
      </div>
    </form>
  )
}

export function Section({
  node,
  children,
}: {
  node: SurfaceNode
  children: React.ReactNode
}) {
  const title = asText(node.props.title)
  return (
    <section className="flex flex-col gap-2">
      {title ? (
        <h3 className="px-1 text-[13px] font-medium text-kumo-subtle">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  )
}

export function Split({ children }: { children: React.ReactNode }) {
  const { placement } = useSurface()
  return (
    <div
      className={`grid gap-3 ${placement === "thread" ? "sm:grid-cols-2" : ""}`}
    >
      {children}
    </div>
  )
}

