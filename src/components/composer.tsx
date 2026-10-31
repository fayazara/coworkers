import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import {
  ArrowUpIcon,
  ChalkboardTeacherIcon,
  FileIcon,
  FilePdfIcon,
  FileZipIcon,
  ImageIcon,
  PaperclipIcon,
  PlusIcon,
  StopIcon,
  WarningIcon,
  XIcon,
} from "@/components/icons"
import { BotAvatar } from "@/components/bot-avatar"
import { linkMentions, mentionQuery } from "@/lib/bot-links"
import type { BotSummary } from "@/lib/types"

const TEACH_PROMPT = "I want to show you how to "
/** Tallest the message field grows before it scrolls. */
const FIELD_MAX = 200
/** Bots the @ picker lists at once. */
const MAX_MENTION_OPTIONS = 6

export type MentionBot = Pick<BotSummary, "id" | "name" | "avatar">

interface ComposerProps {
  botName: string
  disabled?: boolean
  /** A turn is running: the send button becomes a stop button. */
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
  /** Saves a file to the bot's inbox and returns its workspace path. */
  onAttach?: (file: File) => Promise<string>
  /** Other bots, for @mentions. Absent: no picker. */
  bots?: MentionBot[]
}

interface Attachment {
  id: string
  file: File
  /** Object URL for image thumbnails. */
  thumb?: string
  status: "uploading" | "ready" | "error"
  path?: string
  error?: string
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

function baseName(name: string) {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(0, dot) : name
}

const ARCHIVES = new Set(["zip", "gz", "tar", "tgz", "rar", "7z"])

/** Bots whose name matches what follows the @, names starting with it first. */
function matchBots(bots: MentionBot[], query: string) {
  // After a space only a longer name can still match ("Sales " → "Sales
  // Lead"). That also closes the list once a pick has added its space.
  if (/\s$/.test(query)) {
    const prefix = query.toLowerCase()
    return bots
      .filter((b) => b.name.toLowerCase().startsWith(prefix))
      .slice(0, MAX_MENTION_OPTIONS)
  }
  const q = query.trim().toLowerCase()
  const starts = (b: MentionBot) =>
    b.name.toLowerCase().startsWith(q) ||
    b.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(q))
  return bots
    .filter((b) => b.name.toLowerCase().includes(q))
    .sort((a, b) => Number(starts(b)) - Number(starts(a)))
    .slice(0, MAX_MENTION_OPTIONS)
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`
}

/** An icon for the file, and whether that icon already names the type. */
function kindOf(file: File) {
  const ext = extensionOf(file.name)
  if (ext === "pdf") {
    return {
      icon: <FilePdfIcon size={22} className="text-red-500" />,
      named: true,
    }
  }
  if (ARCHIVES.has(ext)) return { icon: <FileZipIcon size={22} />, named: true }
  if (file.type.startsWith("image/")) {
    return { icon: <ImageIcon size={22} />, named: false }
  }
  return { icon: <FileIcon size={22} />, named: false }
}

/** A file waiting to go out with the next message. */
function AttachmentCard({
  attachment,
  onRemove,
}: {
  attachment: Attachment
  onRemove: () => void
}) {
  const { file, thumb, status } = attachment
  const ext = extensionOf(file.name).toUpperCase() || "FILE"
  const kind = kindOf(file)
  // The PDF and archive icons already say what the file is.
  const caption = kind.named
    ? formatSize(file.size)
    : `${ext} · ${formatSize(file.size)}`

  function preview() {
    const url = thumb ?? URL.createObjectURL(file)
    window.open(url, "_blank", "noopener")
    if (!thumb) setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const failed = status === "error"
  const uploading = status === "uploading"
  const error = attachment.error ?? "Upload failed"

  const body = (
    <button
      type="button"
      onClick={preview}
      title={failed ? undefined : file.name}
      aria-label={
        failed
          ? `${file.name} didn't upload: ${error}`
          : uploading
            ? `${file.name}, uploading`
            : `${file.name}, ${ext}, preview`
      }
      className="composer-card-body"
    >
      {thumb && !failed ? (
        // A photo speaks for itself: no name over it.
        <>
          <img src={thumb} alt="" className="composer-card-img" />
          {uploading ? (
            <span className="composer-card-spinner">
              <Loader size="sm" />
            </span>
          ) : null}
        </>
      ) : (
        <>
          {/* Uploading and failed states take the file icon's place. */}
          <span
            className={`flex size-[22px] items-center ${failed ? "text-kumo-warning" : "text-kumo-subtle"}`}
          >
            {failed ? (
              <WarningIcon size={22} />
            ) : uploading ? (
              <Loader size="sm" />
            ) : (
              kind.icon
            )}
          </span>
          <span className="composer-card-label">
            <span className="truncate text-[13px] leading-[1.3] font-medium">
              {baseName(file.name)}
            </span>
            <span
              className={`truncate text-[11px] tabular-nums ${failed ? "text-kumo-warning" : "text-kumo-subtle"}`}
            >
              {failed ? "Didn't upload" : uploading ? "Uploading…" : caption}
            </span>
          </span>
        </>
      )}
    </button>
  )

  return (
    <li className="composer-card" data-status={status}>
      {failed ? <Tooltip content={error} render={body} /> : body}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="composer-card-remove"
      >
        <XIcon size={12} />
      </button>
    </li>
  )
}

