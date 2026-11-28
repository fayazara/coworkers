export type ThemePreference = "system" | "light" | "dark"
export type ColorMode = "light" | "dark"

export const THEME_STORAGE_KEY = "coworkers-theme"
export const THEME_COLORS: Record<ColorMode, string> = {
  light: "#ffffff",
  dark: "#111111",
}
export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
}

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system"
}

export function resolveColorMode(
  preference: ThemePreference,
  systemDark: boolean
): ColorMode {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference
}

// Literal JavaScript stays identical in server/client builds. Serializing a
// function with toString() would depend on each build's transforms/minification.
// Runs before styles or the body, including when browser storage is blocked.
export const THEME_BOOTSTRAP = `(()=>{
  let preference="system";
  try {
    const saved=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if(saved==="light"||saved==="dark") preference=saved;
  } catch {}
  const mode=preference==="system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light")
    : preference;
  const root=document.documentElement;
  root.dataset.themePreference=preference;
  root.dataset.mode=mode;
  root.style.colorScheme=mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",${JSON.stringify(THEME_COLORS)}[mode]);
})();`
