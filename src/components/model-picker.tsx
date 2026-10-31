import { useEffect, useState } from "react"
import { Select } from "@cloudflare/kumo/components/select"
import { FIELD, Row } from "@/components/group"
import {
  MODELS,
  PROVIDERS,
  modelInfo,
  modelName,
  providerOf,
} from "@/lib/models"

const INHERIT = "inherit"
const CUSTOM = "custom"

type ProviderChoice = string

function providerChoice(value: string | null, inheritable: boolean) {
  if (!value) return inheritable ? INHERIT : PROVIDERS[0].id
  return modelInfo(value) ? (providerOf(value) ?? CUSTOM) : CUSTOM
}

/** The model's exact id, under the picker. */
export function ModelDetail({ modelId }: { modelId: string }) {
  return <span className="font-mono text-[11px] break-all">{modelId}</span>
}

/**
 * Two rows: the provider, then one of its models. With `inherit`, a first
 * provider choice hands the decision to a default (the account's model, or
 * the deployment's), and `value` is null while it does.
 */
export function ModelPicker({
  value,
  onChange,
  inherit,
  disabled,
  label = "Provider",
}: {
  value: string | null
  onChange: (modelId: string | null) => void
  /** Label and model id of the default that a null value means. */
  inherit?: { label: string; modelId: string }
  disabled?: boolean
  /** The first row's label, when "Provider" alone would be unclear. */
  label?: string
}) {
  const [provider, setProvider] = useState<ProviderChoice>(() =>
    providerChoice(value, !!inherit)
  )
  const [custom, setCustom] = useState(value && !modelInfo(value) ? value : "")

  // Another tab may change the setting while this is open.
  const inheritable = !!inherit
  useEffect(() => {
    setProvider(providerChoice(value, inheritable))
    if (value && !modelInfo(value)) setCustom(value)
  }, [value, inheritable])

  const providerItems: Record<string, string> = {
    ...(inherit ? { [INHERIT]: inherit.label } : {}),
    ...Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name])),
    [CUSTOM]: "Custom model ID",
  }

  const models = MODELS.filter((m) => m.provider === provider)
  const effective = value ?? inherit?.modelId ?? null

  function pickProvider(next: ProviderChoice) {
    setProvider(next)
    if (next === INHERIT) onChange(null)
    else if (next !== CUSTOM) {
      // Keep the model when it already belongs here, else the provider's first.
      const keep = value && providerOf(value) === next && modelInfo(value)
      onChange(
        keep ? value : (MODELS.find((m) => m.provider === next)?.id ?? null)
      )
    }
  }

  function commitCustom() {
    const id = custom.trim()
    if (id && id !== value) onChange(id)
  }

  return (
    <>
      <Row
        label={label}
        stacked
        detail={
          provider === INHERIT && effective
            ? modelName(effective)
            : provider === CUSTOM
              ? "A catalog id, an @cf/ id, or dynamic/<route>"
              : undefined
        }
      >
        <Select
          aria-label="Provider"
          size="sm"
          className="w-full @md:w-44 @md:shrink-0"
          disabled={disabled}
          value={provider}
          items={providerItems}
          onValueChange={(next) => next && pickProvider(next)}
        />
      </Row>
      {provider === CUSTOM ? (
        <Row label="Model ID">
          <input
            aria-label="Model ID"
            placeholder="anthropic/claude-sonnet-5.5"
            spellCheck={false}
            disabled={disabled}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCustom()
            }}
            className={`${FIELD} h-8 max-w-[65%] text-right font-mono text-[13px]`}
          />
        </Row>
      ) : provider !== INHERIT ? (
        <Row
          label="Model"
          stacked
          detail={value ? <ModelDetail modelId={value} /> : undefined}
        >
          <Select
            aria-label="Model"
            size="sm"
            className="w-full @md:w-56 @md:shrink-0"
            disabled={disabled}
            value={value && providerOf(value) === provider ? value : ""}
            // The list shows each model's exact id; the trigger only its name.
            items={Object.fromEntries(
              models.map((m) => [
                m.id,
                <span key={m.id} className="block py-0.5">
                  <span className="block">{m.name}</span>
                  <span className="block font-mono text-[11px] break-all text-kumo-subtle">
                    {m.id}
                  </span>
                </span>,
              ])
            )}
            renderValue={(id: string) => modelName(id)}
            onValueChange={(next) => next && onChange(next)}
          />
        </Row>
      ) : null}
    </>
  )
}
