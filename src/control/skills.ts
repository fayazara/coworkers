import { z } from "zod"
import { defineOperation, fail } from "./operation"

export const installSkill = defineOperation({
  name: "install_skill",
  description:
    "Ask the user to install an Agent Skill. Use it whenever they paste an `npx skills add` command, link a skill, or ask for one. Shows them the skill, and they choose whether it is for you or for all bots. It is ready on your next turn. Never download a skill yourself.",
  input: z.object({
    source: z
      .string()
      .describe(
        "What the user gave you, unchanged: the npx skills add command, a GitHub repo, or a site"
      ),
    for_all_bots: z
      .boolean()
      .optional()
      .describe("The user asked for this on every bot"),
  }),
  level: "act",
  // Marked destructive for what comes with it: it always stops at the card,
  // and outside agents never see it. Skills steer a bot, so nobody but the
  // user can add one.
  effect: "destructive",
  actionClass: "manage",
  callers: ["bot"],
  // The card did the installing, over the user's own socket. This only
  // reports what they chose.
  async run({ caller, hub }, { source }) {
    if (caller.kind !== "bot") {
      return fail("unavailable", "Only bots can ask to install skills.")
    }
    const names = await hub.installedFrom(caller.botId, source)
    if (!names.length) {
      return fail("invalid", "The user did not install it.")
    }
    return { installed: names, note: "Ready on your next turn." }
  },
})
