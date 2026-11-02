/**
 * "Show a bot how it's done": record what the user does in the bot's
 * browser during a hand-off, so the bot can write it down as a skill.
 *
 * The recorder is a small page script. It is registered for new documents
 * and injected into the current page, and logs clicks, field changes and
 * form submits to `window.name` (survives same-site navigations) and
 * `localStorage`. Page.getNavigationHistory covers every page visited even
 * when the script could not run there, so the bot always has the route.
 *
 * Both functions return code for the browser Code Mode runtime, which has
 * a `cdp` connector (`cdp.send`, `cdp.attachToTarget`).
 */

const LOG_KEY = "__coworkers_teach__"

/** Exported for tests, which run it against stand-in page objects. */
export const RECORDER = `(() => {
  if (window.__coworkersTeach) return;
  window.__coworkersTeach = true;
  const KEY = ${JSON.stringify(LOG_KEY)};
  // Matched against the words of a field's type, name, id, autocomplete
  // and labels. Short words only count whole, so "Shipping options" and
  // "postal-code" are kept, while "cardnumber", "cc-exp", "api_key" and
  // "Security code" are hidden.
  const SECRET = /pass|pwd|secret|token|apikey|cvv|cvc|card|ssn|iban|routing|account|otp|one time|\\b(pin|cc|csc|key|api|auth|2fa|mfa)\\b|\\b(security|verification|access|sms) code\\b/;
  function isSecret(el) {
    if (el.type === "password") return true;
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : "";
    const hint = [el.type, el.name, el.id, el.autocomplete, el.getAttribute && el.getAttribute("aria-label"), label].join(" ");
    const words = hint.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    return SECRET.test(words);
  }
  // What a user typed is only ever recorded as an input event's value.
  function isField(el) {
    return /^(input|textarea|select)$/i.test(el.tagName) && !/^(button|submit|reset)$/i.test(el.type || "");
  }
  function read() {
    try {
      if (window.name.startsWith(KEY)) return JSON.parse(window.name.slice(KEY.length));
    } catch {}
    return [];
  }
  function write(event) {
    const log = read();
    log.push(event);
    while (log.length > 300) log.shift();
    const json = JSON.stringify(log);
    try { window.name = KEY + json; } catch {}
    try { localStorage.setItem(KEY, json); } catch {}
  }
  function text(value, max) {
    return String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
  }
  function describe(el) {
    if (!el || !el.tagName) return {};
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : "";
    return {
      tag: el.tagName.toLowerCase(),
      text: isField(el) ? "" : text(el.innerText || el.value, 80),
      label: text(el.getAttribute("aria-label") || label || el.getAttribute("title"), 80),
      name: el.getAttribute("name") || undefined,
      id: el.id || undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      role: el.getAttribute("role") || undefined,
      href: el.getAttribute("href") || undefined,
      type: el.getAttribute("type") || undefined,
    };
  }
  const CLICKABLE = "a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[onclick]";
  addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest(CLICKABLE) || e.target : null;
    write({ t: "click", url: location.href, el: describe(target), at: Date.now() });
  }, true);
  addEventListener("change", (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    const hidden = isSecret(el);
    const value = el.type === "checkbox" || el.type === "radio" ? String(el.checked) : el.value;
    write({ t: "input", url: location.href, el: describe(el), value: hidden ? "[hidden]" : text(value, 120), at: Date.now() });
  }, true);
  addEventListener("submit", (e) => {
    write({ t: "submit", url: location.href, el: describe(e.target), at: Date.now() });
  }, true);
  write({ t: "page", url: location.href, title: document.title, at: Date.now() });
})()`

const READ_LOG = `(() => {
  const KEY = ${JSON.stringify(LOG_KEY)};
  let events = [];
  try { if (window.name.startsWith(KEY)) events = JSON.parse(window.name.slice(KEY.length)); } catch {}
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (stored.length > events.length) events = stored;
  } catch {}
  try { if (window.name.startsWith(KEY)) window.name = ""; } catch {}
  try { localStorage.removeItem(KEY); } catch {}
  return events;
})()`

