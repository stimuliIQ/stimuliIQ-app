// Client-only user preferences (theme, default video quality, language) —
// Phase 9 Completion, T34 (docs/plans/phase-9-completion.md, docs/02 §7.16
// "settings (notification prefs, password, language, video quality default,
// theme)"). These are device-local UI preferences, NOT backed by a server
// `Setting` row (platform/settings.schemas.ts `model Setting` is system/company
// scope for CRM-managed config, not a per-student preference store) — so they
// persist to localStorage and apply immediately, same as most consumer apps'
// "appearance" settings.
//
// Theme is additionally applied as early as possible (see the inline script in
// app/layout.tsx) to avoid a flash of the wrong theme on load.

export const THEME_STORAGE_KEY = "stimuliiq:lms:theme";
export const VIDEO_QUALITY_STORAGE_KEY = "stimuliiq:lms:video-quality";
export const LANGUAGE_STORAGE_KEY = "stimuliiq:lms:language";

export type ThemePreference = "light" | "dark" | "system";
export type VideoQualityPreference = "auto" | "1080p" | "720p" | "480p" | "360p";
export type LanguagePreference = "en" | "hi";

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "Match device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const VIDEO_QUALITY_OPTIONS: ReadonlyArray<{ value: VideoQualityPreference; label: string }> = [
  { value: "auto", label: "Auto (recommended)" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p (data saver)" },
];

export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: LanguagePreference; label: string }> = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी (Hindi)" },
];

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Applies (or removes) the `.dark` class on <html> per docs/07 theming convention. */
export function applyTheme(theme: ThemePreference): void {
  if (!isBrowser()) return;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const shouldBeDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", shouldBeDark);
}

export function getStoredTheme(): ThemePreference {
  if (!isBrowser()) return "system";
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function setStoredTheme(theme: ThemePreference): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

export function getStoredVideoQuality(): VideoQualityPreference {
  if (!isBrowser()) return "auto";
  const raw = window.localStorage.getItem(VIDEO_QUALITY_STORAGE_KEY);
  const valid = VIDEO_QUALITY_OPTIONS.map((o) => o.value);
  return (valid as string[]).includes(raw ?? "") ? (raw as VideoQualityPreference) : "auto";
}

export function setStoredVideoQuality(quality: VideoQualityPreference): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(VIDEO_QUALITY_STORAGE_KEY, quality);
}

export function getStoredLanguage(): LanguagePreference {
  if (!isBrowser()) return "en";
  const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return raw === "hi" ? "hi" : "en";
}

export function setStoredLanguage(language: LanguagePreference): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

/**
 * The exact source the blocking inline script in app/layout.tsx runs before
 * hydration, so the initial paint already has the right theme (no flash).
 * Kept here as the single source of truth for that snippet.
 */
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var t = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
