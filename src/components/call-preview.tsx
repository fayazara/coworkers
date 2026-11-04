import { useState } from "react"
import type { ReactNode } from "react"
import {
  CaretDownIcon,
  CheckIcon,
  EnvelopeSimpleIcon,
  FileEditIcon,
  ListBulletsIcon,
  TerminalIcon,
  WarningIcon,
} from "@/components/icons"
import { CodeBlock } from "@/components/code-block"
import { EditView, PatchView } from "@/components/diff-view"
import { genericRows, isEmptyPreview, previewOf } from "@/lib/call-preview"
import type { CallPreview, PreviewRow } from "@/lib/call-preview"

/**
 * A tool call's arguments for people: an email looks like an email, a
 * command like a command, anything else a short list of labeled fields. The
 * raw arguments stay one click away under "Show details".
 */
export function CallPreviewView({
  name,
  input,
  compact = false,
}: {
  name: string
  input: Record<string, unknown>
  compact?: boolean
}) {
  return <PreviewView preview={previewOf(name, input)} compact={compact} />
}

/**
 * Arguments held as JSON text (a script's paused call, a Desk card): shown
 * as a preview when they parse, as the text when they do not.
 */
export function ArgsView({
  json,
  tool = "",
  compact = false,
}: {
  json: string
  tool?: string
  compact?: boolean
}) {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return <TechnicalDetails data={json} label="Show details" />
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return <TechnicalDetails data={json} label="Show details" />
  }
  return (
    <CallPreviewView
      name={tool}
      input={parsed as Record<string, unknown>}
      compact={compact}
    />
  )
}

// The border is an overlay on top of the content: an outline or inset shadow
// on the frame itself is painted under a diff's own layers and disappears.
const FRAME =
  "relative overflow-hidden rounded-xl bg-kumo-base after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--color-kumo-line)]"
const DIVIDER = "border-t border-kumo-line"

/** The small heading every preview opens with: what kind of thing this is. */
function Header({
  icon,
  children,
  pad,
  danger = false,
}: {
  icon: ReactNode
  children: ReactNode
  pad: string
  danger?: boolean
}) {
  return (
    <p
      className={`flex items-center gap-1.5 text-[13px] font-medium ${danger ? "text-kumo-danger" : "text-kumo-subtle"} ${pad} py-3`}
    >
      {icon}
      {children}
    </p>
  )
}

