import { useHydrated } from "@tanstack/react-router"
import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react"
import { useTheme } from "@/lib/theme-context"

/**
 * File changes as a real diff (@pierre/diffs): line numbers, word-level
 * highlights, light and dark. Shared by the approval card for an edit and the
 * finished step after it.
 */
const OPTIONS = {
  diffStyle: "unified",
  theme: { light: "pierre-light", dark: "pierre-dark" },
  disableFileHeader: true,
  overflow: "wrap",
  lineDiffType: "word-alt",
  diffIndicators: "bars",
  hunkSeparators: "simple",
} as const

const THEMED_OPTIONS = {
  light: { ...OPTIONS, themeType: "light" },
  dark: { ...OPTIONS, themeType: "dark" },
} as const

/**
 * Prose is not colored as code: a Markdown list dash highlighted red reads as
 * a deleted line. Naming it `.txt` leaves only the real changes colored.
 */
function plainName(name: string) {
  return /\.(md|mdx|markdown)$/i.test(name) ? `${name}.txt` : name
}

function plainPatch(patch: string) {
  return patch.replace(
    /^(Index: |--- |\+\+\+ )(\S.*?)(\t.*)?$/gm,
    (_, mark: string, name: string, rest?: string) =>
      `${mark}${plainName(name)}${rest ?? ""}`
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  // Nothing renders on the server: the diff is highlighted in the browser.
  const hydrated = useHydrated()
  return (
    <div className="max-h-96 min-h-12 overflow-auto text-[13px]">
      {hydrated ? children : null}
    </div>
  )
}

/** A unified patch, as the edit tool returns it. */
export function PatchView({ patch }: { patch: string }) {
  const { mode } = useTheme()
  return (
    <Frame>
      <PatchDiff patch={plainPatch(patch)} options={THEMED_OPTIONS[mode]} />
    </Frame>
  )
}

/** One proposed change: the text it replaces and the text it puts there. */
export function EditView({
  path,
  oldText,
  newText,
}: {
  path: string
  oldText: string
  newText: string
}) {
  const { mode } = useTheme()
  return (
    <Frame>
      <MultiFileDiff
        oldFile={{ name: plainName(path), contents: oldText }}
        newFile={{ name: plainName(path), contents: newText }}
        options={THEMED_OPTIONS[mode]}
      />
    </Frame>
  )
}
