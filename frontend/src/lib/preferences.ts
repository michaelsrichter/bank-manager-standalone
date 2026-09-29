export type Consent = "analytics" | "necessary" | null;
export type Theme = "light" | "dark";

const CONSENT_KEY = "bm.consent.v1";
const THEME_KEY = "bm.theme.v1";

export function loadConsent(storage: Storage = localStorage): Consent {
  const value = storage.getItem(CONSENT_KEY);
  return value === "analytics" || value === "necessary" ? value : null;
}

export function saveConsent(value: Exclude<Consent, null>, storage: Storage = localStorage): void {
  storage.setItem(CONSENT_KEY, value);
}

export function loadTheme(
  storage: Storage = localStorage,
  prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
): Theme {
  const value = storage.getItem(THEME_KEY);
  if (value === "light" || value === "dark") return value;
  return prefersDark ? "dark" : "light";
}

export function saveTheme(theme: Theme, storage: Storage = localStorage): void {
  storage.setItem(THEME_KEY, theme);
}