/**
 * The message box: one row while it is empty, an island that grows to fit
 * longer messages and preview cards for attachments. Files can be picked,
 * pasted or dropped onto it.
 */
export function Composer({
  botName,
  disabled = false,
  busy,
  onSend,
  onStop,
  onAttach,
  bots,
}: ComposerProps) {
  const [text, setText] = useState("")
  const [caret, setCaret] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [multiline, setMultiline] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()

  // The @ picker: open while the text before the caret is "@" plus part of
  // a bot's name. Escape closes it until the next @.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  /** Bots picked from the list, so a shared name links to the one chosen. */
  const picked = useRef(new Map<string, string>())
  const mention = bots?.length ? mentionQuery(text, caret) : null
  const options =
    mention && dismissedAt !== mention.start
      ? matchBots(bots ?? [], mention.query)
      : []
  const picking = options.length > 0
  useEffect(() => setActive(0), [mention?.start, mention?.query])
  // Leaving the @ (deleting it, moving away) forgets an Escape.
  const inMention = mention !== null
  useEffect(() => {
    if (!inMention) setDismissedAt(null)
  }, [inMention])

  const uploading = attachments.some((a) => a.status === "uploading")
  const ready = attachments.filter((a) => a.status === "ready")
  const expanded = multiline || attachments.length > 0
  const canSend =
    !disabled && !uploading && (text.trim().length > 0 || ready.length > 0)
  const stopping = busy && !text.trim() && attachments.length === 0

  // Free thumbnails when the composer goes away.
  const thumbs = useRef(new Set<string>())
  useEffect(() => {
    const urls = thumbs.current
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  function dropThumb(a: Attachment) {
    if (!a.thumb) return
    URL.revokeObjectURL(a.thumb)
    thumbs.current.delete(a.thumb)
  }

  // Size the field to its text. In one-row mode, text that needs a second
  // line opens the island; it folds back once the field is empty.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = "auto"
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24
    const needed = el.scrollHeight
    if (!expanded && needed > lineHeight * 1.5 + 12) setMultiline(true)
    el.style.height = `${Math.min(needed, FIELD_MAX)}px`
  }, [text, expanded])

  useEffect(() => {
    if (!text) setMultiline(false)
  }, [text])

  // The island's height follows its content, so CSS can ease it.
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The +, field and send button change places when the island opens or
  // folds. Slide them from where they were instead of jumping (FLIP).
  const moving = useRef<Map<HTMLElement, DOMRect>>(new Map())
  useLayoutEffect(() => {
    const root = inner.current
    if (!root) return
    const parts = [...root.querySelectorAll<HTMLElement>("[data-flip]")]
    const before = moving.current
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const el of parts) {
        const was = before.get(el)
        if (!was) continue
        const now = el.getBoundingClientRect()
        const dx = was.left - now.left
        const dy = was.bottom - now.bottom
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 250, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        )
      }
    }
  }, [expanded])
  // Where everything sat after this render, for the next FLIP.
  useLayoutEffect(() => {
    const root = inner.current
    if (!root) return
    moving.current = new Map(
      [...root.querySelectorAll<HTMLElement>("[data-flip]")].map((el) => [
        el,
        el.getBoundingClientRect(),
      ])
    )
  })

  function submit() {
    if (!canSend) return
    const files = ready.length
      ? `\n\nAttached files: ${ready.map((a) => a.path).join(", ")}`
      : ""
    // Typed or picked, every @Name of another bot goes out as its link.
    const choices = (bots ?? []).filter(
      (b) => picked.current.get(b.name.toLowerCase()) === b.id
    )
    const body = bots?.length
      ? linkMentions(text.trim(), [...choices, ...bots])
      : text.trim()
    onSend((body + files).trim())
    attachments.forEach(dropThumb)
    setText("")
    setAttachments([])
    picked.current.clear()
  }

  function choose(bot: MentionBot) {
    if (!mention) return
    const after = text.slice(caret).replace(/^ /, "")
    const before = `${text.slice(0, mention.start)}@${bot.name} `
    picked.current.set(bot.name.toLowerCase(), bot.id)
    // Done with this @, whatever a late caret event says.
    setDismissedAt(mention.start)
    setText(before + after)
    setCaret(before.length)
    requestAnimationFrame(() => {
      const el = textarea.current
      if (!el) return
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }

  function attach(files: FileList | File[] | null) {
    if (!files || !onAttach || disabled) return
    for (const file of files) {
      const id = crypto.randomUUID()
      const thumb = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined
      if (thumb) thumbs.current.add(thumb)
      setAttachments((prev) => [
        ...prev,
        { id, file, thumb, status: "uploading" },
      ])
      onAttach(file).then(
        (path) =>
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: "ready", path } : a))
          ),
        (err: unknown) =>
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id
                ? {
                    ...a,
                    status: "error",
                    error: err instanceof Error ? err.message : "Upload failed",
                  }
                : a
            )
          )
      )
    }
    if (fileInput.current) fileInput.current.value = ""
  }

  function remove(id: string) {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.id === id)
      if (gone) dropThumb(gone)
      return prev.filter((a) => a.id !== id)
    })
    textarea.current?.focus()
  }

  return (
    <div className="relative mx-auto w-full max-w-[820px] px-4 pb-[max(1rem,var(--safe-bottom))] md:px-6">
      {picking ? (
        <ul
          id="composer-mentions"
          role="listbox"
          aria-label="Bots"
          className="absolute bottom-full left-4 z-10 mb-2 w-64 md:left-6 rounded-2xl bg-kumo-base p-1 shadow-[0_0_0_1px_var(--color-kumo-line),0_8px_24px_oklch(0_0_0/0.08)]"
        >
          {options.map((bot, i) => (
            <li
              key={bot.id}
              id={`composer-mention-${bot.id}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active || undefined}
              // Keep focus in the field, so the caret stays where it was.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(bot)
              }}
              onMouseEnter={() => setActive(i)}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-[14px] text-kumo-default data-active:bg-(--fill-hover)"
            >
              <BotAvatar avatar={bot.avatar} size={20} className="shrink-0" />
              <span className="truncate">{bot.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onDragOver={(e) => {
          if (!onAttach || !e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragging(false)
          }
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setDragging(false)
          attach(e.dataTransfer.files)
          textarea.current?.focus()
        }}
        className="composer"
        data-expanded={expanded}
        data-dragging={dragging || undefined}
        style={height ? { height } : undefined}
      >
        <div ref={inner} className="composer-grid">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => attach(e.target.files)}
          />
          {attachments.length > 0 ? (
            <ul className="composer-strip" aria-label="Attachments">
              {attachments.map((a) => (
                <AttachmentCard
                  key={a.id}
                  attachment={a}
                  onRemove={() => remove(a.id)}
                />
              ))}
            </ul>
          ) : null}
          <div className="composer-plus" data-flip>
            <DropdownMenu>
              <DropdownMenu.Trigger
                disabled={disabled}
                render={(props) => (
                  <button
                    {...props}
                    type="button"
                    aria-label="More"
                    disabled={disabled}
                    className="icon-btn is-filled"
                  >
                    <PlusIcon size={18} />
                  </button>
                )}
              />
              <DropdownMenu.Content side="top" align="start">
                <DropdownMenu.Item
                  icon={<PaperclipIcon />}
                  disabled={!onAttach}
                  onClick={() => fileInput.current?.click()}
                >
                  Attach a file
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  icon={<ChalkboardTeacherIcon />}
                  onClick={() => {
                    setText(TEACH_PROMPT)
                    // After the menu closes and returns focus to its trigger.
                    requestAnimationFrame(() => {
                      const el = textarea.current
                      if (!el) return
                      el.focus()
                      el.setSelectionRange(el.value.length, el.value.length)
                    })
                  }}
                >
                  Teach a task
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
          <textarea
            ref={textarea}
            rows={1}
            value={text}
            disabled={disabled}
            data-flip
            placeholder={
              attachments.length ? "Add a message" : `Message ${botName}`
            }
            aria-label={`Message ${botName}`}
            aria-autocomplete={bots?.length ? "list" : undefined}
            aria-controls={picking ? "composer-mentions" : undefined}
            aria-expanded={bots?.length ? picking : undefined}
            aria-activedescendant={
              picking ? `composer-mention-${options[active]?.id}` : undefined
            }
            onChange={(e) => {
              const { value, selectionStart } = e.target
              // A freshly typed @ opens the list, even where one was closed.
              if (
                value.length > text.length &&
                value[selectionStart - 1] === "@"
              ) {
                setDismissedAt(null)
              }
              setText(value)
              setCaret(selectionStart)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={(e) => {
              if (!onAttach || !e.clipboardData.files.length) return
              e.preventDefault()
              attach(e.clipboardData.files)
            }}
            onKeyDown={(e) => {
              if (picking && !e.nativeEvent.isComposing) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault()
                  const step = e.key === "ArrowDown" ? 1 : -1
                  setActive((active + step + options.length) % options.length)
                  return
                }
                if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
                  e.preventDefault()
                  choose(options[active] ?? options[0])
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  setDismissedAt(mention?.start ?? null)
                  return
                }
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                // A touch keyboard's return is a new line; send has a button.
                !matchMedia("(pointer: coarse)").matches
              ) {
                e.preventDefault()
                submit()
              }
            }}
            className="composer-field"
          />
          {/* One button that swaps between send and stop, so the icon can
              cross-fade instead of the whole control popping. */}
          <div className="composer-send" data-flip>
            <Button
              type={stopping ? "button" : "submit"}
              variant="primary"
              shape="circle"
              className="btn-ink"
              aria-label={stopping ? "Stop" : "Send"}
              disabled={!stopping && !canSend}
              onClick={stopping ? onStop : undefined}
              icon={
                <span className="t-icon-swap" data-state={stopping ? "b" : "a"}>
                  <ArrowUpIcon className="t-icon" data-icon="a" />
                  <StopIcon className="t-icon" data-icon="b" />
                </span>
              }
            />
          </div>
        </div>
      </form>
    </div>
  )
}
