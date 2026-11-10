import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { Select } from "@cloudflare/kumo/components/select"
import { Checkbox } from "@cloudflare/kumo/components/checkbox"
import { CodeBlock } from "@/components/code-block"
import { FIELD, GROUP_LIST, Group, Row } from "@/components/group"
import { CaretDownIcon, MagnifyingGlassIcon } from "@/components/icons"
import { ShimmerText } from "@/components/shimmer-text"
import { SlidingTabs } from "@/components/sliding-tabs"
import { useHub } from "@/lib/hub-context"
import type { SkillCandidate, SkillPreview } from "@/lib/types"

type Scope = "bot" | "all"

const SCOPES: { value: Scope; label: string }[] = [
  { value: "bot", label: "This bot" },
  { value: "all", label: "All bots" },
]

/** Past this many skills the list gets a search field. */
const SEARCH_FROM = 7

/** Where a source can be read in full, pinned to what is being reviewed. */
function sourceLink({ source, version }: SkillPreview) {
  if (source.startsWith("https://")) return source
  return `https://github.com/${source}${version ? `/tree/${version}` : ""}`
}

function sourceLabel(source: string) {
  return source.replace(/^https:\/\//, "")
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** The exact text a bot will read, and the files that come with it. */
function SkillDetails({
  skill,
  className,
}: {
  skill: SkillCandidate
  className?: string
}) {
  return (
    <>
      <CodeBlock
        code={skill.instructions}
        lang="markdown"
        className={`rounded-xl bg-kumo-tint p-3 ${className ?? ""}`}
      />
      {skill.files.length > 0 ? (
        <ul className="mt-3 space-y-0.5 font-mono text-xs text-kumo-subtle">
          {skill.files.map((file) => (
            <li key={file.path} className="truncate">
              {file.path}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

/** A lone skill's instructions, folded until the user wants them. */
function SkillContents({ skill }: { skill: SkillCandidate }) {
  const [open, setOpen] = useState(false)
  const files = skill.files.length
  return (
    <li
      className="t-acc border-t border-kumo-line first:border-t-0"
      data-open={open}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-14 w-full items-center gap-3 py-3 pr-4 pl-4 text-left outline-none hover:bg-(--fill-hover) focus-visible:bg-(--fill-hover)"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-kumo-default">
          Instructions
        </span>
        {files > 0 ? (
          <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
            {plural(files, "file")}
          </span>
        ) : null}
        <span className="t-acc-chevron shrink-0 text-kumo-subtle">
          <CaretDownIcon size={14} />
        </span>
      </button>
      <div className="t-acc-panel grid-cols-[minmax(0,1fr)]">
        <div className="t-acc-panel-inner">
          <div className="px-4 pb-4">
            <SkillDetails skill={skill} className="max-h-72" />
          </div>
        </div>
      </div>
    </li>
  )
}

/**
 * One skill in a list. The box chooses it; the rest of the row opens its
 * instructions, so reading one never changes what is chosen, and each stays
 * open while the user moves on to the next.
 */
function SkillRow({
  skill,
  checked,
  onCheckedChange,
}: {
  skill: SkillCandidate
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <li
      className="t-acc border-t border-kumo-line first:border-t-0"
      data-open={open}
    >
      {/* Sticks while its instructions scroll, so closing them stays a tap away. */}
      <div className={open ? "sticky top-0 z-10 bg-kumo-base" : undefined}>
        <div className="flex items-start hover:bg-(--fill-hover)">
          <label className="flex shrink-0 cursor-pointer py-3.5 pr-3 pl-4">
            <Checkbox
              aria-label={`Choose ${skill.name}`}
              checked={checked}
              onCheckedChange={onCheckedChange}
            />
          </label>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-start gap-3 py-3 pr-4 text-left outline-none focus-visible:underline"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-kumo-default">
                {skill.name}
              </span>
              <span className="mt-0.5 line-clamp-2 text-xs text-pretty text-kumo-subtle">
                {skill.description}
              </span>
            </span>
            <span className="t-acc-chevron mt-0.5 shrink-0 text-kumo-subtle">
              <CaretDownIcon size={14} />
            </span>
          </button>
        </div>
      </div>
      <div className="t-acc-panel grid-cols-[minmax(0,1fr)]">
        <div className="t-acc-panel-inner">
          <div className="px-4 pt-1 pb-4">
            <SkillDetails skill={skill} />
          </div>
        </div>
      </div>
    </li>
  )
}

/** The skills in a repo, in their own scroller that shows when there is more. */
function SkillList({
  skills,
  selected,
  onSelected,
}: {
  skills: SkillCandidate[]
  selected: Set<string>
  onSelected: (selected: Set<string>) => void
}) {
  const [query, setQuery] = useState("")
  const [more, setMore] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLUListElement>(null)

  const search = query.trim().toLowerCase()
  const shown = skills.filter(
    (s) =>
      s.name.includes(search) || s.description.toLowerCase().includes(search)
  )
  const allShown = shown.length > 0 && shown.every((s) => selected.has(s.name))

  function measure() {
    const el = scroller.current
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }

  // Opening a row or searching changes the height with no scroll event.
  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [])

  function choose(names: string[], checked: boolean) {
    const next = new Set(selected)
    for (const name of names) {
      if (checked) next.add(name)
      else next.delete(name)
    }
    onSelected(next)
  }

  return (
    <Group
      title={plural(skills.length, "skill")}
      action={
        <button
          type="button"
          disabled={shown.length === 0}
          onClick={() =>
            choose(
              shown.map((s) => s.name),
              !allShown
            )
          }
          className="pressable h-7 rounded-full px-2.5 text-xs text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:opacity-50"
        >
          {allShown ? "Clear" : "Select all"}
        </button>
      }
    >
      {skills.length >= SEARCH_FROM ? (
        <li className="flex h-11 items-center gap-3 border-b border-kumo-line pr-4 pl-4 text-kumo-subtle">
          <MagnifyingGlassIcon size={16} className="shrink-0" />
          <input
            aria-label="Search skills"
            placeholder="Search"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={FIELD}
          />
        </li>
      ) : null}
      <li>
        <div
          ref={scroller}
          onScroll={measure}
          data-more={more}
          className="scroll-fade max-h-[21rem] overflow-y-auto overscroll-contain"
        >
          <ul ref={content}>
            {shown.map((skill) => (
              <SkillRow
                key={skill.name}
                skill={skill}
                checked={selected.has(skill.name)}
                onCheckedChange={(checked) => choose([skill.name], checked)}
              />
            ))}
            {shown.length === 0 ? (
              <li className="flex min-h-14 items-center px-4 text-sm text-kumo-subtle">
                No skills match
              </li>
            ) : null}
          </ul>
        </div>
      </li>
    </Group>
  )
}

/**
 * Read a skill, choose who gets it, install it. The install_skill card in
 * chat and a bot's settings both use this. Installing runs over the user's
 * own socket, so a bot can ask for a skill but never add one.
 */
export function SkillInstall({
  source,
  botId,
  forAllBots,
  onInstalled,
  onCancel,
}: {
  /** What the user pasted. */
  source: string
  /** The bot it is for. Without one (account settings), the user picks. */
  botId?: string
  forAllBots?: boolean
  onInstalled: () => void
  onCancel: () => void
}) {
  const { previewSkill, installSkills, state: hubState } = useHub()
  const [preview, setPreview] = useState<SkillPreview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<Scope>(forAllBots ? "all" : "bot")
  // In account settings: "all", or the id of the one bot that gets it.
  const [target, setTarget] = useState("all")
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A new function on every hub update: reading again would reset the choice.
  const read = useRef(previewSkill)
  read.current = previewSkill

  useEffect(() => {
    let cancelled = false
    read.current(source).then(
      (found) => {
        if (cancelled) return
        setPreview(found)
        // A list starts empty: nothing the user did not ask for gets in.
        if (found.named || found.skills.length === 1) {
          setSelected(new Set(found.skills.map((s) => s.name)))
        }
        if (found.global) setScope("all")
      },
      (err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Could not read that.")
      }
    )
    return () => {
      cancelled = true
    }
  }, [source])

  const skills = preview?.skills ?? []
  const lone = skills.length === 1 ? skills[0] : null
  const chosen = skills.filter((s) => selected.has(s.name))
  const left = chosen.reduce((n, s) => n + s.skipped.length, 0)

  async function install() {
    if (!preview || chosen.length === 0) return
    setInstalling(true)
    setError(null)
    try {
      await installSkills({
        source: preview.source,
        version: preview.version,
        skills: chosen.map(({ name, digest }) => ({ name, digest })),
        scope: botId ? (scope === "all" ? "all" : botId) : target,
      })
      onInstalled()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install it.")
      setInstalling(false)
    }
  }

  return (
    <div>
      <p className="truncate text-[15px] font-semibold text-kumo-default">
        {lone
          ? `Install ${lone.name}?`
          : skills.length > 0
            ? "Install skills?"
            : "Install a skill?"}
      </p>
      {!preview && !error ? (
        <ShimmerText
          text="Reading the skill…"
          className="mt-1 block text-[15px]"
        />
      ) : null}
      {preview ? (
        <>
          {lone ? (
            <p className="mt-1 line-clamp-3 text-[15px] text-pretty text-kumo-default">
              {lone.description}
            </p>
          ) : null}
          <a
            href={sourceLink(preview)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate text-xs text-kumo-subtle outline-none hover:text-kumo-default focus-visible:underline"
          >
            {sourceLabel(preview.source)}
            {preview.version ? ` · ${preview.version.slice(0, 7)}` : ""}
          </a>
          {lone ? null : (
            <div className="mt-3">
              <SkillList
                skills={skills}
                selected={selected}
                onSelected={setSelected}
              />
            </div>
          )}
          <ul className={`mt-3 ${GROUP_LIST}`}>
            {lone ? <SkillContents skill={lone} /> : null}
            <Row label="Who gets it">
              {botId ? (
                <SlidingTabs
                  tabs={SCOPES}
                  value={scope}
                  onValueChange={setScope}
                  className="shrink-0"
                />
              ) : (
                <Select
                  aria-label="Who gets it"
                  size="sm"
                  className="w-44 shrink-0"
                  value={target}
                  items={{
                    all: "All bots",
                    ...Object.fromEntries(
                      hubState.bots.map((b) => [b.id, b.name])
                    ),
                  }}
                  onValueChange={(value) => value && setTarget(String(value))}
                />
              )}
            </Row>
          </ul>
          <p className="mt-2 px-1.5 text-xs text-pretty text-kumo-subtle">
            Bots follow a skill's instructions, so only install ones you trust.
            {left > 0
              ? ` Leaves out ${plural(left, "binary or large file")}.`
              : ""}
          </p>
          {chosen
            .filter((s) => s.replaces)
            .map((s) => (
              <p
                key={s.name}
                className="mt-1 px-1.5 text-xs text-pretty text-kumo-danger"
              >
                Replaces {s.name} from {sourceLabel(s.replaces!)}.
              </p>
            ))}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-pretty text-kumo-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        {preview ? (
          <Button
            variant="primary"
            className="btn-ink rounded-full tabular-nums"
            loading={installing}
            disabled={chosen.length === 0}
            onClick={() => void install()}
          >
            {lone || chosen.length === 0
              ? "Install"
              : `Install ${plural(chosen.length, "skill")}`}
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="rounded-full"
          disabled={installing}
          onClick={onCancel}
        >
          Not now
        </Button>
      </div>
    </div>
  )
}
