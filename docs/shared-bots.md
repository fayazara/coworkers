# Shared bots and computers

This branch builds on `feature/private-app-sharing`. The bot owner can invite
specific Access-authenticated emails or enable sharing with every identity
allowed into the deployment. Personal bots remain private.

Shared bots appear alongside personal bots in the sidebar. Members use their
own authenticated, polling-based chat route; they never open the owner's agent
WebSocket. They can read shared history and bot-local memory, send messages,
attach files, and answer ordinary questions. Owner settings and sensitive
approvals remain owner-only. Revocation clears the member view on its next
poll and denies subsequent server requests.

The same branch includes the shared computer panel: Browser, Terminal, Files,
Apps and Activity, connected through a member-scoped RPC allowlist. Shared chat
and computer access are one feature, with no separate computer-sharing branch
or invitation.

Sharing an existing bot exposes its existing history and workspace. Use a
fresh bot when the existing one contains private information. Access policy
changes and invitation emails are not performed by this UI.
