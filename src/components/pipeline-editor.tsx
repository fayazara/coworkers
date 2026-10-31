import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Select } from "@cloudflare/kumo/components/select"
import { BotAvatar } from "@/components/bot-avatar"
import {
  FIELD,
  Group,
  PILL_INPUT,
  Row,
  RowAction,
  SaveBar,
} from "@/components/group"
import { ArrowUpIcon, CheckIcon, PlusIcon, TrashIcon } from "@/components/icons"
import { describeCron, nextRun, parseCron } from "@/lib/cron"
import { useHub } from "@/lib/hub-context"
import {
  SCHEDULE_LABELS,
  WEEKDAYS,
  fromCron,
  toCron,
} from "@/lib/pipeline-schedule"
import type { ScheduleChoice, ScheduleKind } from "@/lib/pipeline-schedule"
import type { Pipeline, PipelineStep } from "@/lib/types"

const MAX_STEPS = 10

type DraftStep = PipelineStep & { key: string }

const WEEKDAY_LABELS = Object.fromEntries(
  WEEKDAYS.map((d, i) => [String(i), d])
)

function withKeys(steps: PipelineStep[]): DraftStep[] {
  return steps.map((s) => ({ ...s, key: crypto.randomUUID() }))
}

function withoutKeys(steps: DraftStep[]): PipelineStep[] {
  return steps.map(({ key: _key, ...s }) => s)
}

/** One step: which bot and what it does, or a stop for the user's OK. */
function StepCard({
  step,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  step: DraftStep
  index: number
  count: number
  onChange: (step: DraftStep) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}) {
  const { state } = useHub()
  const bots = state.bots
  const botItems = useMemo(
    () => Object.fromEntries(bots.map((b) => [b.id, b.name])),
    [bots]
  )
  const bot =
    step.kind === "bot" ? bots.find((b) => b.id === step.botId) : undefined

  return (
    <div className="rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06]">
      <div className="flex items-center gap-1.5 py-2.5 pr-2 pl-3 md:gap-3 md:pl-4">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-xs font-medium text-kumo-subtle tabular-nums">
          {index + 1}
        </span>
        {step.kind === "bot" ? (
          <>
            {bot ? <BotAvatar avatar={bot.avatar} size={24} /> : null}
            <Select
              aria-label={`Bot for step ${index + 1}`}
              size="sm"
              className="w-48 min-w-0 shrink-[100]"
              placeholder={bots.length ? "Pick a bot" : "No bots yet"}
              value={bot ? step.botId : null}
              items={botItems}
              onValueChange={(value) =>
                value && onChange({ ...step, botId: String(value) })
              }
            />
          </>
        ) : (
          <span className="flex items-center gap-2 text-sm font-medium text-kumo-default">
            <CheckIcon size={16} className="text-kumo-subtle" />
            Your approval
          </span>
        )}
        <span className="flex-1" />
        <RowAction
          label="Move up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon size={16} />
        </RowAction>
        <RowAction
          label="Move down"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowUpIcon size={16} className="rotate-180" />
        </RowAction>
        <RowAction label="Remove step" danger onClick={onRemove}>
          <TrashIcon size={16} />
        </RowAction>
      </div>
      <div className="border-t border-kumo-line px-4 py-3">
        {step.kind === "bot" ? (
          <textarea
            aria-label={`What step ${index + 1} does`}
            value={step.instructions}
            onChange={(e) =>
              onChange({ ...step, instructions: e.target.value })
            }
            placeholder={
              index === 0
                ? "Find this week's top 5 Hacker News stories about AI agents, with links and points."
                : "Turn the previous step's notes into a newsletter draft in my voice."
            }
            className={`${FIELD} field-sizing-content min-h-12 resize-none leading-6 text-pretty`}
          />
        ) : (
          <textarea
            aria-label={`Note for step ${index + 1}`}
            value={step.note}
            onChange={(e) => onChange({ ...step, note: e.target.value })}
            placeholder="What to check before it carries on (optional)"
            className={`${FIELD} field-sizing-content min-h-6 resize-none leading-6 text-pretty`}
          />
        )}
      </div>
    </div>
  )
}

