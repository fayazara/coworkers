/**
 * The components a bot can put on a surface. One definition per component
 * drives normalizing (what is kept, what is rejected), the catalog section
 * of the system prompt and the server's checks on action values.
 *
 * Props say what something is, never how it looks: there is no colour,
 * size, spacing or class anywhere. The renderer owns the design.
 */

import { TONES } from "./types"

export type PropSpec =
  | {
      kind: "text"
      max: number
      required?: boolean
      bind?: boolean
      desc?: string
    }
  | {
      kind: "number"
      min?: number
      max?: number
      required?: boolean
      bind?: boolean
      desc?: string
    }
  | { kind: "bool"; desc?: string }
  | {
      kind: "enum"
      values: readonly string[]
      required?: boolean
      bind?: boolean
      desc?: string
    }
  /** A link a person can open: https or http only. */
  | { kind: "url"; bind?: boolean; desc?: string }
  /** An image: an https URL or a path in the bot's files. */
  | { kind: "src"; required?: boolean; bind?: boolean; desc?: string }
  /** An input's JSON Pointer into the surface data. */
  | { kind: "field"; required?: boolean; desc?: string }
  | {
      kind: "action"
      only?: readonly ("say" | "event" | "link")[]
      required?: boolean
      desc?: string
    }
  /** A list of items, written inline or bound whole to an array in data. */
  | {
      kind: "items"
      min: number
      max: number
      item: Record<string, PropSpec>
      required?: boolean
      desc?: string
    }
  /** Table rows: arrays of cells, each a string or { text, url?, tone? }. */
  | { kind: "rows"; max: number; required?: boolean; desc?: string }
  | {
      kind: "object"
      props: Record<string, PropSpec>
      required?: boolean
      desc?: string
    }

export interface ComponentSpec {
  /** One line for the prompt: what it is for. */
  use: string
  group: "content" | "layout" | "input" | "action"
  props: Record<string, PropSpec>
  children?: { min: number; max: number }
  /** Per surface. */
  maxPerSurface?: number
  /** Inputs: the kind of value they keep at `field`. */
  value?: "text" | "bool" | "choice" | "date"
}

const tone = {
  kind: "enum",
  values: TONES,
  desc: "neutral, good or warn",
} as const

export const LIMITS = {
  nodes: 40,
  depth: 4,
  dataBytes: 32 * 1024,
  layoutBytes: 16 * 1024,
  openSurfaces: 50,
  label: 120,
  value: 40,
  detail: 160,
  text: 600,
  fieldText: 4000,
} as const

