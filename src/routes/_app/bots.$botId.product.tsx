import { createFileRoute } from "@tanstack/react-router"

// The product panel is rendered by the bot layout so it can slide in and
// out; this route gives it a URL, with the product in `?id=`.
export const Route = createFileRoute("/_app/bots/$botId/product")({
  validateSearch: (search: Record<string, unknown>): { id: string } => ({
    id: typeof search.id === "string" ? search.id : "",
  }),
  component: () => null,
})
