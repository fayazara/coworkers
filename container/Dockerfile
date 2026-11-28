# The bot's Linux computer: a Cloudflare Container each BotAgent starts on
# demand for the `linux` exec backend (npm, node, python, real binaries).
#
# computerd mounts the bot's /workspace over FUSE and syncs it with the
# Durable Object's SQLite, so files written here show up in the bot's other
# tools and the other way round. Its tag must match the installed
# @cloudflare/computer version.
FROM ghcr.io/cloudflare/computer-computerd-linux-x64:0.8.0 AS computerd

# stable-slim is trixie: computerd needs libfuse 3.17 or newer.
FROM debian:stable-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fuse3 libfuse2t64 ca-certificates curl gnupg git jq unzip \
      python3 python3-pip python3-venv \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Bots install Python packages without a venv; Debian blocks that by default.
ENV PIP_BREAK_SYSTEM_PACKAGES=1

COPY --from=computerd /usr/local/bin/computerd /usr/local/bin/computerd

# computerd's defaults: HTTP + WebSocket on :8080, FUSE mount at /workspace.
# FUSE_MOUNT=auto uses real FUSE on Cloudflare Containers and a userspace
# shim in local dev, where /dev/fuse is missing.
ENV PORT=8080
ENV MOUNT_POINT=/workspace
ENV FUSE_MOUNT=auto
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/computerd"]
