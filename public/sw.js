// Receives push messages from bots and shows them as notifications, even
// when no Coworkers tab is open, keeps built assets for a fast start, and
// shows a page when there is no network. Registered by src/routes/__root.tsx.
// Pages stay network-only: they hold private data and a cached one would hide
// Cloudflare Access sending the user to sign in.

const ASSETS = "assets-v1"
const MAX_ASSETS = 200

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Coworkers</title>
<style>
  body { margin: 0; height: 100dvh; display: grid; place-content: center; gap: 12px;
    font: 15px system-ui, sans-serif; text-align: center; color: #555; }
  h1 { margin: 0; font-size: 18px; font-weight: 600; color: #111; }
  button { justify-self: center; height: 44px; padding: 0 20px; border: 0;
    border-radius: 22px; background: #111; color: #fff; font: inherit; }
</style>
<h1>You're offline</h1>
<p style="margin: 0">Coworkers needs a connection to reach your bots.</p>
<button onclick="location.reload()">Try again</button>
</html>`

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== ASSETS).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
)

// File names under /assets carry a content hash, so they never go stale.
async function cachedAsset(request) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone())
    const keys = await cache.keys()
    if (keys.length > MAX_ASSETS) await cache.delete(keys[0])
  }
  return response
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cachedAsset(request))
  } else if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_PAGE, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
      )
    )
  }
})

self.addEventListener("push", (event) => {
  if (!event.data) return
  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: "Coworkers", body: event.data.text() }
  }
  const url = new URL(data.url || "/", self.location.origin).href

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // The user is already looking at this thread.
        const watching = windows.some(
          (w) => w.focused && w.visibilityState === "visible" && w.url === url
        )
        if (watching) return
        return self.registration.showNotification(data.title || "Coworkers", {
          body: data.body || "",
          icon: "/icons/icon-192.png",
          tag: data.tag,
          renotify: Boolean(data.tag),
          data: { url },
        })
      })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const same = windows.find((w) => w.url === url && "focus" in w)
        if (same) return same.focus()
        const any = windows.find(
          (w) => w.url.startsWith(self.location.origin) && "navigate" in w
        )
        if (any) return any.navigate(url).then((w) => w && w.focus())
        return self.clients.openWindow(url)
      })
  )
})
