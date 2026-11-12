# Bot and app sharing

## Share a bot with your partner

1. Allow their email in the deployment's Cloudflare Access sign-in policy.
   They use their own identity, never your login. Sharing does not change the
   deployment's sign-in allowlist or send an email automatically.
2. Open the bot's **Settings → Sharing**. Add their sign-in email, then copy
   and send the bot link if you like. Switches and additions save immediately.
3. After signing in, the bot appears directly beside their own bots in the left
   sidebar (or the phone's bot list), marked **Shared**. Clicking it opens the
   shared chat immediately; there is no separate workspace or list to open.
   Incoming shares are present on first paint and refresh every five seconds
   while the page is visible, and whenever it regains focus.

Members share the bot's history, bot-local memory, and computer. The same
**Computer** button opens Browser, Terminal, Files, Apps, and Activity, including
the drawer on phones. Members can chat, answer ordinary questions, upload and
download files, run commands, and control the bot's shared browser. They can
edit the bot's app data and message it from its apps; this is not a guest view.

Members cannot use the owner's general agent WebSocket, manage settings or
sharing links, access the owner's UserHub, or approve sensitive connected-account
actions. Those approvals continue to appear on the owner's Desk and chat.
Computer operations use a validated allowlist of member RPCs, with membership
checked both by the server function and again by the bot. File previews are
restricted to `/workspace`, and the activity query is bounded.

Workspace-wide sharing explicitly grants access to **every identity allowed to
sign in through this deployment's Access application**, not an email-domain
guess. Personal bots remain private.
This also includes email-restricted app guests who are allowed to sign in;
leave workspace-wide sharing off when only specific people should see a bot.

### Existing data and private-account isolation

Review existing conversations, memory, files, and results before sharing an
existing bot. Sharing deliberately makes these available; it cannot retract
information someone already read or downloaded. Create a fresh bot when the
old history contains private information.

Sharing is enabled only while the bot and its scripts/delegations are idle.
The bot becomes isolated from account-wide memory, inherited installed skills,
other bots, private pipelines, and saved credentials. The previous browser
session is closed when sharing starts. New browser sessions belong to the shared
bot: all members can see and control them, including sites someone signs into
after sharing starts. Do not enter credentials there unless that access is
intended for every member. Browser tools follow the bot's owner-managed rules.
Bot-local learned skills, memory, files and public web tools remain available.
Owner-managed settings and routines are still configurable in the UI.

Connections are off for an isolated bot until its owner explicitly selects them
in Sharing. An enabled connection's readable data can enter the shared history.
Connected tools classified as writes always require the owner's approval,
including lazy tool calls and replayable scripts; a Block rule still wins.
Background write calls are blocked. Tool classification uses the existing MCP
read-only annotations/name classification, not a guarantee about a third-party
service's implementation.

Isolation stays on after the last member is removed: private account context
must not accidentally re-enter previously shared history. Connected accounts
remain subject to the explicit allowlist. Removing an email or disabling
workspace sharing revokes server access on every subsequent request and closes
that member's app sessions. Reducing membership also closes the shared browser
session so already-issued Live View URLs cannot keep controlling it. Member chat
uses authenticated polling (every three seconds), not the owner's broad agent
protocol; revoked clients clear their chat and computer when their next poll fails.

## Share just an app externally

Open **Computer → Apps**, select the app, and create a sharing link:

- **Anyone with a secret link** needs no Coworkers login. Treat the URL as a
  password; anyone it is forwarded to can use its assigned permissions.
- **Only this email** checks a verified Access identity before issuing an
  app-scoped session. Allow that email through Access and have the recipient
  sign in to Coworkers first, then open the link.
- **View only** is the default. Editing data and messaging the bot are separate
  opt-ins. Editing alone does not queue bot notifications. Automatic page-error
  reporting also needs the messaging permission.
  This default applies to standalone app-share links, not invited bot members.
  Members opening the private app entry get edit and messaging permissions;
  previously issued member sessions receive the same effective permissions.
- Enabling external bot messaging applies the same private-account isolation
  described above, because external messages can influence the bot's next turn.

An app link grants no access to the bot's conversation, workspace, settings,
or other apps. App server code has no internet access. Its app-scoped binding
can use explicitly approved connected-app tools, limited to the isolated bot's
connection allowlist. The owner approves each tool and its scope in Apps;
changed grants require approval again. Removing a connection or revoking a
link stops subsequent tool calls, including calls from cached server bindings.
View-only links and bot GET checks cannot invoke writing tools.

Public-form links retain upstream's submission/receipt rules. Their server.js
backend can manage the app's data; ordinary view-only links remain read-only
even through server routes. Form creation isolates the bot before submissions
can wake it. Direct bot messaging still requires its own explicit permission.
Published app tool approvals are owner preapprovals; agent-driven connected
writes still use the per-action owner approval flow described above.

Use **Revoke** to end a link and its active sessions/sockets. To change an app
link's permissions, revoke it and create a replacement. This deliberately
invalidates the old URL rather than silently changing what it grants.

## Private apps and bot access

A new app has only an owner entry link, which now requires sign-in. Knowing the
owner URL alone does not grant access. Owner and email entry URLs bootstrap a
15-minute opaque-origin session so sandboxed pages need no UI login cookies.
Assets, browser helper, data, custom server routes, errors, messages and live
sockets all pass through authorization. Sessions recheck their parent grant;
member sessions also recheck bot membership. Sessions expire, including idle
sockets. Reopen the original private entry link to start a new session.

Bots use the server-side `app_fetch` tool to read/test their own private app and
its data/server routes without a human session. The host retains the scoped
service credential; it is not returned in prompts, published links, bot state,
the Apps UI, or `env.BOT.info()`/`caller()`. GET tests use a view-only credential.

Existing owner URLs are upgraded to require login. Existing explicit share
URLs and edit permissions are preserved, but messaging is disabled until
explicitly granted on a replacement link. Republishing and restarting preserve
the chosen permissions. Migration is additive in the bot's existing SQLite.

Keep `/apps` in the installer's Cloudflare Access bypass. **Bypass does not mean
public app access**: the Worker enforces the authorization described above. The
main UI, invitation pages and agent endpoints remain behind Access. Sharing by
email and bot membership is unavailable in unauthenticated demo/local mode.
Private app entry links fail closed on production deployments without Access;
local development retains the existing demo identity for previews.
No new bindings or resources are needed. The shared-bot discovery index uses a
reserved UserHub instance, and every index hit is checked against the bot's ACL.

## Verification

Automated tests cover schema/membership rules, durable migration and restarts,
private owner and email entry links, scoped/expiring sessions, parent revocation,
independent edit/message permissions, authorization before pages/assets/APIs and
WebSocket upgrades, and live socket expiry/revocation. Run `pnpm test`,
`pnpm typecheck`, and `pnpm build`.

Before release, also test on the deployed Access-protected host:

1. Owner shares one fresh bot with a second identity; other bots remain hidden.
2. Member chats, opens Computer on desktop and phone, uses all five tabs,
   uploads/downloads and previews files, runs a terminal command, and edits app
   data/messages the bot. They cannot use owner agent URLs or change
   settings/approve sensitive connected-account calls.
3. Connections are unavailable until selected; enabled writes stop for the owner.
4. Anonymous browser cannot open a private owner URL (including assets/APIs/live),
   but can open an explicit view-only secret link without signing in.
5. A wrong signed-in email cannot open an email-restricted link.
6. Revoke while chat/apps are open; subsequent requests fail and sockets close.
7. Republish/restart; private entry and explicit sharing settings are preserved.

### Shared-computer follow-up (2026-11-10)

The shared route now uses the same Computer panel and header as owned bots,
with member-scoped operations instead of an owner socket. Bot membership grants
app editing and messaging; standalone guest-link permissions remain unchanged.
Tests cover the five tabs, scoped browser/terminal operations, revocation,
file-path validation, admin-method rejection, and old member-session upgrades.
Verified: `pnpm test` (277 passing), `pnpm typecheck`, and `pnpm build`.
ESLint is still blocked by the existing TypeScript 7/typescript-eslint mismatch.
Deployed to `https://bots.bndnsmth.app` as Worker version
`4da6408d-e01a-49a5-9804-dcc614bdded5` (100% traffic), replacing
`9294250b-5126-4fe4-ba57-1b54920b4496`. The prebuilt production dry run passed.
Anonymous main, shared-bot and agent URLs still redirect to Access; an unknown
app URL returns 404, and the PWA manifest returns 200. The Access allowlist is
unchanged and its session duration remains 720 hours (30 days).
Authenticated desktop/phone verification with both real identities remains pending.

Live deployment, Access-policy changes, and this real-identity acceptance test
are not performed by the implementation itself.

### Deployment record

- Deployed on 2026-11-09 to `https://bots.bndnsmth.app`.
- Worker version: `9294250b-5126-4fe4-ba57-1b54920b4496` (100% traffic), including
  the unified sidebar and simplified sharing switches.
- Prior version: `10545e70-607f-4bcb-ace9-cfd558c75b0c`.
- Verified anonymous `/` and `/shared` redirect to Access, and an unknown app
  URL returns 404 through the app bypass. The browser shows the Access sign-in
  screen. Authenticated/two-identity acceptance testing remains pending.
- No Access allowlist or sharing grants were changed during deployment.