function ScheduleGroup({
  value,
  onChange,
}: {
  value: ScheduleChoice
  onChange: (next: ScheduleChoice) => void
}) {
  const cron = toCron(value)
  const parsed = cron ? parseCron(cron) : null
  const next = parsed ? nextRun(parsed, Date.now()) : null
  const hint =
    value.kind === "manual"
      ? "Runs only when you press Run. Scheduled runs work in the background, so steps cannot ask you for approval."
      : value.kind === "custom" && cron && !parsed
        ? "That is not a 5-field cron expression."
        : next
          ? `${(parsed && describeCron(parsed)) ?? "Custom"}. Next run ${new Date(next).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
          : undefined

  return (
    <Group title="Schedule" hint={hint}>
      <Row label="Runs">
        <Select
          aria-label="Schedule"
          size="sm"
          className="w-48 shrink-0"
          value={value.kind}
          items={SCHEDULE_LABELS}
          onValueChange={(kind) =>
            kind && onChange({ ...value, kind: kind as ScheduleKind })
          }
        />
      </Row>
      {value.kind === "weekly" ? (
        <Row label="On">
          <Select
            aria-label="Day"
            size="sm"
            className="w-36 shrink-0"
            value={String(value.day)}
            items={WEEKDAY_LABELS}
            onValueChange={(day) =>
              day && onChange({ ...value, day: Number(day) })
            }
          />
        </Row>
      ) : null}
      {value.kind === "daily" ||
      value.kind === "weekdays" ||
      value.kind === "weekly" ? (
        <Row label="At">
          <input
            type="time"
            aria-label="Time"
            value={value.time}
            onChange={(e) =>
              e.target.value && onChange({ ...value, time: e.target.value })
            }
            className={PILL_INPUT}
          />
        </Row>
      ) : null}
      {value.kind === "custom" ? (
        <Row label="Cron">
          <input
            aria-label="Cron expression"
            value={value.cron}
            placeholder="0 9 * * 1-5"
            spellCheck={false}
            onChange={(e) => onChange({ ...value, cron: e.target.value })}
            className={`${PILL_INPUT} w-40 font-mono`}
          />
        </Row>
      ) : null}
    </Group>
  )
}

/**
 * Create or change a pipeline. `pipeline` is null for a new one.
 * `onDirtyChange` hears when there are unsaved changes, so runs can wait.
 */
export function PipelineEditor({
  pipeline,
  onDirtyChange,
}: {
  pipeline: Pipeline | null
  onDirtyChange?: (dirty: boolean) => void
}) {
  const hub = useHub()
  const navigate = useNavigate()
  const [name, setName] = useState(pipeline?.name ?? "")
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    pipeline
      ? withKeys(pipeline.steps)
      : withKeys([{ kind: "bot", botId: "", instructions: "" }])
  )
  const [schedule, setSchedule] = useState(() =>
    fromCron(pipeline?.cron ?? null)
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draft = { name, steps: withoutKeys(steps), cron: toCron(schedule) }
  const dirty =
    !pipeline ||
    JSON.stringify(draft) !==
      JSON.stringify({
        name: pipeline.name,
        steps: pipeline.steps,
        cron: pipeline.cron,
      })

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  function reset() {
    if (!pipeline) return
    setName(pipeline.name)
    setSteps(withKeys(pipeline.steps))
    setSchedule(fromCron(pipeline.cron))
    setError(null)
  }

  function update(index: number, step: DraftStep) {
    setSteps((all) => all.map((s, i) => (i === index ? step : s)))
  }

  function move(index: number, by: -1 | 1) {
    setSteps((all) => {
      const next = [...all]
      const [step] = next.splice(index, 1)
      next.splice(index + by, 0, step)
      return next
    })
  }

  function add(kind: PipelineStep["kind"]) {
    const step: PipelineStep =
      kind === "bot"
        ? { kind: "bot", botId: "", instructions: "" }
        : { kind: "approval", note: "" }
    setSteps((all) => [...all, { ...step, key: crypto.randomUUID() }])
  }

  async function save() {
    if (!hub.pipelines) return
    setSaving(true)
    setError(null)
    try {
      const saved = await hub.pipelines.save({
        ...(pipeline ? { id: pipeline.id } : {}),
        ...draft,
      })
      if (!pipeline) {
        await navigate({
          to: "/pipelines/$pipelineId",
          params: { pipelineId: saved.id },
          replace: true,
        })
      }
    } catch (err) {
      // RPC errors arrive as "Error: <message>".
      setError(
        (err instanceof Error ? err.message : String(err)).replace(
          /^Error: /,
          ""
        )
      )
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!pipeline || !hub.pipelines) return
    if (!window.confirm(`Delete "${pipeline.name}" and its run history?`)) {
      return
    }
    await hub.pipelines.remove(pipeline.id)
    await navigate({ to: "/pipelines", replace: true })
  }

  return (
    <div className="space-y-8">
      <Group title="Name">
        <Row>
          <input
            value={name}
            maxLength={60}
            aria-label="Name"
            placeholder="Weekly newsletter"
            onChange={(e) => setName(e.target.value)}
            className={`${FIELD} h-8`}
          />
        </Row>
      </Group>

      <section className="space-y-2">
        <div className="flex min-h-6 items-center justify-between gap-2 px-1.5">
          <h3 className="text-sm font-medium text-kumo-default">Steps</h3>
          <span className="text-xs text-kumo-subtle">
            Each bot gets the previous result as its input
          </span>
        </div>
        <ol>
          {steps.map((step, i) => (
            <li key={step.key}>
              {i > 0 ? (
                <span
                  aria-hidden
                  className="ml-[27px] block h-4 w-px bg-kumo-line"
                />
              ) : null}
              <StepCard
                step={step}
                index={i}
                count={steps.length}
                onChange={(next) => update(i, next)}
                onMove={(by) => move(i, by)}
                onRemove={() =>
                  setSteps((all) => all.filter((_, j) => j !== i))
                }
              />
            </li>
          ))}
        </ol>
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            icon={<PlusIcon />}
            disabled={steps.length >= MAX_STEPS}
            onClick={() => add("bot")}
          >
            Bot step
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            icon={<CheckIcon />}
            disabled={steps.length >= MAX_STEPS || steps.length === 0}
            onClick={() => add("approval")}
          >
            Approval
          </Button>
        </div>
      </section>

      <ScheduleGroup value={schedule} onChange={setSchedule} />

      <div className="space-y-2">
        {error ? (
          <p className="px-1.5 text-sm text-pretty text-kumo-danger">{error}</p>
        ) : null}
        <SaveBar
          dirty={dirty}
          saving={saving}
          disabled={!hub.pipelines || !name.trim()}
          saveLabel={pipeline ? "Save" : "Create pipeline"}
          onSave={() => void save()}
          onReset={() =>
            pipeline ? reset() : void navigate({ to: "/pipelines" })
          }
        />
      </div>

      {pipeline ? (
        <>
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full text-kumo-danger"
              icon={<TrashIcon />}
              onClick={() => void remove()}
            >
              Delete pipeline
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
