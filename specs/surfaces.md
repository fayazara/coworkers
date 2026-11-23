# Surfaces — rich UI from bots

Status: draft for review. Replaces the `show` tool and `show-blocks.tsx`.

A **surface** is a piece of UI a bot puts in front of the user: a set of
results, a form, a live status. The bot describes _what_ to show with
components from a fixed catalog and the data they display. The app decides
_how_ it looks, with its own components and design language. No code from the
bot ever runs in the client.

Surfaces live on the bot, not in a message, so the bot can update one in place
later (a routine refreshing a price watch, a long task ticking through its
steps) and the change shows wherever the surface appears: in the thread, on
the Desk, in a phone sheet.

## Goals

1. **Rich answers.** Results the user scans or acts on (stats, lists, tables,
   callouts, next steps) render as designed UI, not Markdown.
2. **Inputs.** A bot can ask for structured input (a form, choices, a date)
   and get the values back as a structured event, not as text pretending to
   be the user.
3. **Live surfaces.** A bot can update a surface it showed earlier, in this
   turn or a later one, without re-posting it. That includes surfaces pinned
   to the Desk.
4. **Works on the configured model.** Whatever model the account or bot is
   set to (`src/lib/models.ts`), including the Workers AI fallback. The format
   and catalog are shaped for weaker models first.
5. **The app's design language, always.** A bot cannot produce anything
   off-brand, because the vocabulary has no way to express it.

## Non-goals (v1)

- Other clients (native mobile, Slack). The format does not prevent them.
- UI from outside agents over `/mcp`. Possible later with the same catalog
  and stricter limits (see "Later").
- Client-side logic: expressions, conditionals, computed values, local-only
  actions. Every action goes to the bot.
