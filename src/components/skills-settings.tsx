import { useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import {
  EmptyRow,
  FIELD,
  Group,
  Row,
  RowAction,
  SectionHeader,
} from "@/components/group"
import { BookOpenTextIcon, PlusIcon, TrashIcon } from "@/components/icons"
import { SkillInstall } from "@/components/skill-install"
import { useHub } from "@/lib/hub-context"
import type { InstalledSkill } from "@/lib/types"

/** "All bots", or the names of the bots that have it. */
function audience(skill: InstalledSkill, names: Map<string, string>) {
  if (!skill.bots) return "All bots"
  const bots = skill.bots.map((id) => names.get(id)).filter(Boolean)
  if (bots.length === 0) return "No bots"
  if (bots.length <= 2) return bots.join(" and ")
  return `${bots.slice(0, 2).join(", ")} and ${bots.length - 2} more`
}

function sourceLabel(source: string) {
  return source.replace(/^https:\/\//, "").replace(/^github\.com\//, "")
}

export function SkillsSettings() {
  const hub = useHub()
  const [draft, setDraft] = useState("")
  const [source, setSource] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const skills = hub.state.installedSkills ?? []
  const names = new Map(hub.state.bots.map((b) => [b.id, b.name]))

  function close() {
    setSource(null)
    setDraft("")
  }

  async function remove(name: string) {
    setRemoving(name)
    try {
      await hub.removeSkill(name)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Skills"
        description="Instructions your bots follow for a kind of task. Install one here for every bot or just one. What a bot learned by itself lives in that bot's settings."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) setSource(draft.trim())
        }}
        className="flex items-center gap-2"
      >
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-(--fill-hover) pr-1 pl-3.5 text-kumo-subtle focus-within:ring-2 focus-within:ring-kumo-focus">
          <PlusIcon size={16} className="shrink-0" />
          <input
            aria-label="Add a skill"
            placeholder="A GitHub repo, a site, or an npx skills add command"
            spellCheck={false}
            autoComplete="off"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setSource(null)
            }}
            className={`${FIELD} min-w-0 flex-1`}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          className="btn-ink shrink-0 rounded-full"
          disabled={!hub.live || !draft.trim() || source !== null}
        >
          Find
        </Button>
      </form>

      {source ? (
        <div className="rounded-2xl bg-kumo-tint p-4">
          <SkillInstall
            key={source}
            source={source}
            onInstalled={close}
            onCancel={close}
          />
        </div>
      ) : null}

      <Group
        title={`Installed${skills.length ? ` · ${skills.length}` : ""}`}
        hint="Bots follow a skill's instructions, so only install ones you trust."
      >
        {skills.length === 0 ? (
          <EmptyRow>No skills yet</EmptyRow>
        ) : (
          skills.map((skill) => (
            <Row
              key={skill.name}
              icon={<BookOpenTextIcon size={14} />}
              label={skill.name}
              detail={
                <>
                  <span className="line-clamp-2">{skill.description}</span>
                  <span className="mt-1 block truncate">
                    {audience(skill, names)} · {sourceLabel(skill.source)}
                  </span>
                </>
              }
            >
              <RowAction
                label={`Remove ${skill.name}`}
                danger
                disabled={!hub.live || removing === skill.name}
                onClick={() => void remove(skill.name)}
              >
                <TrashIcon size={16} />
              </RowAction>
            </Row>
          ))
        )}
      </Group>
    </div>
  )
}
