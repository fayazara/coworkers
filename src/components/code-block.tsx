import {
  CodeHighlighted,
  ShikiProvider,
  normalizeLanguage,
} from "@cloudflare/kumo/code"
import type { LanguageInput } from "@cloudflare/kumo/code"

const LANGUAGES: LanguageInput[] = [
  "json",
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "html",
  "css",
  "python",
  "yaml",
  "markdown",
  "bash",
  "sql",
  "toml",
  "diff",
  "graphql",
]

const EXTENSIONS: Record<string, string> = {
  json: "json",
  jsonc: "json",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  html: "html",
  htm: "html",
  svg: "html",
  xml: "html",
  css: "css",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  toml: "toml",
  diff: "diff",
  patch: "diff",
  graphql: "graphql",
  gql: "graphql",
}

/** Loads Shiki once, lazily, for every code block in the app. */
export function CodeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ShikiProvider engine="javascript" languages={LANGUAGES}>
      {children}
    </ShikiProvider>
  )
}

/** Language for a file path, from its extension. */
export function languageForPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSIONS[ext]
}

/**
 * Pretty-prints JSON and picks a language. Tool output is usually compact
 * JSON on one line; anything that does not parse is left as it is.
 */
function prepare(code: string, lang?: string) {
  const trimmed = code.trim()
  if ((!lang || lang === "json") && /^[[{]/.test(trimmed)) {
    try {
      return {
        code: JSON.stringify(JSON.parse(trimmed), null, 2),
        lang: "json",
      }
    } catch {
      return { code, lang: "json" }
    }
  }
  return { code, lang }
}

/**
 * Syntax-highlighted code in the app's mono font. Unknown languages render
 * as plain mono text. Long lines wrap rather than scroll sideways.
 */
export function CodeBlock({
  code,
  lang,
  className = "",
}: {
  code: string
  lang?: string
  className?: string
}) {
  const prepared = prepare(code, lang)
  const known =
    prepared.lang && LANGUAGES.includes(normalizeLanguage(prepared.lang)!)
  return (
    <div className={`overflow-auto ${className}`}>
      {known ? (
        <CodeHighlighted
          code={prepared.code}
          lang={prepared.lang!}
          variant="plain"
          className="bg-transparent [&_pre]:font-mono [&_pre]:text-[13px]! [&_pre]:leading-[1.6]! [&_pre]:break-words [&_pre]:whitespace-pre-wrap"
        />
      ) : (
        <pre className="font-mono text-[13px] leading-[1.6] break-words whitespace-pre-wrap text-kumo-default">
          {prepared.code}
        </pre>
      )}
    </div>
  )
}