- Replacing native cards. Tool approvals, script approvals, `connect_app`,
  `request_secret`, hand-offs and shop checkout stay as they are. They carry
  trust (spend, credentials, acting on the user's behalf), and a generated
  surface must never be able to look like them.
- A2UI compatibility. See "Why not A2UI".

## Why not A2UI

We looked at [A2UI](https://a2ui.org) v1.0 closely and borrowed most of its
ideas. We are not adopting the protocol or its libraries:

- **Fit.** A2UI is for one agent driving many client platforms, or agents
  across a trust boundary. We have one React client and our own bots.
- **Size.** `@a2ui/web_core` + `@a2ui/react` with one custom component and
  no basic catalog is ~336 KB minified, ~92 KB gzip (zod 3,
  zod-to-json-schema, Lit, Preact signals). Measured 2026-11-22, v0.15.0.
  The engine here should be a few KB.
- **Churn.** v0.8 → v0.9 → v0.9.1 → v1.0 in a short time, package at 0.15,
  React README still on v0.9.
- **zod 3.** Catalog schemas must be zod 3 to compose with theirs. We are on
  zod 4.
- **The hard parts are ours anyway.** Storing surfaces on a Durable Object,
  Desk pinning, actions into Think turns and rendering while tool input
  streams are not covered by A2UI.

What we borrow: surfaces with ids that update in place, layout separate from
data with JSON Pointer bindings, actions as structured events, a catalog the
client owns, and validation errors fed back to the model.

What we change: the bot writes a **nested tree** (weaker models write trees
more reliably than flat lists of id references), the catalog is **few,
opinionated components** instead of generic `Row`/`Column`/`Text` primitives,
and lists bind to **arrays of item objects** instead of templates.

## Concepts

| Term          | Meaning                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Surface**   | One unit of UI with an id, a layout and data. Owned by one bot.                                                           |
| **Layout**    | An ordered list of component nodes, each possibly with children. Says what is shown and where values come from.           |
| **Data**      | A JSON object the layout binds to. Updating data changes what is shown without resending the layout.                     |
| **Component** | A node type from the catalog (`Stats`, `List`, `Form`…). Has typed props. No style props.                                 |
| **Binding**   | `{ "$bind": "/pointer" }` in place of a prop value: read it from data (JSON Pointer, RFC 6901).                           |
| **Field**     | An input's pointer into data. The user's edits write there locally and travel with an action.                             |
| **Action**    | What a button does: say something as the user, send the bot an event with field values, or open a link.                  |
| **Placement** | Where a surface is rendered: `thread`, `desk` or `sheet`. Components adapt to it. The bot never chooses styling for it.   |
| **Catalog**   | The components, their props and limits. One plain descriptor per component in `catalog.ts`, the single source of truth (see "Catalog"). |

## Design principles

1. **Semantic, not visual.** Props say what something _is_ (`tone: "warn"`,
   `emphasis: "primary"`), never how it looks. There is no `color`,
   `fontSize`, `padding`, `className`, `style` or raw HTML anywhere.
2. **Opinionated components.** The component decides spacing, borders, type
   size and alignment. `Stats` sizes every value in a row to fit the longest
   (today's `statSize`), colours a value by its sign (`statTone`), keeps
   hyphenated words on one line (`keepHyphens`). These rules move into the
   renderer.
3. **Text says what it means; the surface carries the data.** The bot's prose
   gives the takeaway and its judgement; numbers and items live in the
   surface, once.
4. **Render what is there.** Input streams in partially and models make
   mistakes. The renderer draws whatever is valid so far and skips the rest,
   so a half-written or slightly wrong surface never breaks the thread.
5. **Reject what is unsafe or unusable, and say exactly why.** The server
   validates every write. Fatal problems go back to the model with a path and
   a message so it can fix them on the next step.
6. **One descriptor, three uses.** Each component's descriptor in
   `catalog.ts` (prop kinds, limits, a one-line use) drives the catalog text
   in the tool description (`describeCatalog()`), validation on the server and
   in the client, and the renderer's reading of props. The tool's input
   schema stays loose (`layout` is an array of objects) so a slightly wrong
   surface reaches the validator, which explains the fix, instead of failing
   schema checks the model cannot read.

## The format

### A surface as the bot writes it

```json
{
  "id": "macbook-watch",
  "title": "MacBook Air M4 under ₹95,000",
  "layout": [
    {
      "type": "Stats",
      "items": [
        { "label": "Lowest now", "value": { "$bind": "/low" }, "tone": "good" },
        { "label": "Listings", "value": { "$bind": "/count" } },
        { "label": "30-day low", "value": { "$bind": "/low30" } }
      ]
    },
    {
      "type": "List",
      "title": "Best listings",
      "items": { "$bind": "/listings" }
    },
    {
      "type": "Actions",
      "items": [
        {
          "label": "Watch daily under ₹92,000",
          "action": { "say": "Watch OLX daily under ₹92,000" }
        }
      ]
    }
  ],
  "data": {
    "low": "₹91,500",
    "count": "14",
    "low30": "₹89,999",
    "listings": [
      {
        "label": "MacBook Air M4 13\" 16/512",
        "value": "₹91,500",
        "detail": "Sealed, Indiranagar, posted today",
        "url": "https://www.olx.in/item/…",
        "tag": "Best price",
        "tone": "good"
      }
    ]
  }
}
```

- **`id`**: chosen by the bot, `[a-z0-9-]{1,48}`, unique per bot. Showing a
  surface with an id that exists replaces its layout and data (upsert). A
  readable id ("macbook-watch") lets a routine find its surface across runs.
- **`title`**: optional in the thread, required when pinned to the Desk.
  Shown as the surface's heading where the placement has one.
- **`layout`**: a list of nodes, rendered top to bottom. No single root.
- **`data`**: optional. Anything bound must be here (or arrive later by an
  update) or it renders as missing (see "Missing values").

### Nodes

```ts
type Node = {
  type: ComponentType
  /** Optional, `[a-z0-9-]{1,32}`. Keeps identity across layout updates. */
  id?: string
  /** Containers only. */
  children?: Node[]
} & ComponentProps
```

The server flattens the tree into `{ id → node }` with child id lists, the
same shape A2UI uses on the wire. Nodes without an id get a stable one from
their position (`n0`, `n0.2`, …). The flat form is internal: it is what is
stored, diffed and sent to clients. Bots only ever write trees.

### Bindings

Any prop marked _bindable_ in the catalog takes either a literal or
`{ "$bind": "/pointer" }`.

- Scalars bind to strings, numbers or booleans in data.
- Item lists (`Stats.items`, `List.items`, `Table.rows`, `Steps.items`,
  `Choice.options`) can bind as a whole to an array in data whose elements
  have the item's shape. No templates, no relative paths.
- Inside a literal item list, an item's own scalar props can bind too
  (`{ "label": "Lowest now", "value": { "$bind": "/low" } }`).
- Values are display-ready strings the bot formats ("₹91,500", "3 days
  ago"). Numbers are allowed where a component needs them (`Progress.value`).
  v1 has no format or expression language.

### Missing values

A binding whose pointer does not resolve renders as missing: a stat shows a
quiet dash, a list shows nothing, a text line is skipped. During streaming
this is the normal case; after the write it is a warning returned to the
model.

### Fields (inputs)

Inputs name a pointer in data with `field`:

```json
{ "type": "TextField", "label": "Subject", "field": "/reply/subject" }
```

- The value at the pointer is the initial value (the bot can prefill).
- Edits write to the client's copy of the surface data only. Nothing goes to
  the bot until an action sends it.
- When the bot updates data while the user is typing, a field the user has
  edited keeps their value; untouched fields take the new value. Pressing an
  action clears the "edited" marks.

### Actions

A button's `action` is exactly one of:

| Action     | Shape                                                       | What happens                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **say**    | `{ "say": "Watch OLX daily under ₹92,000" }`                | Sent as the user's own chat message, exactly as if typed. For suggested next steps.                                                                                                |
| **event**  | `{ "event": "send_reply", "fields": ["/reply"], "confirm"?: "Send this reply to Zeke?" }` | The bot gets a structured event with the values at those pointers (see "Action events"). `fields` defaults to every field inside the enclosing `Form`, or none outside one. |
| **link**   | `{ "link": "https://…" }`                                   | Opens the link in a new tab. `https://` and `http://` only.                                                                                                                         |

A `Form`'s `submit` is an `event` action. Required fields and simple checks
(`required`, `kind: "email" | "number" | "url"`, `min`/`max` length) are
checked in the client before the event is sent; the button stays disabled
until they pass.

## Catalog (v1)

Small on purpose. Every component below lists its props; anything not listed
is dropped. **B** marks a bindable prop. Limits are enforced by the schema.

### Content

| Component    | Props                                                                                                                                              | Notes                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stats**    | `items` (B, 1-4): `label`, `value` (B), `detail`? (B), `tone`?                                                                                     | Headline numbers side by side. Value size fits the longest; sign colours the value when no tone is given.                                  |
| **List**     | `title`?, `items` (B, 1-20): `label`, `value`?, `detail`?, `url`?, `tag`?, `tone`?, `image`?                                                       | Things found. `url` makes the row open it. `tag` is a 1-2 word verdict, coloured by `tone`. `image` is a thumbnail (see `Image` for sources). |
| **Table**    | `title`?, `columns` (2-6): `label`, `align`? (`start`\|`end`); `rows` (B, 1-50): array of cells, each a string or `{ text, url?, tone? }`          | Only for comparing across 3+ attributes. Number columns `align: "end"`, tabular figures. Scrolls sideways on phones, first column sticky. |
| **Callout**  | `title`?, `text` (B), `tone` (`neutral`\|`good`\|`warn`)                                                                                           | The one caveat or piece of news not to miss. At most one per surface (warning past one).                                                    |
| **Text**     | `text` (B), `role`? (`body`\|`subtle`\|`label`)                                                                                                    | A line of plain text inside a surface, for a heading-less note. Not for the reply itself: prose belongs in the message.                     |
| **Progress** | `label`, `value` (B, 0-1)?, `detail`? (B), `state`? (B: `active`\|`done`\|`failed`)                                                                 | A bar with a label. Without `value` it is indeterminate.                                                                                    |
| **Steps**    | `tick`? (event), `items` (B, 1-12): `label`, `state` (`pending`\|`active`\|`done`\|`failed`\|`skipped`), `detail`?                                       | A task's progress, or with `tick` a checklist the user ticks off: each row becomes a checkbox that sends `{ step, label, done }` with the event (see "Action events"). |
| **Image**    | `src` (B), `alt`, `caption`?                                                                                                                       | `src` is a path in the bot's files (screenshots, renders) or an `https://` URL. Remote images load through the existing image path, lazily. |

### Layout

| Component   | Props                                    | Notes                                                                                                              |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Section** | `title`?, `children` (1-8)               | Groups related nodes under a small heading. Does not draw its own card when it is already inside one.             |
| **Split**   | `children` (exactly 2)                   | Two columns side by side; stacks on narrow placements. For "before / after", "option A / option B".               |

No free-form `Row`, `Column`, `Box`, `Card` or `Grid`. Spacing between
top-level nodes is fixed by the renderer.

### Inputs

| Component     | Props                                                                                                                           | Notes                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Form**      | `title`?, `children` (1-10 inputs or content), `submit`: `{ label, action (event) }`, `secondary`?: `{ label, action }`           | Groups fields. Enter submits single-line forms. Disabled once submitted until the surface changes or the turn ends. |
| **TextField** | `label`, `field`, `placeholder`?, `kind`? (`text`\|`email`\|`number`\|`url`), `multiline`?, `required`?, `max`? (≤ 4000)        | No password kind: secrets go through `request_secret`.                                                              |
| **Choice**    | `label`, `field`, `options` (B, 2-8): `label`, `value`, `detail`?; `multiple`?, `required`?                                    | Chips when labels are short, a list with detail lines when any option has `detail`. The renderer picks.              |
| **Toggle**    | `label`, `field`, `detail`?                                                                                                     | Boolean at `field`.                                                                                                  |
| **DateField** | `label`, `field`, `time`? (bool), `required`?                                                                                   | Stores ISO 8601 (`2026-11-22` or `2026-11-22T09:30`) in the bot's timezone.                                         |

### Actions

| Component   | Props                                                          | Notes                                                                                                           |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Actions** | `items` (1-3): `label`, `action`, `emphasis`? (`primary`\|`quiet`) | A row of buttons. At most one `primary`; the first item is primary when none is marked. Wraps on phones. |

### Surface limits

- 40 nodes after flattening, depth ≤ 4 (`Section` → `Split` → content).
- Data ≤ 32 KB serialized; layout ≤ 16 KB.
- Strings: labels ≤ 120, values ≤ 40, details ≤ 160, text ≤ 600 chars.
- At most 2 `Form`s and 1 `Callout` per surface.
- 50 open surfaces per bot (oldest unpinned ones close past that).

## Bot tools

Three tools replace `show`. All three are read-only in the rules sense (no
approval), like `show` today.

### `show_surface`

Create a surface, or replace one by id.

```ts
{
  id?: string            // omitted: the server generates one and returns it
  title?: string
  layout: Node[]
  data?: Record<string, unknown>
  desk?: {               // pin it to the Desk (see "Desk")
    lane: "fyi" | "done"
    why: string          // one line, like a Desk card's "why"
  }
}
```

The tool result carries the whole surface (`{ ok: true, surface, warnings? }`)
for the thread to draw, or `{ ok: false, error, problems }`. The model never
reads the payload: `toModelOutput` gives it a short summary (id, version,
pinned, warnings, and "The user can see it now. Do not repeat it or add a
closing message in text: if your work is done, end your turn here.").

### `update_surface`

Change a surface the bot showed before, in any turn.

```ts
{
  id: string
  data?: { path: string; value: unknown }[]   // set (null deletes), applied in order
  layout?: Node[]                              // replace the whole layout
  title?: string
  close?: boolean                              // freeze it: read-only from now on
  desk?: { lane?, why }                        // pin it, or change the pin
  unpin?: boolean                              // take it off the Desk
}
```

Data patches are the normal update: a routine changes `/low` and `/listings`
and the stats and list redraw. Replacing the layout is for when the shape
changes (a form becomes a confirmation). Nodes keep identity by id across a
layout replacement, so unchanged parts do not re-animate.

### `list_surfaces`

The bot's open surfaces: `{ id, title, updatedAt, pinned, fields? }[]`.
Background turns also get the same list in their prompt context ("Your live
surfaces"), so a routine knows which id to update without calling this.

## Validation

Every write goes through `normalizeLayout()` and `normalizeData()` in `src/lib/surface/` (shared,
no server-only imports), run on the server in the tool's `execute` and in the
client for rendering.

- **Dropped quietly, reported as a warning:** unknown props, strings over
  their limit (truncated), unknown `tone` values, a second `Callout`, unsafe
  URLs, bindings that do not resolve after the write.
- **Rejected with problems:** unknown component types, missing required props
  (`label`, `field`, `action`), node or size limits exceeded, a `field`
  outside data's shape (pointing into a string), duplicate ids, an action with
  none or two of `say`/`event`/`link`, an `event` name that is not
  `[a-z_]{1,32}`.

A rejected write changes nothing and returns, for example:

```json
{
  "error": "The surface was not shown. Fix these and call show_surface again.",
  "problems": [
    { "path": "/layout/1/items/0", "message": "List items need a label." },
    { "path": "/layout/2/type", "message": "Unknown component \"Card\". Use Section." }
  ]
}
```

Messages name the fix in the catalog's own words, because the next attempt
is only as good as the feedback.

**Slips with one meaning are read, with a warning.** Testing with real models
showed a few mistakes that are unambiguous, so they are accepted rather than
costing a round trip: a bare field name (`"subject"`, `"reply.subject"`) is
read as a pointer (`/subject`, `/reply/subject`), and a bare string where only
an event fits (`"tick": "tick_step"`) is read as `{ "event": "tick_step" }`.
An action anywhere else that is not an object is a problem, never a silent
drop: a dropped action leaves a button the bot believes works.

**A `say` must be a whole message.** It is sent the moment it is pressed, so
text ending in `:` or `...` ("Add a task to my checklist:") is rejected with a
pointer to a `TextField` in a `Form`.

### Ending the turn

Prompting alone did not stop models from writing a closing paragraph under a
surface. So in foreground turns `beforeTurn` adds a stop condition
(`surfaceEndsStep`): the turn ends after a step whose only tool calls were
successful surface writes, unless a surface shows the bot's own work under
way (a `Progress` not done or failed, or `Steps` without `tick` with an
`active` item). A rejected write goes back for a fix, and a progress surface
lets the bot carry on. Background turns are left alone: they still end with
`NO_UPDATE` or a note.

## Storage and sync

### On the bot

A `surfaces` table on `BotAgent` (`src/agents/surface-store.ts`):
`id`, `body` (the whole surface as JSON), `status`, `pinned`, `updated_at`.
It is the copy the bot updates and checks button presses against. Past 50
open surfaces, the oldest unpinned ones close.

Surfaces are not in `BotState`, and there is no separate broadcast or
`getSurfaces`. Every `show_surface` and `update_surface` result carries the
whole surface, and tool results already reach the browser with the messages.
The thread takes the newest copy of each surface (highest version) among the
messages it has loaded (`latestSurfaces()` in `src/lib/surface/thread.ts`).

### In the thread

- While `show_surface` input is streaming, the thread renders it from the
  partial tool input (tolerant parse, as `showBlocks()` does today).
- Once the call is done, the thread renders the newest copy, drawn once: at
  its latest `show_surface`, or at its newest update when that show is no
  longer loaded.
- If a surface is shown again by id in a later turn, the newest placement
  renders the live surface; earlier placements collapse to a one-line stub
  ("Updated below") that scrolls to it.
- An `update_surface` call renders as a quiet event line in the thread
  ("Updated MacBook Air M4 under ₹95,000") that scrolls to the surface.
- A closed surface renders its last version read-only: inputs disabled,
  `event` buttons hidden, `link` and `say` still work.

`toTurn()` treats `show_surface` like text (it is part of what the bot says),
exactly as `show` is treated now.

### On the Desk

`show_surface` with `desk`, or `update_surface` on a pinned surface, makes the
bot call `hub.pinSurface(botId, surface, pin)`:

- The hub upserts a Desk card (`key: surface:<id>`, lane from the pin, title,
  why, origin from the turn) with `refs.surface = { id, version }`.
- The hub keeps a copy of the surface in a `desk_surfaces` table, since the
  Desk page talks to the hub, not to every bot.
- `HubState.desk` carries only the ref. The Desk fetches the copy with
  `getDeskSurfaces(cardIds)` and fetches again when `refs.surface.version`
  changes, so a bot's update reaches the card with the hub state it already
  syncs.
- Closing the surface or `unpin` marks the card done and drops the copy.
  Dismissing the card on the Desk ("Got it") only clears the card; the
  surface stays pinned on the bot until it unpins or closes it.

The Desk card frame (bot avatar, title, why, time, dismiss/snooze) stays the
Desk's own; the surface renders inside it with `placement: "desk"`.

## Action events

### From the client

- **Bot page:** `@callable() surfaceAction(surfaceId, version, target, values)`
  on `BotAgent`.
- **Desk:** `@callable() deskSurfaceAction(cardId, version, target, values, say?)`
  on `UserHub`, which forwards to the bot by DO RPC (`surfaceAction`, or
  `surfaceSay` for a say button, sent as the user's own message).

A target names the button: `<node>#<i>` for an `Actions` item or a `Steps`
row, `<node>#submit` / `<node>#secondary` for a `Form` (`actionAt()`).

The bot checks, in order: the surface exists and is open; `version` is the
current one (otherwise "This changed while you were looking. Check it
again."); the target is a button with an `event` action; `values` has only
the pointers that action declares, each checked against its input (length,
date shape, a choice among the options). The client's checks are a
convenience; this is the boundary. A `Steps` tick sends no values: the bot
works out `{ step, label, done }` from its own copy.

### Into a turn

A valid event starts a foreground turn with `runTurn({ mode: "submit" })`:

```
[Pressed "Send" on your surface "reply-priya" (Reply to Priya). Event: send_reply]
{"reply":{"subject":"Re: Thursday","body":"Thursday at 3pm works."}}
```

- It is the user acting, so it is a foreground turn and the usual rules apply
  ("Ask first" still asks).
- `MessageMeta.surfaceAction = { surfaceId, title, label, event }`. The
  thread renders it as the user's message showing the button label ("Send",
  "Ticked Transfer internet") with an "On <title>" link that scrolls to the
  surface, never the raw JSON.
- The idempotency key is `surface:<id>:<version>:<target>`, so a double tap
  or a retry does not start two turns.
- The button that fired shows a pending state until the surface's version
  changes; a tick shows the row ticked at once and the bot's update replaces
  the guess.
- In the thread, `say` actions go through the ordinary chat send.

The prompt tells the bot to reflect the outcome in the surface (update it to
a confirmation, or close it) rather than in text, and to say nothing on a
tick.

## Rendering

### Code layout

```
src/lib/surface/          shared, no server-only imports
  catalog.ts              component descriptors, limits, suggestions
  describe.ts             the catalog as the model reads it
  normalize.ts            tolerant parse, problems and warnings, flattening, ids
  pointer.ts              JSON Pointer read and write
  surface.ts              show/update, actions and their checks, the stop rule
  thread.ts               newest copy per surface, drafts while streaming
  format.ts               stat sizing and tone, field checks
  types.ts                Surface, SurfaceNode, Action, Placement
  surface.test.ts
src/agents/surface-store.ts   the bot's surfaces table
src/components/surface/
  surface.tsx             <SurfaceView surface placement interactive onEvent onSay />
  context.tsx             edits, presses, pending state; blockFrame()
  content.tsx             Stats, List, Table, Callout, Text, Progress, Steps, Image
  controls.tsx            Actions, Form, TextField, Choice, Toggle, DateField, Section, Split
```

Each catalog component is one small file built from the app's own pieces:
the tokens in `src/styles.css`, Kumo primitives where they bring behaviour
(`Button`, `Select`, `Switch`, `Checkbox`, `Input`, `Tooltip`), and existing
app pieces (`.pressable`, the run-steps rail, `sliding-tabs`, icons from
`@/components/icons`). The whole renderer is lazy-loaded with the thread.

### Design rules the renderer owns

- **Surfaces read as data, not speech:** `bg-kumo-base` with a
  `ring-kumo-line` ring, `rounded-2xl`, never a grey bubble. A node inside a
  `Section` or a Desk card drops its own ring (no ring in a ring).
- **Type scale:** 15px for primary text, 13px for secondary, 11px for
  captions; stat values 22/18/16px by `statSize`. Tabular figures for every
  number.
- **Shape:** buttons and chips fully rounded; controls `--control-size`
  (36px, 44px on touch).
- **Tone:** `good` → `text-kumo-success`, `warn` → `text-kumo-warning`,
  `neutral` → subtle. Used only on values, tags and callouts.
- **Colour:** only the app's tokens. (The app is light-only for now; the
  tokens keep dark mode possible.)
- **Placement:**
  - `thread`: full width of the message column (max 820px), top-level nodes
    `gap-3`.
  - `desk`: inside the card, no outer ring, `Table` capped at 8 rows with
    "Show all" opening the chat, `Split` stacked.
  - `sheet`: phone width, `Split` stacked, `Table` scrolls sideways with a
    sticky first column, `Actions` full width.

### Motion

From the motion tokens in `src/styles.css`; all respect
`prefers-reduced-motion`.

- New surface: the `msg-enter` entrance, top-level nodes staggered by
  `--duration-stagger`.
- A stat value changes: number pop-in (`--duration-fast`, `--ease-bounce`).
- List or table rows added: fade and rise in; removed: fade out
  (`--duration-quick`).
- `Steps` item becomes `done`: the success-check transition.
- Layout replaced: nodes that kept their id stay still; new ones enter.

## System prompt

The "Showing results" section in `src/agents/prompt.ts` is rewritten around
surfaces. The catalog part is generated from `catalog.ts` (`describeCatalog()`)
so it never drifts from the schema. The rules to keep from today:

- Write one or two sentences with the takeaway and your judgement first, then
  show the surface. Each fact once: nothing in the text that a component
  shows.
- Plain text in every prop. No Markdown inside surfaces.
- Use a `Table` only for 3+ attributes; otherwise `List`.

New rules:

- Update a surface instead of showing a new one when it is the same thing
  (the same watch, the same task, the same draft).
- Ask with a `Form` when you need several values or values that are not just
  a choice. For one question with 2-6 answers, keep using `ask_user`.
- After an action event, show the result in the surface (update it to a
  confirmation, or close it).
- Pin to the Desk only from background work that the user will want to come
  back to (a watch, a running task), not for one-off answers.

## Replacing `show`

The project is still in development, so the old implementation goes with no
compatibility layer:

- Delete `src/lib/show.ts`, `src/lib/show.test.ts`,
  `src/components/show-blocks.tsx`, the `show` tool in `bot-agent.ts`, and
  the `show` block kind in `message-parts.ts` / `thread.tsx`.
- Old `show` parts already in chat history are not rendered.

## Phases

Each phase ships on its own and is usable.

1. **Engine and rich answers.** `catalog.ts`, `normalize.ts`, `pointer.ts` with
   tests; the content and layout components plus `Actions` with `say` and
   `link`; `show_surface` with tolerant streaming and the validation loop; the
   prompt rewrite; removing `show`.
2. **Inputs and events.** `Form`, `TextField`, `Choice`, `Toggle`,
   `DateField`; `event` actions; `surfaceAction` on the bot; the `surface`
   origin and its compact user-message rendering.
3. **Live surfaces.** The `surfaces` table, `update_surface`,
   `list_surfaces`, tool-result sync, "Your live surfaces" in
   background prompts, update stubs and event lines in the thread, motion on
   change.
4. **Desk.** Pinning, the hub's `desk_surfaces` copy, the Desk
   card rendering a surface, actions from the Desk.

## Testing

- **Unit:** `normalize` (tolerant partial input, every rejection with its
  path, warnings), `bind` (pointers, patches, field marks across updates),
  limits. Fixtures in `src/agents/fixtures/surfaces/`.
- **Model fixtures:** real `show_surface` inputs captured from each model in
  the catalog (frontier and the Workers AI fallback) for ten standard
  prompts (price search, inbox triage, a form to draft a reply, a routine
  status). Every fixture must normalize without rejection, or with problems
  that the model fixes on the second try.
- **Visual:** a dev-only route that renders every component in each
  placement, light and dark, from the fixtures. Reviewed by eye, no snapshot
  tests.
- **Agent tests:** `surfaceAction` checks (stale version, undeclared field,
  closed surface, double tap → one turn).

## Later

- **Outside agents.** `/mcp` operations to show and update surfaces on the
  user's Desk, with stricter limits and a visible "from Claude Code" frame.
- **Charts.** A `Chart` component (sparkline and bars) once the dataviz rules
  are settled.
- **Tabs** for long surfaces, if fixtures show the need.
- **Local actions** that do not need a model turn (show more, toggle a
  section).
- **An A2UI adapter** at the edges, if interop ever matters: the flat form is
  close to A2UI's wire shape.

## Decisions

1. **Old `show` blocks:** removed with no compatibility layer; the project is
   still in development.
2. **`ask_user` stays** as the path for one question with tappable answers.
   It pauses the turn until the user answers, which surfaces do not. Forms
   are for several values at once.
3. **Bots pick surface ids** (`macbook-watch`), so a routine can update the
   same surface on its next run. When the bot gives none, the server
   generates one and returns it.
4. **Events run with the user present.** Tapping a button is the user acting,
   so every `event` starts a foreground turn, even on a surface a routine
   pinned to the Desk.
