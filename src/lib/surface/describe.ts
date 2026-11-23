/** The catalog as the model reads it, generated so it never drifts. */

import { CATALOG } from "./catalog"
import type { ComponentSpec, PropSpec } from "./catalog"

function describeProp(name: string, spec: PropSpec): string {
  const marks =
    ("required" in spec && spec.required ? "*" : "") +
    (("bind" in spec && spec.bind) || spec.kind === "items" || spec.kind === "rows"
      ? "~"
      : "")
  let detail = ""
  switch (spec.kind) {
    case "enum":
      detail =
        spec.desc && spec.values.every((v) => spec.desc?.includes(v))
          ? spec.desc
          : `${spec.values.join("|")}${spec.desc ? `: ${spec.desc}` : ""}`
      break
    case "items":
      detail = `${spec.min}-${spec.max} of { ${Object.entries(spec.item)
        .map(([k, s]) => describeProp(k, s))
        .join(", ")} }`
      break
    case "object":
      detail = `{ ${Object.entries(spec.props)
        .map(([k, s]) => describeProp(k, s))
        .join(", ")} }`
      break
    case "action":
      detail = `${spec.only ? `${spec.only.join("|")} action` : "action"}${spec.desc ? `: ${spec.desc}` : ""}`
      break
    case "field":
      detail = spec.desc ?? 'pointer into data, like "/reply/subject"'
      break
    case "number":
      detail = spec.desc ?? "number"
      break
    default:
      detail = spec.desc ?? ""
  }
  return `${name}${marks}${detail ? ` (${detail})` : ""}`
}

function describeComponent(type: string, spec: ComponentSpec): string {
  const props = Object.entries(spec.props).map(([k, s]) => describeProp(k, s))
  if (spec.children) {
    props.push(
      `children* (${spec.children.min === spec.children.max ? spec.children.min : `${spec.children.min}-${spec.children.max}`} components)`
    )
  }
  return `- ${type}: ${spec.use}${props.length ? ` Props: ${props.join("; ")}.` : ""}`
}

export function describeCatalog(): string {
  const groups: [ComponentSpec["group"], string][] = [
    ["content", "Content"],
    ["layout", "Layout"],
    ["input", "Inputs"],
    ["action", "Buttons"],
  ]
  const entries = Object.entries(CATALOG) as [string, ComponentSpec][]
  return groups
    .map(([group, heading]) =>
      [
        `${heading}:`,
        ...entries
          .filter(([, spec]) => spec.group === group)
          .map(([type, spec]) => describeComponent(type, spec)),
      ].join("\n")
    )
    .join("\n")
}