export interface TeachSession {
  targetId: string
  /** Navigation history index when recording started. */
  startIndex: number
  task: string
  startedAt: number
}

export interface TeachEvent {
  t: "page" | "click" | "input" | "submit"
  url: string
  title?: string
  value?: string
  el?: Record<string, string | undefined>
  at: number
}

export interface TeachRecording {
  pages: { url: string; title: string }[]
  events: TeachEvent[]
  finalUrl?: string
  /** The recorded tab was gone; this is from the tab open now. */
  recycled?: boolean
}

/** Pick (or open) the bot's tab, point it at `startUrl`, start recording. */
export function startTeachingCode(startUrl: string | undefined) {
  return `async () => {
  const START = ${JSON.stringify(startUrl ?? "")};
  const RECORDER = ${JSON.stringify(RECORDER)};
  const { targetInfos } = await cdp.send({ method: "Target.getTargets" });
  const pages = targetInfos.filter((t) => t.type === "page");
  // Every session starts with a blank tab; the bot's own tab comes first.
  let targetId = (pages.find((t) => t.url !== "about:blank") || pages[0])?.targetId;
  if (!targetId) {
    ({ targetId } = await cdp.send({ method: "Target.createTarget", params: { url: START || "about:blank" } }));
  }
  const { sessionId } = await cdp.attachToTarget({ targetId });
  await cdp.send({ method: "Page.enable", sessionId });
  await cdp.send({ method: "Page.addScriptToEvaluateOnNewDocument", params: { source: RECORDER }, sessionId });
  const before = await cdp.send({ method: "Page.getNavigationHistory", sessionId });
  if (START) {
    await cdp.send({ method: "Page.navigate", params: { url: START }, sessionId });
    for (let i = 0; i < 40; i++) {
      const { result } = await cdp.send({
        method: "Runtime.evaluate",
        params: { expression: "document.readyState", returnByValue: true },
        sessionId,
      });
      if (result && result.value === "complete") break;
    }
  }
  await cdp.send({ method: "Runtime.evaluate", params: { expression: RECORDER }, sessionId });
  await cdp.send({ method: "Target.activateTarget", params: { targetId } });
  const { result } = await cdp.send({
    method: "Runtime.evaluate",
    params: { expression: "location.href", returnByValue: true },
    sessionId,
  });
  return { targetId, startIndex: START ? before.currentIndex + 1 : before.currentIndex, url: result && result.value };
}`
}

/** Collect the pages visited and the recorded events, then clear the log. */
export function finishTeachingCode(session: TeachSession) {
  return `async () => {
  const READ_LOG = ${JSON.stringify(READ_LOG)};
  const recorded = ${JSON.stringify(session.targetId)};
  // The browser session can be recycled while the user works (idle
  // timeout, reconnect). Fall back to whatever tab is open now.
  const { targetInfos } = await cdp.send({ method: "Target.getTargets" });
  const pages = targetInfos.filter((t) => t.type === "page");
  const same = pages.find((t) => t.targetId === recorded);
  const target = same || pages.find((t) => t.url !== "about:blank") || pages[0];
  if (!target) return { pages: [], events: [], recycled: true };
  const { sessionId } = await cdp.attachToTarget({ targetId: target.targetId });
  const history = await cdp.send({ method: "Page.getNavigationHistory", sessionId });
  const { result } = await cdp.send({
    method: "Runtime.evaluate",
    params: { expression: READ_LOG, returnByValue: true },
    sessionId,
  });
  const start = same ? ${session.startIndex} : 0;
  const entries = history.entries.slice(start, history.currentIndex + 1);
  return {
    pages: entries.map((e) => ({ url: e.url, title: e.title })),
    events: (result && result.value) || [],
    finalUrl: history.entries[history.currentIndex] && history.entries[history.currentIndex].url,
    recycled: !same,
  };
}`
}
