# Appearance

Choose **System**, **Light**, or **Dark** from the sidebar's Appearance menu or
**Settings → Appearance**. Changes apply immediately. The default is System.
The preference is browser-local (`localStorage["coworkers-theme"]`), not part of
an account or bot's broadcast state. Other tabs on the same origin stay in sync.
If storage is unavailable, changes still work until the page reloads.

## Rendering

- `src/lib/theme.ts` emits literal, build-independent JavaScript in the head,
  before styles and body paint. It restores the preference and sets Kumo's
  `data-mode`, CSS `color-scheme`, and the browser's theme color.
- `ThemeProvider` uses the same server and initial client state, then connects
  React controls and shadow-root diff renderers to the bootstrapped mode. System
  follows live device changes; explicit overrides do not.
- Kumo semantic colors cover the workspace, menus, dialogs and highlighted code.
  The file tree inherits the app scheme. Diffs receive an explicit light/dark
  option instead of independently following the device.
- The terminal always stays dark. Remote browser content, screenshots and
  independently authored apps retain their own colors; they are not inverted.
- The offline page honors saved overrides while keeping pages network-only.
  Only content-hashed `/assets/*` resources are cached by the service worker.

## Installed apps

The in-app launch splash follows the saved preference before painting. Native
iOS startup images have light and dark variants selected by the **device** theme:
iOS displays them before JavaScript can read the browser preference. Existing
home-screen installations may cache old images. Android's native install-time
splash uses the static colors in `public/manifest.json`; it cannot read a
browser-local preference. Native launch behavior still needs real-device checks.

Dark startup images use the existing transparent `public/icons/launch-robot.png`
on `#111111`, with the position and dimensions from `.launch-splash-box` in
`src/styles.css`. At each device pixel ratio, the artwork is 154×191 CSS pixels,
positioned at `(width / 2 - 77, height / 2 - 109)` CSS pixels. The supported
device dimensions are listed in `src/routes/__root.tsx`.

## Verification

Automated tests cover preference parsing, before-React bootstrapping, hydration,
OS changes, explicit overrides, reload persistence, cross-tab events, blocked
storage, listener cleanup, both appearance controls, and diff options.

Local Chromium checks cover desktop/phone-width settings, portalled menus,
first paint, reloads, live device changes, file trees/diffs, the always-dark
terminal, and the offline fallback. Check installed iOS and Android apps on real
devices before claiming native splash acceptance.