/** A labeled line. Long values stack under their label. */
function Line({
  label,
  children,
  stacked = false,
  pad,
}: {
  label: string
  children: ReactNode
  stacked?: boolean
  pad: string
}) {
  return (
    <div
      className={`${DIVIDER} ${pad} py-2.5 ${stacked ? "" : "flex items-baseline gap-3"}`}
    >
      <span
        className={`text-[13px] text-kumo-subtle ${stacked ? "mb-1 block" : "w-6 shrink-0"}`}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Pills({ people }: { people: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((person) => (
        <span
          key={person}
          title={person}
          className="inline-flex max-w-full items-center rounded-full bg-kumo-tint px-2.5 py-0.5 text-[13px] text-kumo-default"
        >
          <span className="truncate">{person}</span>
        </span>
      ))}
    </div>
  )
}

/** Mono text on a quiet panel: commands and file contents. */
function Mono({
  children,
  pad,
  prompt = false,
  max = "max-h-48",
}: {
  children: string
  pad: string
  prompt?: boolean
  max?: string
}) {
  return (
    <div className={`${DIVIDER} bg-kumo-tint/60 ${pad} py-3`}>
      <p
        className={`${max} overflow-auto font-mono text-[13px] leading-[1.6] break-words whitespace-pre-wrap text-kumo-default`}
      >
        {prompt ? (
          <span className="text-kumo-subtle select-none">$ </span>
        ) : null}
        {children}
      </p>
    </div>
  )
}

function Frame({
  children,
  footer,
}: {
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className={FRAME}>
      {children}
      {footer}
    </div>
  )
}

/**
 * A call's outcome as the last row of its preview: "Sent" with a tick, or
 * what went wrong. Rows after it (a result's fields) share the frame.
 */
export function Outcome({
  tone,
  children,
  compact = false,
}: {
  tone: "ok" | "warn"
  children: ReactNode
  compact?: boolean
}) {
  return (
    <p
      className={`${DIVIDER} flex items-start gap-1.5 ${compact ? "px-3" : "px-4"} py-2.5 text-[13px] leading-[1.5] ${
        tone === "ok" ? "text-kumo-subtle" : "text-kumo-warning"
      }`}
    >
      <span className="mt-0.5 shrink-0">
        {tone === "ok" ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
      </span>
      <span className="min-w-0 break-words whitespace-pre-wrap">
        {children}
      </span>
    </p>
  )
}

/** A result's fields or text, as the closing rows of a preview. */
export function ResultRows({
  data,
  compact = false,
}: {
  data: Record<string, unknown> | string
  compact?: boolean
}) {
  const pad = compact ? "px-3" : "px-4"
  const band = (
    <p
      className={`${DIVIDER} bg-kumo-tint/60 ${pad} py-1.5 text-[13px] font-medium text-kumo-subtle`}
    >
      Result
    </p>
  )
  if (typeof data === "string") {
    return (
      <>
        {band}
        <div className={`${DIVIDER} ${pad} py-3`}>
          <p className="max-h-48 overflow-auto font-mono text-[13px] leading-[1.6] break-words whitespace-pre-wrap text-kumo-subtle">
            {data}
          </p>
        </div>
      </>
    )
  }
  const { rows, extra } = genericRows(data)
  return (
    <>
      {band}
      {rows.map((row) => (
        <FieldLine
          key={row.label}
          row={row}
          first={false}
          pad={pad}
          text="text-[13px]"
        />
      ))}
      {extra ? <TechnicalDetails data={extra} pad={pad} /> : null}
    </>
  )
}

export function PreviewView({
  preview,
  compact = false,
  heading,
  footer,
}: {
  preview: CallPreview
  compact?: boolean
  /** A title for a plain list of fields, which has none of its own. */
  heading?: string
  /** Rows after the preview, inside its frame. */
  footer?: ReactNode
}) {
  if (isEmptyPreview(preview) && !footer) return null
  const pad = compact ? "px-3" : "px-4"
  const text = compact ? "text-[13px]" : "text-[15px]"

  if (preview.kind === "email") {
    return (
      <Frame footer={footer}>
        <Header icon={<EnvelopeSimpleIcon size={14} />} pad={pad}>
          {preview.inReplyTo ? "Reply" : "Email"}
        </Header>
        {preview.to.length ? (
          <Line label="To" pad={pad}>
            <Pills people={preview.to} />
          </Line>
        ) : null}
        {preview.cc.length ? (
          <Line label="Cc" pad={pad}>
            <Pills people={preview.cc} />
          </Line>
        ) : null}
        {preview.inReplyTo ? (
          <Line label="Re" pad={pad}>
            <p className={`${text} break-words text-kumo-default`}>
              {preview.inReplyTo}
            </p>
          </Line>
        ) : null}
        {preview.subject ? (
          <div className={`${DIVIDER} ${pad} py-2.5`}>
            <p
              className={`${text} font-semibold text-balance text-kumo-default`}
            >
              {preview.subject}
            </p>
          </div>
        ) : null}
        {preview.body ? (
          <div className={`${DIVIDER} ${pad} py-3.5`}>
            <p
              className={`${compact ? "max-h-56" : "max-h-80"} overflow-auto ${text} leading-[1.6] text-pretty break-words whitespace-pre-wrap text-kumo-default`}
            >
              {preview.body}
            </p>
          </div>
        ) : null}
        {preview.extra ? (
          <TechnicalDetails data={preview.extra} pad={pad} />
        ) : null}
      </Frame>
    )
  }

  if (preview.kind === "command") {
    return (
      <Frame footer={footer}>
        <Header icon={<TerminalIcon size={14} />} pad={pad}>
          Run a command
        </Header>
        <Mono pad={pad} prompt max="max-h-40">
          {preview.command}
        </Mono>
      </Frame>
    )
  }

  if (preview.kind === "edit") {
    return (
      <Frame footer={footer}>
        <Header icon={<FileEditIcon size={14} />} pad={pad}>
          {preview.patch ? "Edited" : "Edit"} {preview.path}
        </Header>
        {preview.patch ? (
          <div className={DIVIDER}>
            <PatchView patch={preview.patch} />
          </div>
        ) : (
          preview.edits.map((edit, i) => (
            <div key={i} className={DIVIDER}>
              <EditView
                path={preview.path}
                oldText={edit.oldText}
                newText={edit.newText}
              />
            </div>
          ))
        )}
      </Frame>
    )
  }

  if (preview.kind === "file") {
    return (
      <Frame footer={footer}>
        <Header
          icon={<FileEditIcon size={14} />}
          pad={pad}
          danger={preview.verb === "Delete"}
        >
          {preview.verb} a file
        </Header>
        <div className={`${DIVIDER} ${pad} py-2.5`}>
          <p className={`${text} font-medium break-all text-kumo-default`}>
            {preview.path}
          </p>
        </div>
        {preview.content ? <Mono pad={pad}>{preview.content}</Mono> : null}
      </Frame>
    )
  }

  return (
    <Frame footer={footer}>
      {heading ? (
        <Header icon={<ListBulletsIcon size={14} />} pad={pad}>
          {heading}
        </Header>
      ) : null}
      {preview.rows
        // A value the heading already says (a page's address) is not repeated.
        .filter((row) => !(heading && row.value && heading.includes(row.value)))
        .map((row, index) => (
          <FieldLine
            key={row.label}
            row={row}
            first={index === 0 && !heading}
            pad={pad}
            text={text}
          />
        ))}
      {preview.extra ? (
        <TechnicalDetails data={preview.extra} pad={pad} />
      ) : null}
    </Frame>
  )
}

function FieldLine({
  row,
  first,
  pad,
  text,
}: {
  row: PreviewRow
  first: boolean
  pad: string
  text: string
}) {
  const value = (
    <p
      className={`${text} leading-[1.6] text-pretty break-words whitespace-pre-wrap text-kumo-default ${
        row.long ? "max-h-48 overflow-auto" : ""
      }`}
    >
      {row.value}
    </p>
  )
  return (
    <div
      className={`${first ? "" : DIVIDER} ${pad} py-2.5 ${row.long ? "" : "flex items-baseline gap-3"}`}
    >
      <span
        className={`text-[13px] text-kumo-subtle ${row.long ? "mb-1 block" : "w-28 shrink-0"}`}
      >
        {row.label}
      </span>
      <div className="min-w-0 flex-1">{value}</div>
    </div>
  )
}

/** Whatever has no plain-language form, folded away until asked for. */
export function TechnicalDetails({
  data,
  label = "Show details",
  pad,
}: {
  data: unknown
  label?: string
  /** Inside a preview: a footer row with the preview's own padding. */
  pad?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`t-acc ${pad ? `${DIVIDER} ${pad} py-2.5` : "mt-3"}`}
      data-open={open}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[13px] font-medium text-kumo-subtle outline-none hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
      >
        {open ? "Hide details" : label}
        <span className="t-acc-chevron">
          <CaretDownIcon size={14} />
        </span>
      </button>
      <div className="t-acc-panel">
        <div className="t-acc-panel-inner">
          <CodeBlock
            code={
              typeof data === "string" ? data : JSON.stringify(data, null, 2)
            }
            lang="json"
            className="mt-2 max-h-56 rounded-lg bg-kumo-tint p-3 text-xs"
          />
        </div>
      </div>
    </div>
  )
}
