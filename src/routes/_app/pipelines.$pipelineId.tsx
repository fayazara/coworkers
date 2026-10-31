import { useState } from "react"
import { ClientOnly, createFileRoute } from "@tanstack/react-router"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { GearSixIcon, XIcon } from "@/components/icons"
import { PageHeader } from "@/components/page-header"
import { PipelineEditor } from "@/components/pipeline-editor"
import { PipelineRuns, RunButton } from "@/components/pipeline-runs"
import { SplitView } from "@/components/split-view"
import { useHub } from "@/lib/hub-context"
import { useLayout } from "@/lib/layout-context"
import type { Pipeline } from "@/lib/types"

export const Route = createFileRoute("/_app/pipelines/$pipelineId")({
  component: PipelinePage,
})

function Loading() {
  return (
    <div className="flex justify-center pt-16">
      <Loader />
    </div>
  )
}

/** The setup side: steps and schedule, on the canvas beside the runs. */
function SetupPanel({
  pipeline,
  onClose,
  onDirtyChange,
}: {
  pipeline: Pipeline
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  return (
    <aside aria-label="Setup" className="flex h-full flex-col bg-kumo-canvas">
      <div className="col-header justify-between">
        <h2 className="pl-1.5 text-[15px] font-medium text-kumo-default">
          Setup
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close setup"
          className="icon-btn"
        >
          <XIcon size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pt-2 pb-16">
          {/* The schedule picker works in the viewer's time zone, and the
              editor needs the live hub to save. */}
          <ClientOnly fallback={<Loading />}>
            <PipelineEditor
              key={pipeline.id}
              pipeline={pipeline}
              onDirtyChange={onDirtyChange}
            />
          </ClientOnly>
        </div>
      </div>
    </aside>
  )
}

function PipelinePage() {
  const { pipelineId } = Route.useParams()
  const { state } = useHub()
  const { widths, setWidth } = useLayout()
  const [setupOpen, setSetupOpen] = useState(true)
  const [dirty, setDirty] = useState(false)
  const isNew = pipelineId === "new"
  const pipeline = isNew
    ? null
    : (state.pipelines ?? []).find((p) => p.id === pipelineId)

  // A new pipeline (or one that is gone): the setup is the whole page.
  if (!pipeline) {
    return (
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader title={isNew ? "New pipeline" : "Pipeline"} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[640px] px-4 pt-4 pb-16 md:px-6">
            {pipeline === undefined ? (
              <p className="pt-16 text-center text-sm text-kumo-subtle">
                This pipeline does not exist any more.
              </p>
            ) : (
              <ClientOnly fallback={<Loading />}>
                <PipelineEditor key="new" pipeline={null} />
              </ClientOnly>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <SplitView
      id="pipeline"
      side="right"
      label="Pipeline setup"
      open={setupOpen}
      width={widths.panel ?? "40vw"}
      minWidth={340}
      maxWidth="60%"
      mainMinWidth={420}
      onWidthChange={(px) => setWidth("panel", px)}
      onClose={() => setSetupOpen(false)}
      panel={
        <SetupPanel
          pipeline={pipeline}
          onClose={() => setSetupOpen(false)}
          onDirtyChange={setDirty}
        />
      }
    >
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title={pipeline.name}
          actions={
            <>
              <ClientOnly>
                <RunButton
                  pipeline={pipeline}
                  blocked={
                    dirty
                      ? "Save or discard your setup changes to run it."
                      : undefined
                  }
                />
              </ClientOnly>
              <Tooltip
                content={setupOpen ? "Hide setup" : "Setup"}
                render={
                  <button
                    type="button"
                    onClick={() => setSetupOpen((o) => !o)}
                    aria-label={setupOpen ? "Hide setup" : "Show setup"}
                    aria-pressed={setupOpen}
                    className="icon-btn"
                  >
                    <GearSixIcon size={20} />
                  </button>
                }
              />
            </>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-4 pt-4 pb-16 md:px-6">
            <ClientOnly fallback={<Loading />}>
              <PipelineRuns pipeline={pipeline} />
            </ClientOnly>
          </div>
        </div>
      </section>
    </SplitView>
  )
}
