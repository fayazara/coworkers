# Theming

Every color, radius, font and shadow the app draws with comes from one
sheet, `src/theme/tokens.css`. It has two layers:

1. **Brand tokens** (`--brand-*`). The values. Colors are declared twice,
   under `:root, [data-mode="light"]` and under `[data-mode="dark"]`; fonts,
   radii and shadows once, on `:root`.
2. **Mappings.** Kumo's variables (`--color-kumo-*`, `--text-color-kumo-*`),
   Tailwind's keys (`--font-*`, `--radius-*`, a few new `--shadow-*` and
   colors) and the app's own (`--fill-hover`, `--fill-active`) read the
   brand tokens. Components only use these names, Tailwind utilities, or a
   brand token where nothing else names the value (a composite shadow in
   `styles.css`, for example). No component holds a color.

The defaults reproduce Kumo's theme plus the app's own adjustments, so the
app looks the same with or without a brand on top.

**To rebrand, override the brand layer only.** The mappings, Kumo and the
components follow. Overriding a `--color-kumo-*` variable directly works too,
but then that value no longer follows the brand.

## Brand tokens

Colors (light and dark):

| Group    | Tokens                                                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accent   | `accent`, `accent-hover`, `on-accent`, `link`, `focus`, `selection`                                                                                                                                                                                                                                 |
| Surfaces | `canvas` (sidebar, page), `surface` (main column, cards), `surface-raised`, `surface-sunken`, `surface-tint` (bubbles, tabs bar), `surface-overlay`, `surface-control`, `surface-contrast` (the user's bubble, toasts, the terminal), `surface-web` (behind web page previews, white in both modes) |
| Fills    | `fill`, `fill-subtle`, `fill-hover`, `fill-active` (translucent), `fill-interact` (scrollbars)                                                                                                                                                                                                      |
| Text     | `text`, `text-strong`, `text-subtle`, `text-placeholder`, `text-inactive`, `text-inverse`                                                                                                                                                                                                           |
| Lines    | `line`, `line-strong` (focused composer), `line-emphasis` (drop target), `hairline`, `grip`, `grip-active`                                                                                                                                                                                          |
| Status   | `danger`, `danger-tint`, `danger-text`, and the same for `warning` and `success`; `info`, `info-tint`; `on-status` (marks on a status fill)                                                                                                                                                         |

All of them are `--brand-<name>`. `--brand-surface` is also the browser
chrome (`theme-color`): keep `THEME_COLORS` in `src/lib/theme.ts` and the
manifest's colors equal to it (`src/theme/tokens.test.ts` checks the first).

Fonts: `--brand-font-sans`, `--brand-font-mono`.

Radii: `--brand-radius-sm` (4px), `-md` (6px), `-lg` (8px), `-xl` (12px),
`-2xl` (16px), `-card` (20px), `-bubble` (22px), `-3xl` (24px), `-pill`.
Tailwind's `rounded-sm` … `rounded-3xl` read them, and `rounded-card` /
`rounded-bubble` are new utilities.

Shadows: `--brand-shadow-pill`, `-frame`, `-button`, `-card`, `-card-hover`,
`-raised`, `-raised-focus`, `-popover`, `-sheet`, `-sheet-up`, and
`--brand-scrim` (behind sheets). The utilities `shadow-card`,
`shadow-card-hover`, `shadow-frame`, `shadow-pill` and `shadow-popover` read
them.

Kumo tokens not mapped here (badges, banners, popover arrows,
`shadow-edge` / `shadow-drop`) keep Kumo's own values; override them directly
if a brand needs to.

## Overriding

Load a sheet after the app's, or add the rules at the end of
`src/styles.css`:

```css
:root {
  --brand-font-sans: "Geist", system-ui, sans-serif;
  --brand-font-mono: "Geist Mono", ui-monospace, monospace;
  --brand-radius-2xl: 0.75rem;
}

:root,
[data-mode="light"] {
  --brand-accent: #1f6feb;
  --brand-accent-hover: #1a5fd0;
  --brand-link: #1f6feb;
  --brand-selection: rgb(31 111 235 / 0.2);
}

[data-mode="dark"] {
  --brand-accent: #3c8aff;
  --brand-accent-hover: #5b9dff;
  --brand-link: #6ea8ff;
  --brand-selection: rgb(60 138 255 / 0.32);
  --brand-canvas: #0b0d10;
  --brand-surface: #111418;
}
```

Overriding a color in one mode leaves the other mode as it was. If you
change `--brand-surface`, change with it `THEME_COLORS` in
`src/lib/theme.ts`, the manifest's `theme_color` / `background_color` (light),
the offline page's colors in `public/sw.js`, and the background in
`scripts/make-dark-splashes.sh` (then run it), so the browser chrome, the
offline page and the installed app's launch stills match. The tests in
`src/theme/tokens.test.ts` and `src/lib/pwa.test.ts` catch the first three.

The iOS launch still (`public/icons/splash-*.png`, `-dark` for dark mode) is
chosen by the phone's scheme when the app is added to the Home Screen, and
iOS keeps that choice: an app added in light mode starts on the light still
even when the phone is later dark, then fades into the dark app. Before the
dark stills, every install started on white.

## Light, dark and system

The mode is `data-mode="light"` or `data-mode="dark"` on `<html>`. Kumo,
the `dark:` variant and the brand tokens all key off it.

The theme button in the sidebar footer offers **System** (the default),
**Light** and **Dark**:

- System stores nothing and follows `prefers-color-scheme`, live.
- Light and Dark are stored in `localStorage` under `coworkers-theme`
  (`"light"` or `"dark"`) and win over the OS until System is picked again,
  which removes the key.

A small script in `<head>` (`THEME_INIT_SCRIPT` in `src/lib/theme.ts`)
applies the stored choice or the OS mode before the first paint, and sets
`color-scheme` and the `theme-color` meta. Other tabs follow through the
`storage` event.
