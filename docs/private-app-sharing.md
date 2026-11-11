# Private apps and sharing authorization

New apps start with an authenticated owner entry link. Explicit links can be
restricted to an email or shared as secret URLs. Viewing is the default;
editing and bot messaging are separate permissions.

Owner and email entries issue app-scoped, expiring sessions. Every request
checks its grant, including cached server bindings and live sockets. Revoking
an entry invalidates its sessions. Existing owner URLs become private;
existing explicit share URLs retain their edit permissions.

Bots test their own apps through `app_fetch`. Scoped service credentials never
appear in the model's results. GET tests are read-only, including connected
tools invoked by an app's server.

External messages and public forms isolate the bot from private account
memory, inherited skills, credentials, pipelines, and other bots. Isolation
persists after revocation. Connections require an explicit owner allowlist.
App server tools require owner-approved grants as well as that allowlist.

In Computer → Apps → Access and sharing, selecting bot messaging or a public
form reveals **Connected accounts for sharing**. Choose accounts explicitly;
none are enabled automatically. The selection remains available after isolation
and applies to the bot and all its apps, independently of app-tool approvals.
Changing one account does not replace bot membership or disable isolation.

This branch includes the shared authorization and membership backend used by
the subsequent shared-bot interface. It adds no bindings or Durable Object
classes. The schema migration is additive inside existing bot storage.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. Real-identity testing on an
Access-protected host should cover owner, invited email, anonymous guest,
expiration, revocation, and republishing.
