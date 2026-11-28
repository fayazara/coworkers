import { z } from "zod"
import type { RulePolicy } from "./types"

export const emailAddress = z.string().trim().toLowerCase().email().max(254)
export const botSharingSchema = z.object({
  emails: z.array(emailAddress).max(50),
  workspace: z.boolean().default(false),
  connectionIds: z.array(z.string().min(1).max(100)).max(50).default([]),
})

export interface BotSharing {
  emails: string[]
  workspace: boolean
  connectionIds: string[]
  /** Stays on after revocation: private context must not re-enter shared history. */
  isolated: boolean
}

export const PRIVATE_BOT: BotSharing = {
  emails: [],
  workspace: false,
  connectionIds: [],
  isolated: false,
}

export function isBotMember(sharing: BotSharing, email: string | null) {
  if (!email) return false
  return (
    sharing.workspace || sharing.emails.includes(email.trim().toLowerCase())
  )
}

export const appSharingSchema = z
  .object({
    audience: z.enum(["link", "email"]).default("link"),
    email: emailAddress.optional(),
    canMessage: z.boolean().default(false),
  })
  .refine((v) => v.audience !== "email" || !!v.email, {
    message: "An email address is required for restricted access",
  })

export function canUseAppLink(
  link: { audience?: string; email?: string; expiresAt?: number },
  email: string | null,
  owner: boolean,
  member: boolean,
  now = Date.now()
) {
  if (link.expiresAt && link.expiresAt <= now) return false
  switch (link.audience) {
    case "owner":
      return owner || member
    case "email":
      return !!email && email.toLowerCase() === link.email
    case "bot":
      return true
    case "session":
      return true
    case "link":
    case undefined:
      return true // Existing explicit secret share links remain valid.
    default:
      return false
  }
}

/** Shared bots cannot use private account context, credentials, or other bots. */
export function blockedForSharedBot(name: string, actionClass?: string) {
  return (
    ["bots", "manage", "routines", "email"].includes(actionClass ?? "") ||
    [
      "remember_shared",
      "remember_for_all_bots",
      "request_secret",
      "secret_request",
      "list_secrets",
      "request_handoff",
      "set_name",
      "set_role",
      "delete_app",
      "cancel_routine",
    ].includes(name)
  )
}

/** Members can use the bot's computer, never its owner's administration API. */
const workspacePath = z
  .string()
  .min(1)
  .max(1000)
  .transform((path, ctx) => {
    const relative = path.startsWith("/workspace/") ? path.slice(11) : path
    if (
      !relative ||
      relative.startsWith("/") ||
      /[\\\x00]/.test(relative) ||
      relative.split("/").some((part) => part === ".." || part === ".")
    ) {
      ctx.addIssue({ code: "custom", message: "Not a workspace file" })
      return z.NEVER
    }
    return `/workspace/${relative}`
  })

export const sharedWorkspaceActionSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("getLiveView") }),
  z.object({
    method: z.literal("getBrowserFrame"),
    toolCallId: z.string().min(1).max(200),
  }),
  z.object({
    method: z.literal("navigateBrowser"),
    action: z.enum(["back", "forward", "reload"]),
  }),
  z.object({ method: z.literal("closeBrowser") }),
  z.object({
    method: z.literal("getActivity"),
    limit: z.number().int().min(1).max(200).default(200),
  }),
  z.object({ method: z.literal("readFileData"), path: workspacePath }),
  z.object({ method: z.literal("readFileText"), path: workspacePath }),
  z.object({
    method: z.literal("runCommand"),
    command: z.string().trim().min(1).max(32_000),
  }),
])

export type SharedWorkspaceAction = z.infer<typeof sharedWorkspaceActionSchema>

export const SHARING_DIRECTORY = "__coworkers_sharing_directory__"

export function appOperationDenied(
  caller: { mode: "view" | "edit" | "submit"; canMessage?: boolean },
  op: string
): string | null {
  if ((op === "tell" || op === "error") && !caller.canMessage)
    return "Messaging the bot is disabled for this link"
  if (
    (op === "put" && caller.mode === "view") ||
    (op === "remove" && caller.mode !== "edit")
  )
    return "This link is view-only"
  return null
}

/** Never downgrade a Block rule or let background settings skip owner approval. */
export function sharedConnectionRule(
  policy: RulePolicy,
  isolated: boolean,
  readOnly: boolean,
  background: boolean
): RulePolicy {
  if (!isolated || readOnly || policy === "block") return policy
  return background ? "block" : "ask"
}
