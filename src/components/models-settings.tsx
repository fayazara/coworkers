import { useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Group, Row } from "@/components/group"
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  WarningIcon,
} from "@/components/icons"
import { ModelPicker } from "@/components/model-picker"
import { useHub } from "@/lib/hub-context"
import { DEFAULT_MODEL_SETTINGS, PROVIDERS, providerOf } from "@/lib/models"
import type { ModelSettings, ModelTestResult } from "@/lib/models"

const GATEWAY_DASH = "https://dash.cloudflare.com/?to=/:account/ai/ai-gateway"

/** What to do about a failed test, by the gateway's error code. */
function remedy(
  result: Extract<ModelTestResult, { ok: false }>,
  model: string
) {
  const provider = providerOf(model)
  switch (result.code) {
    case "auth":
      return provider === "workers-ai"
        ? "The Worker could not authenticate with AI Gateway."
        : "No way to pay for it yet. Top up Unified Billing credits, or store a provider key on the gateway."
    case "not-found":
      return "The gateway does not know this model id. Check its spelling in the model catalog."
    case "rate-limit":
      return "Rate limited. Wait a moment and try again, or raise the gateway's limit."
    case "bad-request":
      return "The provider refused the request. If the gateway requires provider keys, add one."
    default:
      return "The model call failed."
  }
}

/** A test call's answer (or why it failed), under the model box. */
function TestResult({
  result,
  model,
}: {
  result: ModelTestResult
  model: string
}) {
  return (
    <div
      key={result.ms}
      className="model-test-result rounded-2xl px-3.5 py-2.5 text-sm text-pretty"
      data-ok={result.ok}
    >
      {result.ok ? (
        <p className="text-kumo-default">
          {result.reply}{" "}
          <span className="text-xs text-kumo-subtle tabular-nums">
            {(result.ms / 1000).toFixed(1)}s
          </span>
        </p>
      ) : (
        <div className="flex gap-2.5">
          <WarningIcon size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p>{remedy(result, model)}</p>
            <p className="mt-1 text-xs break-words opacity-80">
              {result.message}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

const LINK =
  "text-kumo-default underline decoration-kumo-line underline-offset-2 hover:decoration-current"

export function ModelsSettings() {
  const hub = useHub()
  const settings: ModelSettings = {
    ...DEFAULT_MODEL_SETTINGS,
    ...hub.state.models,
  }
  const deployment = hub.state.deployment
  const chat = settings.chat ?? deployment?.chat ?? ""
  const provider = providerOf(chat)
  const disabled = !hub.models
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ModelTestResult | null>(null)
  const [advanced, setAdvanced] = useState(false)

  const set = (patch: Partial<ModelSettings>) => void hub.models?.set(patch)

  async function test() {
    if (!hub.models || !chat) return
    setTesting(true)
    setResult(null)
    try {
      setResult(await hub.models.test(chat))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Group
          title="Model"
          action={
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              loading={testing}
              disabled={disabled || !chat}
              onClick={() => void test()}
            >
              Test
            </Button>
          }
        >
          <ModelPicker
            value={chat || null}
            disabled={disabled}
            onChange={(next) => {
              setResult(null)
              set({ chat: next })
            }}
          />
        </Group>
        {result ? <TestResult result={result} model={chat} /> : null}
        {provider && provider !== "workers-ai" ? (
          <p className="px-1.5 text-xs text-pretty text-kumo-subtle">
            {PROVIDERS.find((p) => p.id === provider)?.name} models bill through
            AI Gateway credits or your own key.{" "}
            <a
              href={GATEWAY_DASH}
              target="_blank"
              rel="noreferrer noopener"
              className={LINK}
            >
              Set up billing
            </a>
          </p>
        ) : null}
      </div>

      <section className="space-y-2">
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
          className="flex items-center gap-1 px-1.5 text-sm text-kumo-subtle outline-none hover:text-kumo-default focus-visible:text-kumo-default"
        >
          Advanced
          <CaretDownIcon
            size={14}
            className={`transition-transform duration-200 ${advanced ? "rotate-180" : ""}`}
          />
        </button>
        {advanced ? (
          <ul className="overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-kumo-line">
            <ModelPicker
              value={settings.background}
              label="Background work"
              disabled={disabled}
              inherit={{ label: "Same as chat", modelId: chat }}
              onChange={(background) => set({ background })}
            />
            <Row
              label="Fall back to Workers AI"
              detail="If another lab's model fails"
            >
              <Switch
                aria-label="Fall back to Workers AI"
                checked={settings.fallback}
                disabled={disabled}
                onCheckedChange={(fallback) => set({ fallback })}
              />
            </Row>
            <Row
              label="AI Gateway"
              detail={
                deployment ? (
                  <span className="font-mono">{deployment.gateway}</span>
                ) : undefined
              }
            >
              <a
                href={GATEWAY_DASH}
                target="_blank"
                rel="noreferrer noopener"
                className="pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-focus"
              >
                Logs and limits
                <ArrowSquareOutIcon size={14} />
              </a>
            </Row>
          </ul>
        ) : null}
      </section>
    </div>
  )
}
