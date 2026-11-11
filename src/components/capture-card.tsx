import { useEffect, useState } from "react"
import { Loader } from "@cloudflare/kumo/components/loader"
import {
  ArrowSquareOutIcon,
  DownloadIcon,
  FilePdfIcon,
  WarningIcon,
} from "@/components/icons"
import type { Capture } from "@/lib/message-parts"

export type ReadFileData = (
  path: string
) => Promise<{ mediaType: string; base64: string }>

/** An object URL for an image or PDF in the bot's files, revoked on unmount. */
export function useFileData(readFile: ReadFileData | undefined, path: string) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!readFile) return
    let objectUrl: string | null = null
    let cancelled = false
    setUrl(null)
    setError(null)
    readFile(path)
      .then(({ mediaType, base64 }) => {
        if (cancelled) return
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaType }))
        setUrl(objectUrl)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load file")
        }
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [readFile, path])

  return { url, error }
}

function fileName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1)
}

/** A screenshot or PDF the bot saved, shown inline in the thread. */
export function CaptureCard({
  capture,
  readFile,
}: {
  capture: Capture
  readFile?: ReadFileData
}) {
  const { url, error } = useFileData(readFile, capture.path)
  const name = fileName(capture.path)
  const isImage = capture.mediaType.startsWith("image/")

  if (isImage) {
    return (
      <figure className="w-full max-w-[640px]">
        <div className="overflow-hidden rounded-2xl bg-kumo-recessed outline outline-1 -outline-offset-1 outline-kumo-line">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" title={capture.path}>
              <img
                src={url}
                alt={`Screenshot saved as ${name}`}
                className="block max-h-[420px] w-full object-cover object-top"
              />
            </a>
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center text-sm text-kumo-subtle">
              {error ? (
                <span className="flex items-center gap-1.5">
                  <WarningIcon size={14} /> {error}
                </span>
              ) : (
                <Loader />
              )}
            </div>
          )}
        </div>
      </figure>
    )
  }

  return (
    <div className="flex w-full max-w-[640px] items-center gap-3 rounded-2xl bg-kumo-tint px-4 py-3">
      <FilePdfIcon size={24} className="shrink-0 text-kumo-subtle" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-kumo-default">
          {name}
        </p>
        <p className="truncate text-xs text-kumo-subtle">
          {error ?? capture.path}
        </p>
      </div>
      {url ? (
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${name}`}
            className="icon-btn"
          >
            <ArrowSquareOutIcon size={16} />
          </a>
          <a
            href={url}
            download={name}
            aria-label={`Download ${name}`}
            className="icon-btn"
          >
            <DownloadIcon size={16} />
          </a>
        </div>
      ) : error ? null : (
        <Loader size="sm" />
      )}
    </div>
  )
}