export const CATALOG = {
  Stats: {
    use: "2-4 headline numbers side by side.",
    group: "content",
    props: {
      items: {
        kind: "items",
        min: 1,
        max: 4,
        required: true,
        item: {
          label: { kind: "text", max: LIMITS.label, required: true },
          value: { kind: "text", max: LIMITS.value, bind: true },
          detail: { kind: "text", max: LIMITS.detail, bind: true },
          tone: { ...tone, desc: "colours the value; default from its sign" },
        },
      },
    },
  },
  List: {
    use: "Things you found, one row each. url makes the row open it.",
    group: "content",
    props: {
      title: { kind: "text", max: 80 },
      items: {
        kind: "items",
        min: 1,
        max: 20,
        required: true,
        item: {
          label: {
            kind: "text",
            max: LIMITS.label,
            required: true,
            desc: "the name",
          },
          value: {
            kind: "text",
            max: LIMITS.value,
            desc: "price, count or date",
          },
          detail: {
            kind: "text",
            max: LIMITS.detail,
            desc: "the one fact that matters",
          },
          url: { kind: "url" },
          tag: { kind: "text", max: 24, desc: "a 1-2 word verdict" },
          tone: { ...tone, desc: "colours the tag" },
          image: { kind: "src", desc: "a thumbnail" },
        },
      },
    },
  },
  Table: {
    use: "Compare things across 3 or more attributes. Otherwise use List.",
    group: "content",
    props: {
      title: { kind: "text", max: 80 },
      columns: {
        kind: "items",
        min: 2,
        max: 6,
        required: true,
        item: {
          label: { kind: "text", max: 40, required: true },
          align: {
            kind: "enum",
            values: ["start", "end"],
            desc: "end for numbers",
          },
        },
      },
      rows: {
        kind: "rows",
        max: 50,
        required: true,
        desc: "each row an array of cells: a string, or { text, url?, tone? }",
      },
    },
  },
  Callout: {
    use: "The one caveat or piece of news the user must not miss.",
    group: "content",
    maxPerSurface: 1,
    props: {
      title: { kind: "text", max: 80 },
      text: { kind: "text", max: LIMITS.text, required: true, bind: true },
      tone: { ...tone, desc: "warn for a caveat, good for news" },
    },
  },
  Text: {
    use: "A short plain note inside the surface. Your reply itself goes in the message, not here.",
    group: "content",
    props: {
      text: { kind: "text", max: LIMITS.text, required: true, bind: true },
      role: {
        kind: "enum",
        values: ["body", "subtle", "label"],
        desc: "body (default), subtle, or label for a small heading",
      },
    },
  },
  Progress: {
    use: "A bar for work under way. Without value it shows activity only.",
    group: "content",
    props: {
      label: { kind: "text", max: LIMITS.label, required: true },
      value: {
        kind: "number",
        min: 0,
        max: 1,
        bind: true,
        desc: "0 to 1; beside a Steps, bind it to the same items pointer and it counts the steps done",
      },
      detail: { kind: "text", max: LIMITS.detail, bind: true },
      state: {
        kind: "enum",
        values: ["active", "done", "failed"],
        bind: true,
      },
    },
  },
  Steps: {
    use: "A checklist or a task's progress. With tick, the user can tick steps off themselves.",
    group: "content",
    props: {
      tick: {
        kind: "action",
        only: ["event"],
        desc: 'set it when the user ticks steps off: tapping one sends the event with { step, label, done }, and you update that step\'s state',
      },
      items: {
        kind: "items",
        min: 1,
        max: 12,
        required: true,
        item: {
          label: { kind: "text", max: LIMITS.label, required: true },
          state: {
            kind: "enum",
            values: ["pending", "active", "done", "failed", "skipped"],
            required: true,
          },
          detail: { kind: "text", max: LIMITS.detail },
        },
      },
    },
  },
  Image: {
    use: "A picture: a screenshot from your files or an https image.",
    group: "content",
    props: {
      src: {
        kind: "src",
        required: true,
        bind: true,
        desc: "an https URL or a path in your files",
      },
      alt: { kind: "text", max: LIMITS.label, required: true },
      caption: { kind: "text", max: LIMITS.detail },
    },
  },
  Section: {
    use: "Groups related components under a small heading.",
    group: "layout",
    children: { min: 1, max: 8 },
    props: { title: { kind: "text", max: 80 } },
  },
  Split: {
    use: "Exactly two components side by side (before/after, option A/B). Stacks on phones.",
    group: "layout",
    children: { min: 2, max: 2 },
    props: {},
  },
  Form: {
    use: "Fields the user fills in, sent to you together when they press submit.",
    group: "input",
    children: { min: 1, max: 10 },
    maxPerSurface: 2,
    props: {
      title: { kind: "text", max: 80 },
      submit: {
        kind: "object",
        required: true,
        props: {
          label: { kind: "text", max: 40, required: true },
          action: { kind: "action", only: ["event"], required: true },
        },
      },
      secondary: {
        kind: "object",
        props: {
          label: { kind: "text", max: 40, required: true },
          action: { kind: "action", required: true },
        },
      },
    },
  },
  TextField: {
    use: "A text input.",
    group: "input",
    value: "text",
    props: {
      label: { kind: "text", max: 80, required: true },
      field: { kind: "field", required: true },
      placeholder: { kind: "text", max: 80 },
      kind: {
        kind: "enum",
        values: ["text", "email", "number", "url"],
      },
      multiline: { kind: "bool" },
      required: { kind: "bool" },
      max: {
        kind: "number",
        min: 1,
        max: LIMITS.fieldText,
        desc: "max characters",
      },
    },
  },
  Choice: {
    use: "Pick one (or several with multiple) of 2-8 options.",
    group: "input",
    value: "choice",
    props: {
      label: { kind: "text", max: 80, required: true },
      field: { kind: "field", required: true },
      options: {
        kind: "items",
        min: 2,
        max: 8,
        required: true,
        item: {
          label: { kind: "text", max: 80, required: true },
          value: { kind: "text", max: 80, required: true },
          detail: { kind: "text", max: LIMITS.detail },
        },
      },
      multiple: { kind: "bool" },
      required: { kind: "bool" },
    },
  },
  Toggle: {
    use: "An on/off switch.",
    group: "input",
    value: "bool",
    props: {
      label: { kind: "text", max: 80, required: true },
      field: { kind: "field", required: true },
      detail: { kind: "text", max: LIMITS.detail },
    },
  },
  DateField: {
    use: "A date, or date and time with time: true. Stored as ISO 8601.",
    group: "input",
    value: "date",
    props: {
      label: { kind: "text", max: 80, required: true },
      field: { kind: "field", required: true },
      time: { kind: "bool" },
      required: { kind: "bool" },
    },
  },
  Actions: {
    use: "1-3 buttons. The first is primary unless one says emphasis: primary.",
    group: "action",
    props: {
      items: {
        kind: "items",
        min: 1,
        max: 3,
        required: true,
        item: {
          label: { kind: "text", max: 60, required: true },
          action: { kind: "action", required: true },
          emphasis: { kind: "enum", values: ["primary", "quiet"] },
        },
      },
    },
  },
} as const satisfies Record<string, ComponentSpec>

export type ComponentType = keyof typeof CATALOG
export const COMPONENT_TYPES = Object.keys(CATALOG) as ComponentType[]

export function componentSpec(type: string): ComponentSpec | undefined {
  return (CATALOG as Record<string, ComponentSpec>)[type]
}

/** Common wrong names models reach for, and what to use instead. */
export const SUGGEST: Record<string, string> = {
  Card: "Section",
  Column: "Section",
  Row: "Split",
  Grid: "Split",
  Box: "Section",
  Container: "Section",
  Button: "Actions",
  Buttons: "Actions",
  Input: "TextField",
  TextInput: "TextField",
  Select: "Choice",
  Radio: "Choice",
  Checkbox: "Toggle",
  CheckBox: "Toggle",
  Switch: "Toggle",
  Date: "DateField",
  Stat: "Stats",
  Metric: "Stats",
  Alert: "Callout",
  Notice: "Callout",
  Heading: "Text",
  Markdown: "Text",
  Checklist: "Steps",
  ProgressBar: "Progress",
}
